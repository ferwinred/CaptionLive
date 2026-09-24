import asyncio
import random

from captionlive.asr.mock import MockASR
from captionlive.broker import MemoryBroker
from captionlive.models import Session
from captionlive.mt.mock import MockTranslator
from captionlive.pipeline import SessionPipeline

from .conftest import chunks, tone

SCRIPT = ["Hello everyone. Welcome to the talk.", "Kubernetes operators are great."]


async def run_pipeline(settings, translator, seconds=6.0, targets=("es", "pt")):
    broker = MemoryBroker()
    session = Session(
        id="main", source_lang="en", target_langs=list(targets), glossary=["Kubernetes"]
    )
    asr = MockASR(words_per_second=4, script=SCRIPT)
    pipe = SessionPipeline(session, broker, asr, translator, settings)
    await pipe.start()
    for c in chunks(tone(seconds)):
        await pipe.feed(c)
    await pipe.stop()
    return broker, pipe


async def test_end_to_end_with_translation(settings):
    broker, pipe = await run_pipeline(settings, MockTranslator())
    src = [e.text for e in await broker.history("main", "source")]
    # early commit splits the first utterance into two sentences
    assert src[:3] == ["Hello everyone.", "Welcome to the talk.", "Kubernetes operators are great."]
    es = await broker.history("main", "es")
    pt = await broker.history("main", "pt")
    assert [e.text for e in es][:3] == [f"[es] {t}" for t in src[:3]]
    assert [e.text for e in pt][:3] == [f"[pt] {t}" for t in src[:3]]
    # translations share the segment id of their source sentence
    src_events = await broker.history("main", "source")
    assert [e.segment for e in es] == [e.segment for e in src_events]
    assert all(e.latency_ms is not None for e in es)
    stats = pipe.stats()
    assert stats["audio_seconds"] == 6.0 and stats["mt_chars"] > 0
    assert stats["first_caption_ms"] is not None
    assert (await broker.get_status("main"))["live"] is False


async def test_translations_published_in_order_despite_random_latency(settings):
    class Jittery(MockTranslator):
        async def translate(self, text, *a, **k):
            await asyncio.sleep(random.uniform(0, 0.05))
            return await super().translate(text, *a, **k)

    broker, _ = await run_pipeline(settings, Jittery(), seconds=12)
    es = await broker.history("main", "es")
    assert [e.seq for e in es] == sorted(e.seq for e in es)
    assert [e.segment for e in es] == sorted(e.segment for e in es)


async def test_failed_translation_falls_back_to_source(settings):
    class Broken(MockTranslator):
        async def translate(self, *a, **k):
            raise RuntimeError("quota exceeded")

    broker, pipe = await run_pipeline(settings, Broken(), targets=("es",))
    es = await broker.history("main", "es")
    assert es and es[0].text == "Hello everyone." and es[0].data == {"fallback": True}
    assert pipe.stats()["mt_errors"] == len(es)
    assert "quota exceeded" in pipe.stats()["last_error"]


async def test_translation_timeout(settings):
    settings.mt_timeout_seconds = 0.05
    broker, _ = await run_pipeline(settings, MockTranslator(delay=1), seconds=3, targets=("es",))
    es = await broker.history("main", "es")
    assert es and all(e.data == {"fallback": True} for e in es)


async def test_no_translator_only_source(settings):
    broker, _ = await run_pipeline(settings, None)
    assert await broker.history("main", "source")
    assert await broker.history("main", "es") == []


async def test_source_language_not_translated_to_itself(settings):
    tr = MockTranslator()
    await run_pipeline(settings, tr, seconds=3, targets=("en", "es"))
    assert {c[2] for c in tr.calls} == {"es"}


async def test_context_and_glossary_reach_translator(settings):
    seen = []

    class Spy(MockTranslator):
        async def translate(self, text, source_lang, target_lang, context=None, glossary=None):
            seen.append((text, list(context), list(glossary)))
            return text

    await run_pipeline(settings, Spy(), seconds=6, targets=("es",))
    assert seen[0][1] == [] and seen[0][2] == ["Kubernetes"]
    assert seen[1][1] == ["Hello everyone."]
