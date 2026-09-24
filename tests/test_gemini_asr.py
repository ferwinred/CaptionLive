"""GeminiLiveASR against a fake Live API (no network)."""

import asyncio
import contextlib

from google.genai import types

from captionlive.asr.gemini_live import GeminiLiveASR

from .conftest import chunks, silence, tone


def msg(interim=None, final=None, finished=None, turn_complete=None):
    return types.LiveServerMessage(
        server_content=types.LiveServerContent(
            interim_input_transcription=types.Transcription(text=interim) if interim else None,
            input_transcription=types.Transcription(text=final, finished=finished)
            if final is not None
            else None,
            turn_complete=turn_complete,
        )
    )


class FakeSession:
    """Emits an interim every 3 chunks and a final utterance every 6 chunks."""

    def __init__(self, n):
        self.n = n
        self.audio = []
        self.ended = False
        self.inbox = asyncio.Queue()

    async def send_realtime_input(self, audio=None, audio_stream_end=None):
        if audio_stream_end:
            self.ended = True
            self.inbox.put_nowait(msg(final=f"tail of connection {self.n}.", finished=True))
            self.inbox.put_nowait(None)
            return
        self.audio.append(audio.data)
        assert audio.mime_type == "audio/pcm;rate=16000"
        k = len(self.audio)
        if k % 6 == 0:
            self.inbox.put_nowait(msg(final=f"utterance {self.n}-{k}.", finished=True))
        elif k % 3 == 0:
            self.inbox.put_nowait(msg(interim=f"utterance {self.n}-{k}"))

    async def receive(self):
        item = await self.inbox.get()
        if item is None:
            raise ConnectionError("closed")
        yield item


class FakeClient:
    def __init__(self, fail_first=0):
        self.sessions = []
        self.configs = []
        self.fail_first = fail_first
        client = self

        class Live:
            def connect(self, model, config):
                client.configs.append((model, config))

                @contextlib.asynccontextmanager
                async def cm():
                    if client.fail_first > 0:
                        client.fail_first -= 1
                        raise ConnectionError("503 unavailable")
                    s = FakeSession(len(client.sessions) + 1)
                    client.sessions.append(s)
                    yield s

                return cm()

        class Aio:
            live = Live()

        self.aio = Aio()


async def collect(asr):
    return [t async for t in asr]


async def test_interim_and_final_and_config(settings):
    client = FakeClient()
    asr = GeminiLiveASR(settings, "en", ["Kubernetes", "eBPF"], client=client)
    await asr.start()
    results = asyncio.create_task(collect(asr))
    for c in list(chunks(tone(0.6))):
        await asr.send(c)
    await asyncio.sleep(0.2)
    await asr.close()
    out = await results
    assert (out[0].text, out[0].final) == ("utterance 1-3", False)
    assert (out[1].text, out[1].final) == ("utterance 1-6.", True)
    assert out[-1].text == "tail of connection 1." and out[-1].final
    model, config = client.configs[0]
    assert model == settings.gemini_asr_model
    assert config.input_audio_transcription.custom_vocabulary == ["Kubernetes", "eBPF"]
    assert config.input_audio_transcription.language_codes == ["en"]
    assert config.response_modalities == [types.Modality.TEXT]


async def test_auto_language_sends_no_codes(settings):
    client = FakeClient()
    asr = GeminiLiveASR(settings, "auto", [], client=client)
    cfg = asr._live_config()
    assert cfg.input_audio_transcription.language_codes is None
    assert cfg.input_audio_transcription.custom_vocabulary is None


async def test_rotation_is_lossless(settings):
    settings.gemini_asr_rotate_seconds = 0.3
    client = FakeClient()
    asr = GeminiLiveASR(settings, "en", [], client=client)
    await asr.start()
    results = asyncio.create_task(collect(asr))
    sent = 0
    for _ in range(3):  # speech then a pause, so rotation can happen in the pause
        for c in chunks(tone(0.2) + silence(1.0)):
            await asr.send(c)
            sent += 1
            await asyncio.sleep(0.05)  # ~real time (x2 speed)
    await asyncio.sleep(0.2)
    await asr.close()
    out = await results
    assert len(client.sessions) >= 2 and asr.reconnects >= 1
    assert all(s.ended for s in client.sessions)  # every connection was drained
    assert sum(len(s.audio) for s in client.sessions) == sent  # no chunk lost
    tails = [t.text for t in out if t.text.startswith("tail of connection")]
    assert len(tails) == len(client.sessions)


async def test_connect_failure_retries(settings):
    client = FakeClient(fail_first=2)
    asr = GeminiLiveASR(settings, "en", [], client=client)
    await asr.start()
    results = asyncio.create_task(collect(asr))
    for c in chunks(tone(0.6)):
        await asr.send(c)  # buffered while connecting
    await asyncio.sleep(2.0)
    await asr.close()
    out = await results
    assert asr.errors == 2 and "503" in asr.last_error
    assert len(client.sessions[0].audio) == 6  # buffered audio was replayed
    assert any(t.final for t in out)


async def test_incremental_final_pieces_are_joined(settings):
    asr = GeminiLiveASR(settings, "en", [], client=FakeClient())
    from captionlive.asr.gemini_live import _Normaliser

    norm = _Normaliser(asr)
    norm.final_piece("Hello", None)
    norm.interim("every")
    norm.final_piece("everyone", False)
    norm.final_piece("here.", None)  # sentence end flushes
    norm.final_piece("Next", None)
    norm.flush()
    items = []
    while not asr._out.empty():
        items.append(asr._out.get_nowait())
    assert [(t.text, t.final) for t in items] == [
        ("Hello every", False),
        ("Hello everyone here.", True),
        ("Next", True),
    ]
