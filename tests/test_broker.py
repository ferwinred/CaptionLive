import asyncio
import os

import pytest

from captionlive.broker import QUEUE_SIZE, MemoryBroker, RedisBroker
from captionlive.models import CaptionEvent, Session

REDIS_URL = os.environ.get("CL_TEST_REDIS_URL")


def final(session, lang, seq, text="x"):
    return CaptionEvent(type="final", session=session, lang=lang, seq=seq, text=text)


@pytest.fixture(params=["memory", "redis"])
async def broker(request):
    if request.param == "memory":
        b = MemoryBroker(history_size=5)
    else:
        if not REDIS_URL:
            pytest.skip("set CL_TEST_REDIS_URL to run Redis tests")
        b = RedisBroker(REDIS_URL, history_size=5)
        await b._redis.flushdb()
    await b.start()
    yield b
    await b.close()


async def test_sessions_crud(broker):
    s = Session(id="main", title="Main", target_langs=["es", "pt"])
    await broker.save_session(s)
    got = await broker.get_session("main")
    assert got.title == "Main" and got.ingest_key == s.ingest_key
    assert [x.id for x in await broker.list_sessions()] == ["main"]
    await broker.delete_session("main")
    assert await broker.get_session("main") is None


async def test_history_is_capped_and_filterable(broker):
    for i in range(1, 9):
        await broker.publish(final("s", "es", await broker.next_seq("s", "es"), f"t{i}"))
    await broker.publish(CaptionEvent(type="interim", session="s", lang="source", text="…"))
    hist = await broker.history("s", "es")
    assert [e.text for e in hist] == ["t4", "t5", "t6", "t7", "t8"]
    assert [e.seq for e in await broker.history("s", "es", after_seq=6)] == [7, 8]
    assert len(await broker.history("s", "es", limit=2)) == 2
    assert await broker.history("s", "source") == []  # interims are not stored
    await broker.clear_history("s")
    assert await broker.history("s", "es") == []
    assert await broker.next_seq("s", "es") == 1  # counters reset too


async def test_fanout_to_subscribers(broker):
    async with (
        broker.subscribe("s") as q1,
        broker.subscribe("s") as q2,
        broker.subscribe("other") as q3,
    ):
        assert broker.hub.listeners("s") == 2
        await broker.publish(final("s", "es", 1, "hola"))
        e1 = await asyncio.wait_for(q1.get(), 2)
        e2 = await asyncio.wait_for(q2.get(), 2)
        assert e1.text == e2.text == "hola"
        assert q3.empty()
    assert broker.hub.listeners() == 0


async def test_ingest_lock(broker):
    assert await broker.acquire_ingest("s", "a")
    assert await broker.acquire_ingest("s", "a")  # refresh by owner
    assert not await broker.acquire_ingest("s", "b")
    await broker.release_ingest("s", "b")  # not the owner: no-op
    assert not await broker.acquire_ingest("s", "b")
    await broker.release_ingest("s", "a")
    assert await broker.acquire_ingest("s", "b")


async def test_status_ttl(broker):
    await broker.set_status("s", {"live": True}, ttl=5)
    assert (await broker.get_status("s"))["live"] is True
    assert await broker.get_status("nope") is None


async def test_slow_consumer_drops_oldest():
    b = MemoryBroker()
    async with b.subscribe("s") as q:
        for i in range(QUEUE_SIZE + 10):
            b.hub.dispatch(final("s", "es", i + 1))
        assert q.qsize() == QUEUE_SIZE
        assert (await q.get()).seq == 11
