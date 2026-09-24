"""Speech-recognition provider contract.

Every provider normalises its output to the same semantics:

* ``Transcript(final=False)``: the *full* current hypothesis for the utterance in
  progress. Each interim replaces the previous one.
* ``Transcript(final=True)``: the committed text of a whole utterance. After it,
  the next interim starts a new utterance.
"""

from __future__ import annotations

import asyncio
import contextlib
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class Transcript:
    text: str
    final: bool


class ASRStream(ABC):
    """One recognition stream per stage. Push PCM16 mono audio, iterate transcripts."""

    def __init__(self) -> None:
        self._out: asyncio.Queue[Transcript | None] = asyncio.Queue()
        self.reconnects = 0
        self.errors = 0
        self.last_error = ""

    def _error(self, message: str) -> None:
        self.errors += 1
        self.last_error = message[:300]

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def send(self, pcm16: bytes) -> None:
        """Push a chunk of 16-bit mono PCM at the configured sample rate."""

    @abstractmethod
    async def close(self) -> None:
        """Flush pending audio and stop. Must end the iterator."""

    def _emit(self, text: str, final: bool) -> None:
        text = " ".join(text.split())
        if not text:
            return
        self._out.put_nowait(Transcript(text, final))

    def _finish(self) -> None:
        self._out.put_nowait(None)

    async def __aiter__(self) -> AsyncIterator[Transcript]:
        while True:
            item = await self._out.get()
            if item is None:
                return
            yield item


async def cancel_task(task: asyncio.Task | None) -> None:
    if task and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
