"""Deterministic fake ASR: turns audio *duration* into a scripted talk.

Used by the test-suite and by ``CL_ASR_PROVIDER=mock`` for demos / load tests
without any API key or GPU.
"""

from __future__ import annotations

from ..audio import duration_seconds
from .base import ASRStream

DEMO_SCRIPT = [
    "Welcome to Nerdearla, today we are going to talk about Kubernetes operators.",
    "An operator encodes the knowledge of a human operator into software.",
    "We will use the Gemini API to transcribe this talk in real time.",
    "Latency matters, so we stream audio in one hundred millisecond chunks.",
    "Questions are welcome at the end of the session, thank you!",
]


class MockASR(ASRStream):
    def __init__(self, rate: int = 16000, words_per_second: float = 3.0, script=None) -> None:
        super().__init__()
        self.rate = rate
        self.seconds_per_word = 1.0 / words_per_second
        self.script = [s.split() for s in (script or DEMO_SCRIPT)]
        self._sentence = 0
        self._word = 0
        self._acc = 0.0

    async def start(self) -> None:
        pass

    async def send(self, pcm16: bytes) -> None:
        self._acc += duration_seconds(pcm16, self.rate)
        while self._acc >= self.seconds_per_word:
            self._acc -= self.seconds_per_word
            self._advance()

    def _advance(self) -> None:
        words = self.script[self._sentence % len(self.script)]
        self._word += 1
        text = " ".join(words[: self._word])
        if self._word >= len(words):
            self._emit(text, final=True)
            self._sentence += 1
            self._word = 0
        else:
            self._emit(text, final=False)

    async def close(self) -> None:
        words = self.script[self._sentence % len(self.script)]
        if self._word:
            self._emit(" ".join(words[: self._word]), final=True)
        self._finish()
