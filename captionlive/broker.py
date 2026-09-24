"""State + fan-out layer.

``MemoryBroker`` keeps everything in-process (dev, single node).
``RedisBroker`` makes the web tier stateless so it can scale horizontally:

* sessions live in a Redis hash,
* final captions are appended to capped lists (history / export / late joiners),
* every event is PUBLISHed once and each node fans it out locally to its own
  audience connections (one Redis subscription per node, not per viewer),
* a per-session lock guarantees a single active ingest (one ASR stream) per stage.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from collections.abc import AsyncIterator

from .models import CaptionEvent, Session

log = logging.getLogger(__name__)

QUEUE_SIZE = 256


class Hub:
    """Local (per-process) fan-out of events to audience connections."""

    def __init__(self) -> None:
        self._listeners: dict[str, set[asyncio.Queue[CaptionEvent]]] = defaultdict(set)

    def listeners(self, session: str | None = None) -> int:
        if session is not None:
            return len(self._listeners.get(session, ()))
        return sum(len(v) for v in self._listeners.values())

    def dispatch(self, event: CaptionEvent) -> None:
        for queue in list(self._listeners.get(event.session, ())):
            if queue.full():  # slow client: drop the oldest update, never block the pipeline
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(event)

    @contextlib.asynccontextmanager
    async def subscribe(self, session: str) -> AsyncIterator[asyncio.Queue[CaptionEvent]]:
        queue: asyncio.Queue[CaptionEvent] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._listeners[session].add(queue)
        try:
            yield queue
        finally:
            self._listeners[session].discard(queue)
            if not self._listeners[session]:
                self._listeners.pop(session, None)


class Broker(ABC):
    def __init__(self, history_size: int = 2000) -> None:
        self.hub = Hub()
        self.history_size = history_size

    async def start(self) -> None:  # pragma: no cover - trivial
        pass

    async def close(self) -> None:  # pragma: no cover - trivial
        pass

    def subscribe(self, session: str):
        return self.hub.subscribe(session)

    # sessions
    @abstractmethod
    async def save_session(self, session: Session) -> None: ...
    @abstractmethod
    async def get_session(self, session_id: str) -> Session | None: ...
    @abstractmethod
    async def list_sessions(self) -> list[Session]: ...
    @abstractmethod
    async def delete_session(self, session_id: str) -> None: ...

    # captions
    @abstractmethod
    async def next_seq(self, session: str, lang: str) -> int: ...
    @abstractmethod
    async def publish(self, event: CaptionEvent) -> None: ...
    @abstractmethod
    async def history(
        self, session: str, lang: str, after_seq: int = 0, limit: int | None = None
    ) -> list[CaptionEvent]: ...
    @abstractmethod
    async def clear_history(self, session: str) -> None: ...

    # ingest ownership + live status
    @abstractmethod
    async def acquire_ingest(self, session: str, owner: str, ttl: int = 15) -> bool: ...
    @abstractmethod
    async def release_ingest(self, session: str, owner: str) -> None: ...
    @abstractmethod
    async def set_status(self, session: str, status: dict, ttl: int = 10) -> None: ...
    @abstractmethod
    async def get_status(self, session: str) -> dict | None: ...


class MemoryBroker(Broker):
    def __init__(self, history_size: int = 2000) -> None:
        super().__init__(history_size)
        self._sessions: dict[str, Session] = {}
        self._seq: dict[tuple[str, str], int] = defaultdict(int)
        self._history: dict[tuple[str, str], deque[CaptionEvent]] = defaultdict(
            lambda: deque(maxlen=self.history_size)
        )
        self._locks: dict[str, tuple[str, float]] = {}
        self._status: dict[str, tuple[dict, float]] = {}

    async def save_session(self, session: Session) -> None:
        self._sessions[session.id] = session

    async def get_session(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    async def list_sessions(self) -> list[Session]:
        return sorted(self._sessions.values(), key=lambda s: s.created_at)

    async def delete_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        await self.clear_history(session_id)

    async def next_seq(self, session: str, lang: str) -> int:
        self._seq[(session, lang)] += 1
        return self._seq[(session, lang)]

    async def publish(self, event: CaptionEvent) -> None:
        if event.type == "final":
            self._history[(event.session, event.lang)].append(event)
        self.hub.dispatch(event)

    async def history(self, session, lang, after_seq=0, limit=None):
        items = [e for e in self._history.get((session, lang), ()) if e.seq > after_seq]
        return items[-limit:] if limit else items

    async def clear_history(self, session: str) -> None:
        for key in [k for k in self._history if k[0] == session]:
            self._history.pop(key, None)
        for key in [k for k in self._seq if k[0] == session]:
            self._seq.pop(key, None)

    async def acquire_ingest(self, session, owner, ttl=15):
        now = time.monotonic()
        current = self._locks.get(session)
        if current and current[0] != owner and current[1] > now:
            return False
        self._locks[session] = (owner, now + ttl)
        return True

    async def release_ingest(self, session, owner):
        if self._locks.get(session, ("",))[0] == owner:
            self._locks.pop(session, None)

    async def set_status(self, session, status, ttl=10):
        self._status[session] = (status, time.monotonic() + ttl)

    async def get_status(self, session):
        item = self._status.get(session)
        if not item or item[1] < time.monotonic():
            return None
        return item[0]


class RedisBroker(Broker):
    PREFIX = "cl"

    def __init__(self, url: str, history_size: int = 2000) -> None:
        super().__init__(history_size)
        import redis.asyncio as aioredis

        self._redis = aioredis.from_url(url, decode_responses=True)
        self._listener_task: asyncio.Task | None = None

    def _k(self, *parts: str) -> str:
        return ":".join((self.PREFIX, *parts))

    async def start(self) -> None:
        await self._redis.ping()
        self._listener_task = asyncio.create_task(self._listen(), name="redis-listener")

    async def close(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._listener_task
        await self._redis.aclose()

    async def _listen(self) -> None:
        """One pattern subscription per node; events are fanned out locally."""
        while True:
            try:
                pubsub = self._redis.pubsub()
                await pubsub.psubscribe(self._k("ev", "*"))
                async for message in pubsub.listen():
                    if message.get("type") != "pmessage":
                        continue
                    try:
                        self.hub.dispatch(CaptionEvent.model_validate_json(message["data"]))
                    except Exception:
                        log.exception("bad event on redis channel")
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("redis listener crashed; reconnecting in 1s")
                await asyncio.sleep(1)

    async def save_session(self, session: Session) -> None:
        await self._redis.hset(self._k("sessions"), session.id, session.model_dump_json())

    async def get_session(self, session_id: str) -> Session | None:
        raw = await self._redis.hget(self._k("sessions"), session_id)
        return Session.model_validate_json(raw) if raw else None

    async def list_sessions(self) -> list[Session]:
        raw = await self._redis.hgetall(self._k("sessions"))
        return sorted(
            (Session.model_validate_json(v) for v in raw.values()), key=lambda s: s.created_at
        )

    async def delete_session(self, session_id: str) -> None:
        await self._redis.hdel(self._k("sessions"), session_id)
        await self.clear_history(session_id)

    async def next_seq(self, session: str, lang: str) -> int:
        return int(await self._redis.incr(self._k("seq", session, lang)))

    async def publish(self, event: CaptionEvent) -> None:
        payload = event.model_dump_json()
        async with self._redis.pipeline(transaction=False) as pipe:
            if event.type == "final":
                key = self._k("hist", event.session, event.lang)
                pipe.rpush(key, payload)
                pipe.ltrim(key, -self.history_size, -1)
            pipe.publish(self._k("ev", event.session), payload)
            await pipe.execute()

    async def history(self, session, lang, after_seq=0, limit=None):
        raw = await self._redis.lrange(self._k("hist", session, lang), 0, -1)
        items = [CaptionEvent.model_validate_json(r) for r in raw]
        items = [e for e in items if e.seq > after_seq]
        return items[-limit:] if limit else items

    async def clear_history(self, session: str) -> None:
        keys = [k async for k in self._redis.scan_iter(self._k("hist", session, "*"))]
        keys += [k async for k in self._redis.scan_iter(self._k("seq", session, "*"))]
        if keys:
            await self._redis.delete(*keys)

    _ACQUIRE = """
    local cur = redis.call('GET', KEYS[1])
    if (not cur) or cur == ARGV[1] then
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      return 1
    end
    return 0
    """
    _RELEASE = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
    return 0
    """

    async def acquire_ingest(self, session, owner, ttl=15):
        return bool(await self._redis.eval(self._ACQUIRE, 1, self._k("lock", session), owner, ttl))

    async def release_ingest(self, session, owner):
        await self._redis.eval(self._RELEASE, 1, self._k("lock", session), owner)

    async def set_status(self, session, status, ttl=10):
        await self._redis.set(self._k("status", session), json.dumps(status), ex=ttl)

    async def get_status(self, session):
        raw = await self._redis.get(self._k("status", session))
        return json.loads(raw) if raw else None


def create_broker(kind: str, redis_url: str, history_size: int) -> Broker:
    if kind == "redis":
        return RedisBroker(redis_url, history_size)
    return MemoryBroker(history_size)
