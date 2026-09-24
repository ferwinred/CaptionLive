"""Gemini Live API speech recognition (default: ``gemini-3.5-transcribe-live``).

Design notes
------------
* Audio is streamed as 16 kHz PCM16 in ~100 ms chunks over a single WebSocket per
  stage. The model returns ``interim_input_transcription`` (fast, may change) and
  ``input_transcription`` (final text of an utterance).
* Live sessions are time-capped (10 min for transcribe-live). We **rotate** the
  connection before the cap: the new connection is opened first, audio is switched
  to it, and the old one is told ``audio_stream_end`` and drained for a few seconds
  so the utterance in flight is not lost. Rotation waits for a pause in speech.
* Network errors reconnect with exponential back-off. Audio produced meanwhile is
  buffered (bounded) and replayed, so short outages only add latency.
* The session glossary is passed as ``custom_vocabulary`` to bias recognition of
  technical terms and names.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque

from ..audio import level_dbfs
from ..config import Settings
from .base import ASRStream, cancel_task

log = logging.getLogger(__name__)

SENTENCE_END = (".", "?", "!", "…", "。", "？", "！")
MAX_BUFFER_CHUNKS = 600  # ~60 s of 100 ms chunks while reconnecting
SILENCE_DBFS = -45.0


class _Normaliser:
    """Turns Live API transcription messages into interim/final utterances.

    Tolerates both server styles: one ``input_transcription`` per utterance
    (``finished=True``), or incremental pieces that we join and flush on
    ``finished``/``turn_complete``/sentence end/short timeout.
    """

    FLUSH_AFTER = 0.8  # seconds without new final pieces

    def __init__(self, stream: ASRStream) -> None:
        self.stream = stream
        self.pending: list[str] = []
        self.last_piece = 0.0

    def interim(self, text: str) -> None:
        prefix = " ".join(self.pending)
        self.stream._emit(f"{prefix} {text}".strip(), final=False)

    def final_piece(self, text: str, finished: bool | None) -> None:
        if text and text.strip():
            self.pending.append(text.strip())
            self.last_piece = time.monotonic()
        joined = " ".join(self.pending)
        if finished or joined.endswith(SENTENCE_END):
            self.flush()

    def flush(self) -> None:
        if self.pending:
            self.stream._emit(" ".join(self.pending), final=True)
            self.pending.clear()

    def tick(self) -> None:
        if self.pending and time.monotonic() - self.last_piece > self.FLUSH_AFTER:
            self.flush()


class _Connection:
    def __init__(self, owner: GeminiLiveASR) -> None:
        self.owner = owner
        self.norm = _Normaliser(owner)
        self._cm = None
        self.session = None
        self.alive = False
        self._recv_task: asyncio.Task | None = None
        self._tick_task: asyncio.Task | None = None
        self.opened_at = 0.0

    async def open(self) -> None:
        self._cm = self.owner._client.aio.live.connect(
            model=self.owner.settings.gemini_asr_model, config=self.owner._live_config()
        )
        self.session = await self._cm.__aenter__()
        self.alive = True
        self.opened_at = time.monotonic()
        self._recv_task = asyncio.create_task(self._recv())
        self._tick_task = asyncio.create_task(self._tick())

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(0.2)
            self.norm.tick()

    async def _recv(self) -> None:
        try:
            while True:
                async for msg in self.session.receive():
                    sc = msg.server_content
                    if msg.go_away is not None:
                        log.info("gemini go_away received; rotating early")
                        self.owner._rotate_now = True
                    if sc is None:
                        continue
                    if sc.interim_input_transcription and sc.interim_input_transcription.text:
                        self.norm.interim(sc.interim_input_transcription.text)
                    if sc.input_transcription is not None:
                        self.norm.final_piece(
                            sc.input_transcription.text or "", sc.input_transcription.finished
                        )
                    if sc.turn_complete:
                        self.norm.flush()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - connection closed / API error
            log.info("gemini live connection ended: %s", exc)
        finally:
            self.norm.flush()
            self.alive = False

    async def send(self, chunk: bytes) -> None:
        from google.genai import types

        await self.session.send_realtime_input(
            audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={self.owner.rate}")
        )

    async def drain_and_close(self, timeout: float = 4.0) -> None:
        """Signal end of audio so the server finalises the last utterance, then close."""
        try:
            if self.alive:
                with contextlib.suppress(Exception):
                    await self.session.send_realtime_input(audio_stream_end=True)
                with contextlib.suppress(asyncio.TimeoutError, Exception):
                    await asyncio.wait_for(asyncio.shield(self._recv_task), timeout)
        finally:
            await self.close()

    async def close(self) -> None:
        await cancel_task(self._recv_task)
        await cancel_task(self._tick_task)
        self.norm.flush()
        if self._cm is not None:
            with contextlib.suppress(Exception):
                await self._cm.__aexit__(None, None, None)
            self._cm = None
        self.alive = False


class GeminiLiveASR(ASRStream):
    def __init__(
        self,
        settings: Settings,
        source_lang: str = "en",
        glossary: list[str] | None = None,
        client=None,
    ) -> None:
        super().__init__()
        self.settings = settings
        self.rate = settings.sample_rate
        self.source_lang = source_lang
        self.glossary = glossary or []
        self._client = client or self._make_client()
        self._audio: deque[bytes] = deque(maxlen=MAX_BUFFER_CHUNKS)
        self._audio_event = asyncio.Event()
        self._closed = False
        self._rotate_now = False
        self._runner: asyncio.Task | None = None
        self._draining: set[asyncio.Task] = set()
        self._last_voice = 0.0

    def _make_client(self):
        from google import genai

        key = self.settings.gemini_api_key or None  # None -> GEMINI_API_KEY/GOOGLE_API_KEY/Vertex
        return genai.Client(api_key=key) if key else genai.Client()

    def _live_config(self):
        from google.genai import types

        transcription = types.AudioTranscriptionConfig(
            language_codes=[self.source_lang] if self.source_lang != "auto" else None,
            custom_vocabulary=self.glossary or None,
            mode=types.AudioTranscriptionConfigMode.SMART
            if self.settings.gemini_asr_smart_mode
            else None,
        )
        return types.LiveConnectConfig(
            response_modalities=[types.Modality.TEXT],
            input_audio_transcription=transcription,
        )

    async def start(self) -> None:
        self._runner = asyncio.create_task(self._run(), name="gemini-asr")

    async def send(self, pcm16: bytes) -> None:
        if self._closed:
            return
        if level_dbfs(pcm16) > SILENCE_DBFS:
            self._last_voice = time.monotonic()
        self._audio.append(pcm16)
        self._audio_event.set()

    async def close(self) -> None:
        self._closed = True
        self._audio_event.set()
        if self._runner:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._runner, timeout=8)
            await cancel_task(self._runner)
        for task in list(self._draining):
            with contextlib.suppress(Exception):
                await asyncio.wait_for(task, timeout=5)
        self._finish()

    def _should_rotate(self, conn: _Connection) -> bool:
        if self._rotate_now:
            return True
        age = time.monotonic() - conn.opened_at
        rotate_at = self.settings.gemini_asr_rotate_seconds
        if age < rotate_at:
            return False
        in_pause = time.monotonic() - self._last_voice > 0.4
        # prefer a pause; force it before the hard cap (~60 s of slack)
        return in_pause or age > rotate_at + 45

    async def _run(self) -> None:
        conn: _Connection | None = None
        backoff = 0.5
        while not self._closed:
            if conn is None or not conn.alive or self._should_rotate(conn):
                try:
                    new = _Connection(self)
                    await new.open()
                except Exception as exc:  # noqa: BLE001
                    log.warning("gemini live connect failed (%s); retry in %.1fs", exc, backoff)
                    self._error(f"connect: {exc}")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 10)
                    continue
                backoff = 0.5
                if conn is not None:
                    self.reconnects += 1
                    task = asyncio.create_task(conn.drain_and_close())
                    self._draining.add(task)
                    task.add_done_callback(self._draining.discard)
                conn = new
                self._rotate_now = False
            if not self._audio:
                self._audio_event.clear()
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(self._audio_event.wait(), timeout=0.5)
                continue
            chunk = self._audio[0]
            try:
                await conn.send(chunk)
                self._audio.popleft()
            except Exception as exc:  # noqa: BLE001 - keep chunk, reconnect
                log.info("gemini send failed (%s); reconnecting", exc)
                self._error(f"send: {exc}")
                conn.alive = False
        if conn is not None:
            await conn.drain_and_close()
