"""Per-stage processing pipeline.

audio (PCM16) ─▶ ASRStream ─▶ Segmenter ─▶ source captions ─▶ Broker ─▶ audience
                                 │
                                 └─▶ Translator × N languages (concurrent,
                                     published in order) ─▶ Broker ─▶ audience
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque

from . import metrics
from .asr import ASRStream
from .audio import duration_seconds, level_dbfs
from .broker import Broker
from .config import Settings
from .models import CaptionEvent, Session
from .mt import Translator
from .segmenter import Segmenter

log = logging.getLogger(__name__)

SPEECH_DBFS = -45.0


class _Ema:
    def __init__(self, alpha: float = 0.3) -> None:
        self.alpha = alpha
        self.value: float | None = None

    def add(self, x: float) -> None:
        self.value = x if self.value is None else self.alpha * x + (1 - self.alpha) * self.value


class _OrderedLane:
    """Translations for one language: run concurrently, publish strictly in order."""

    def __init__(self) -> None:
        # (translation task, segment id, monotonic time the source was committed)
        self.queue: asyncio.Queue[tuple[asyncio.Task, int, float] | None] = asyncio.Queue()
        self.worker: asyncio.Task | None = None


class SessionPipeline:
    def __init__(
        self,
        session: Session,
        broker: Broker,
        asr: ASRStream,
        translator: Translator | None,
        settings: Settings,
    ) -> None:
        self.session = session
        self.broker = broker
        self.asr = asr
        self.translator = translator
        self.settings = settings
        self.segmenter = Segmenter(settings.early_commit)
        self.context: deque[str] = deque(maxlen=max(0, settings.mt_context_segments))
        self.targets = [t for t in session.target_langs if t != session.source_lang]
        self._lanes: dict[str, _OrderedLane] = {}
        self._consumer: asyncio.Task | None = None
        self._status_task: asyncio.Task | None = None
        self._segment = 0
        self.stopped = False
        # live stats
        self.level_db = -90.0
        self.audio_seconds = 0.0
        self.started_at = time.time()
        self.first_caption = _Ema()
        self.mt_latency = _Ema()
        self.mt_chars = 0
        self.mt_errors = 0
        self.last_error = ""
        self._speech_start: float | None = None
        self._silence_since = float("-inf")  # silent until the first voiced chunk
        self._awaiting_first = False

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        self._segment = await self.broker.next_seq(self.session.id, "segment")
        await self.asr.start()
        for lang in self.targets if self.translator else []:
            lane = _OrderedLane()
            lane.worker = asyncio.create_task(self._lane_worker(lang, lane))
            self._lanes[lang] = lane
        self._consumer = asyncio.create_task(self._consume(), name=f"asr-{self.session.id}")
        self._status_task = asyncio.create_task(self._status_loop())
        metrics.ACTIVE_INGESTS.inc()
        await self._publish_status(live=True)

    async def stop(self) -> None:
        """Flush ASR, wait for pending translations, announce offline. Idempotent."""
        if self.stopped:
            return
        self.stopped = True
        try:
            await self.asr.close()
            if self._consumer:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(self._consumer, timeout=10)
            for lane in self._lanes.values():
                lane.queue.put_nowait(None)
            for lane in self._lanes.values():
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(
                        lane.worker, timeout=self.settings.mt_timeout_seconds + 2
                    )
        finally:
            for task in [
                self._consumer,
                self._status_task,
                *(l.worker for l in self._lanes.values()),
            ]:
                if task and not task.done():
                    task.cancel()
            metrics.ACTIVE_INGESTS.dec()
            await self._publish_status(live=False)

    # ------------------------------------------------------------------ audio in
    async def feed(self, pcm16: bytes) -> None:
        if self.stopped:
            return
        now = time.monotonic()
        self.level_db = level_dbfs(pcm16)
        dur = duration_seconds(pcm16, self.settings.sample_rate)
        self.audio_seconds += dur
        metrics.AUDIO_SECONDS.labels(self.session.id).inc(dur)
        if self.level_db > SPEECH_DBFS:
            if self._speech_start is None and now - self._silence_since > 0.5:
                self._speech_start = now
                self._awaiting_first = True
            self._silence_since = now
        elif now - self._silence_since > 0.5:
            self._speech_start = None
        await self.asr.send(pcm16)

    # ------------------------------------------------------------------ ASR out
    async def _consume(self) -> None:
        try:
            async for tr in self.asr:
                if tr.final:
                    await self._on_final(tr.text)
                else:
                    await self._on_interim(tr.text)
        except Exception:
            log.exception("ASR consumer crashed for %s", self.session.id)

    async def _on_interim(self, text: str) -> None:
        if self._awaiting_first and self._speech_start is not None:
            latency = time.monotonic() - self._speech_start
            self.first_caption.add(latency)
            metrics.FIRST_CAPTION.observe(latency)
            self._awaiting_first = False
        commits, tail = self.segmenter.interim(text)
        for sentence in commits:
            await self._commit(sentence)
        await self.broker.publish(
            CaptionEvent(
                type="interim",
                session=self.session.id,
                lang="source",
                text=tail,
                segment=self._segment,
                source_lang=self.session.source_lang,
            )
        )

    async def _on_final(self, text: str) -> None:
        remainder = self.segmenter.final(text)
        if remainder:
            await self._commit(remainder)
        # clear the interim line
        await self.broker.publish(
            CaptionEvent(
                type="interim",
                session=self.session.id,
                lang="source",
                text="",
                segment=self._segment,
                source_lang=self.session.source_lang,
            )
        )

    async def _commit(self, text: str) -> None:
        segment = self._segment
        self._segment = await self.broker.next_seq(self.session.id, "segment")
        seq = await self.broker.next_seq(self.session.id, "source")
        await self.broker.publish(
            CaptionEvent(
                type="final",
                session=self.session.id,
                lang="source",
                text=text,
                seq=seq,
                segment=segment,
                source_lang=self.session.source_lang,
            )
        )
        metrics.CAPTIONS.labels(self.session.id, "source").inc()
        context = list(self.context)
        self.context.append(text)
        committed_at = time.monotonic()
        for lang, lane in self._lanes.items():
            task = asyncio.create_task(self._translate(text, lang, context))
            lane.queue.put_nowait((task, segment, committed_at))

    # ------------------------------------------------------------------ translation
    async def _translate(self, text: str, lang: str, context: list[str]) -> tuple[str, bool]:
        assert self.translator is not None
        self.mt_chars += len(text)
        metrics.MT_CHARS.inc(len(text))
        try:
            out = await asyncio.wait_for(
                self.translator.translate(
                    text, self.session.source_lang, lang, context, self.session.glossary
                ),
                timeout=self.settings.mt_timeout_seconds,
            )
            if out:
                return out, False
        except Exception as exc:  # noqa: BLE001
            log.warning("translation to %s failed: %s", lang, exc)
            self.last_error = f"translation {lang}: {exc!r}"[:300]
        else:
            self.last_error = f"translation {lang}: empty output"
        self.mt_errors += 1
        metrics.MT_ERRORS.inc()
        return text, True  # fall back to the original text rather than showing nothing

    async def _lane_worker(self, lang: str, lane: _OrderedLane) -> None:
        while True:
            item = await lane.queue.get()
            if item is None:
                return
            task, segment, committed_at = item
            try:
                text, fallback = await task
            except Exception:
                log.exception("translation task crashed (%s)", lang)
                continue
            latency = time.monotonic() - committed_at
            self.mt_latency.add(latency)
            metrics.MT_LATENCY.observe(latency)
            seq = await self.broker.next_seq(self.session.id, lang)
            await self.broker.publish(
                CaptionEvent(
                    type="final",
                    session=self.session.id,
                    lang=lang,
                    text=text,
                    seq=seq,
                    segment=segment,
                    source_lang=self.session.source_lang,
                    latency_ms=int(latency * 1000),
                    data={"fallback": True} if fallback else None,
                )
            )
            metrics.CAPTIONS.labels(self.session.id, lang).inc()

    # ------------------------------------------------------------------ status
    def stats(self, live: bool = True) -> dict:
        def ms(ema: _Ema) -> int | None:
            return None if ema.value is None else int(ema.value * 1000)

        return {
            "live": live,
            "level_db": round(self.level_db, 1),
            "audio_seconds": round(self.audio_seconds, 1),
            "started_at": self.started_at,
            "asr_reconnects": self.asr.reconnects,
            "first_caption_ms": ms(self.first_caption),
            "translation_ms": ms(self.mt_latency),
            "mt_chars": self.mt_chars,
            "mt_errors": self.mt_errors,
            "asr_errors": self.asr.errors,
            "last_error": self.asr.last_error or self.last_error,
            "est_cost_usd": round(
                self.audio_seconds / 60 * self.settings.asr_cost_per_minute
                + self.mt_chars / 1000 * self.settings.mt_cost_per_1k_chars,
                4,
            ),
        }

    async def _publish_status(self, live: bool = True) -> None:
        data = self.stats(live)
        with contextlib.suppress(Exception):
            await self.broker.set_status(self.session.id, data, ttl=6 if live else 1)
            await self.broker.publish(
                CaptionEvent(type="status", session=self.session.id, lang="*", data=data)
            )

    async def _status_loop(self) -> None:
        last_reconnects = 0
        while True:
            await asyncio.sleep(1.0)
            if self.asr.reconnects != last_reconnects:
                metrics.ASR_RECONNECTS.inc(self.asr.reconnects - last_reconnects)
                last_reconnects = self.asr.reconnects
            await self._publish_status(live=True)
