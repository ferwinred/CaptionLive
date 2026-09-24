"""100% local speech recognition with faster-whisper (``pip install captionlive[local]``).

Simple, robust streaming strategy suited to talks:

* an energy VAD splits the audio into utterances (pause >= 600 ms or 12 s max),
* while an utterance is growing it is re-transcribed every ~1 s -> interim captions,
* when it closes it is transcribed once more with beam search -> final caption.

The glossary is passed as ``initial_prompt`` to bias the decoder towards the terms.
Pair it with an OpenAI-compatible local LLM (e.g. Gemma via Ollama) for translation
and nothing leaves the venue.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import time

import numpy as np

from ..audio import level_dbfs, pcm16_to_float
from ..config import Settings
from .base import ASRStream, cancel_task

log = logging.getLogger(__name__)

SPEECH_DBFS = -42.0
END_SILENCE = 0.6
MAX_UTTERANCE = 12.0
INTERIM_EVERY = 1.0


@functools.lru_cache(maxsize=2)
def _load_model(name: str, device: str):
    from faster_whisper import WhisperModel  # optional dependency

    compute = "int8" if device in ("cpu", "auto") else "float16"
    log.info("loading faster-whisper model %s on %s", name, device)
    return WhisperModel(name, device=device, compute_type=compute)


class WhisperASR(ASRStream):
    def __init__(self, settings: Settings, source_lang: str = "en", glossary=None) -> None:
        super().__init__()
        self.rate = settings.sample_rate
        self.language = None if source_lang == "auto" else source_lang
        self.prompt = ", ".join(glossary or []) or None
        self.model = _load_model(settings.whisper_model, settings.whisper_device)
        self._buf = bytearray()
        self._in_speech = False
        self._silence = 0.0
        self._last_interim = 0.0
        self._lock = asyncio.Lock()
        self._pending: set[asyncio.Task] = set()

    async def start(self) -> None:
        pass

    def _transcribe(self, audio: bytes, final: bool) -> str:
        samples = pcm16_to_float(bytes(audio)).astype(np.float32)
        segments, _ = self.model.transcribe(
            samples,
            language=self.language,
            beam_size=5 if final else 1,
            initial_prompt=self.prompt,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments)

    async def _run(self, audio: bytes, final: bool) -> None:
        async with self._lock:
            text = await asyncio.to_thread(self._transcribe, audio, final)
        self._emit(text, final=final)

    def _spawn(self, audio: bytes, final: bool) -> None:
        task = asyncio.create_task(self._run(audio, final))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def send(self, pcm16: bytes) -> None:
        dur = len(pcm16) / 2 / self.rate
        voiced = level_dbfs(pcm16) > SPEECH_DBFS
        if voiced:
            self._in_speech = True
            self._silence = 0.0
        elif self._in_speech:
            self._silence += dur
        if not self._in_speech:
            return
        self._buf.extend(pcm16)
        length = len(self._buf) / 2 / self.rate
        if self._silence >= END_SILENCE or length >= MAX_UTTERANCE:
            self._spawn(bytes(self._buf), final=True)
            self._buf.clear()
            self._in_speech = False
            self._silence = 0.0
        elif time.monotonic() - self._last_interim >= INTERIM_EVERY and not self._lock.locked():
            self._last_interim = time.monotonic()
            self._spawn(bytes(self._buf), final=False)

    async def close(self) -> None:
        if self._buf:
            self._spawn(bytes(self._buf), final=True)
            self._buf.clear()
        for task in list(self._pending):
            try:
                await asyncio.wait_for(task, timeout=30)
            except Exception:  # noqa: BLE001
                await cancel_task(task)
        self._finish()
