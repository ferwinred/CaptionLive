"""Real server (uvicorn) + real WebSocket ingest + real SSE audience connections."""

import asyncio
import contextlib
import json
import os
import socket

import httpx
import pytest
import uvicorn
import websockets

from captionlive.broker import RedisBroker
from captionlive.main import create_app
from captionlive.mt.mock import MockTranslator

from .conftest import chunks, tone

REDIS_URL = os.environ.get("CL_TEST_REDIS_URL")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, settings, broker=None):
        self.port = free_port()
        app = create_app(settings, broker=broker, translator=MockTranslator())
        self.server = uvicorn.Server(uvicorn.Config(app, port=self.port, log_level="warning"))
        self.base = f"http://127.0.0.1:{self.port}"

    async def __aenter__(self):
        self.task = asyncio.create_task(self.server.serve())
        while not self.server.started:
            await asyncio.sleep(0.02)
        return self

    async def __aexit__(self, *exc):
        self.server.should_exit = True
        await self.task


async def read_sse(base, sid, langs, events, headers=None, stop_after=None, backlog=30):
    async with (
        httpx.AsyncClient(timeout=None) as http,
        http.stream(
            "GET",
            f"{base}/api/sessions/{sid}/stream",
            params={"langs": langs, "backlog": backlog},
            headers=headers or {},
        ) as resp,
    ):
        assert resp.status_code == 200
        current = {}
        async for line in resp.aiter_lines():
            if line.startswith("event: "):
                current["event"] = line[7:]
            elif line.startswith("id: "):
                current["id"] = line[4:]
            elif line.startswith("data: "):
                current["data"] = json.loads(line[6:])
            elif line == "" and current:
                events.append(current)
                current = {}
                if stop_after and stop_after(events):
                    return


async def ingest(base, sid, key, seconds):
    url = base.replace("http", "ws") + f"/ws/ingest/{sid}?key={key}&rate=16000"
    async with websockets.connect(url) as ws:
        assert json.loads(await ws.recv())["type"] == "ready"
        for c in chunks(tone(seconds)):
            await ws.send(c)
            await asyncio.sleep(0.005)


async def make_session(base, sid="main"):
    async with httpx.AsyncClient(
        base_url=base, headers={"Authorization": "Bearer test-token"}
    ) as h:
        r = await h.post("/api/admin/sessions", json={"id": sid, "target_langs": ["es"]})
        return r.json()["ingest_key"]


def finals(events, lang):
    return [e["data"] for e in events if e.get("event") == "final" and e["data"]["lang"] == lang]


async def test_live_sse_and_resume(settings):
    async with Server(settings) as srv:
        key = await make_session(srv.base)
        events = []
        reader = asyncio.create_task(
            read_sse(
                srv.base,
                "main",
                "es,source",
                events,
                stop_after=lambda ev: len(finals(ev, "es")) >= 3,
            )
        )
        await asyncio.sleep(0.2)
        await ingest(srv.base, "main", key, seconds=8)
        await asyncio.wait_for(reader, 10)

        kinds = {e["event"] for e in events}
        assert {"status", "interim", "final"} <= kinds
        assert any(e["event"] == "status" and e["data"]["data"]["live"] for e in events)
        es = finals(events, "es")
        assert [e["seq"] for e in es] == [1, 2, 3]
        assert es[0]["text"].startswith("[es] Welcome")
        last_id = [e["id"] for e in events if "id" in e][-1]
        assert "es=" in last_id and "source=" in last_id

        # reconnect with Last-Event-ID: only captions after that point are replayed
        resumed = []
        await asyncio.wait_for(
            read_sse(
                srv.base,
                "main",
                "es,source",
                resumed,
                headers={"Last-Event-ID": "es=2,source=2"},
                stop_after=lambda ev: (
                    any(e.get("event") == "final" for e in ev) and len(finals(ev, "es")) >= 1
                ),
            ),
            5,
        )
        assert finals(resumed, "es")[0]["seq"] == 3


@pytest.mark.skipif(not REDIS_URL, reason="set CL_TEST_REDIS_URL for multi-node test")
async def test_multi_node_via_redis(settings):
    settings.broker = "redis"
    b1, b2 = RedisBroker(REDIS_URL), RedisBroker(REDIS_URL)
    await b1.start()
    await b1._redis.flushdb()
    await b1.close()
    b1 = RedisBroker(REDIS_URL)
    async with Server(settings, b1) as node_a, Server(settings, b2) as node_b:
        key = await make_session(node_a.base, "multi")
        events = []
        # audience on node B, stage audio on node A
        reader = asyncio.create_task(
            read_sse(
                node_b.base, "multi", "es", events, stop_after=lambda ev: len(finals(ev, "es")) >= 2
            )
        )
        await asyncio.sleep(0.3)
        await ingest(node_a.base, "multi", key, seconds=6)
        await asyncio.wait_for(reader, 10)
        assert len(finals(events, "es")) >= 2
        # the ingest lock is shared: a second source on node B is rejected while A streams
        url = node_b.base.replace("http", "ws") + f"/ws/ingest/multi?key={key}"
        url_a = node_a.base.replace("http", "ws") + f"/ws/ingest/multi?key={key}"
        async with websockets.connect(url_a) as first:
            assert json.loads(await first.recv())["type"] == "ready"
            async with websockets.connect(url) as second:
                with pytest.raises(websockets.ConnectionClosed) as exc:
                    await second.recv()
                assert exc.value.rcvd.code == 4409


async def test_backlog_zero_sends_no_history(settings):
    async with Server(settings) as srv:
        key = await make_session(srv.base)
        await ingest(srv.base, "main", key, seconds=6)
        events = []
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(
                read_sse(srv.base, "main", "es", events, stop_after=lambda ev: False, backlog=0), 1
            )
        assert finals(events, "es") == []
        events = []
        await asyncio.wait_for(
            read_sse(srv.base, "main", "es", events, stop_after=lambda ev: len(ev) >= 2), 3
        )
        assert finals(events, "es")  # default backlog replays recent captions
