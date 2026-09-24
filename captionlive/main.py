"""HTTP / WebSocket API and static web apps."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.websockets import WebSocketDisconnect, WebSocketState

from . import __version__, metrics
from .asr import create_asr
from .audio import resample_pcm16
from .broker import Broker, create_broker
from .config import Settings, get_settings
from .export import to_srt, to_txt, to_vtt
from .languages import LANGUAGES, language_name
from .models import CaptionEvent, Session, SessionIn
from .mt import Translator, create_translator
from .pipeline import SessionPipeline

log = logging.getLogger("captionlive")
WEB_DIR = Path(__file__).parent / "web"
HEARTBEAT_SECONDS = 15
BACKLOG = 30
SUMMARY_TTL = 60.0


def load_sessions_file(path: str) -> list[dict]:
    import yaml

    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return data.get("sessions", data if isinstance(data, list) else [])


def create_app(
    settings: Settings | None = None,
    broker: Broker | None = None,
    translator: Translator | None | str = "auto",
    asr_factory=None,
) -> FastAPI:
    settings = settings or get_settings()
    broker = broker or create_broker(settings.broker, settings.redis_url, settings.history_size)
    asr_factory = asr_factory or (lambda s: create_asr(settings, s.source_lang, s.glossary))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await broker.start()
        app.state.translator = create_translator(settings) if translator == "auto" else translator
        if settings.sessions_file:
            for raw in load_sessions_file(settings.sessions_file):
                existing = await broker.get_session(str(raw.get("id", "")).lower())
                data = {**(existing.model_dump() if existing else {}), **raw}
                await broker.save_session(Session(**data))
                log.info("bootstrapped session %s", data["id"])
        if settings.admin_token == "change-me":
            log.warning("CL_ADMIN_TOKEN is the default value - set a secret before going live")
        yield
        for pipeline in list(app.state.pipelines.values()):
            with contextlib.suppress(Exception):
                await pipeline.stop()
        if app.state.translator:
            await app.state.translator.close()
        await broker.close()

    app = FastAPI(title="CaptionLive", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.broker = broker
    app.state.pipelines: dict[str, SessionPipeline] = {}
    app.state.summaries: dict[tuple[str, str], tuple[float, int, str]] = {}
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------------ helpers
    def require_admin(
        authorization: str | None = Header(None), token: str | None = Query(None)
    ) -> None:
        supplied = token or (authorization or "").removeprefix("Bearer ").strip()
        if not supplied or not secrets.compare_digest(supplied, settings.admin_token):
            raise HTTPException(401, "invalid admin token")

    async def get_session_or_404(session_id: str) -> Session:
        session = await broker.get_session(session_id)
        if not session:
            raise HTTPException(404, "session not found")
        return session

    def resolve_lang(session: Session, lang: str) -> str:
        if lang in ("source", session.source_lang):
            return "source"
        if lang not in session.target_langs:
            raise HTTPException(400, f"language {lang!r} not enabled for this session")
        return lang

    async def with_status(session: Session, admin: bool = False) -> dict:
        data = session.model_dump() if admin else session.public()
        status = await broker.get_status(session.id)
        data["status"] = status or {"live": False}
        data["languages"] = [
            {
                "code": code,
                "name": language_name(session.source_lang)
                if code == "source"
                else language_name(code),
                "original": code == "source",
            }
            for code in session.languages()
        ]
        data["audience_here"] = broker.hub.listeners(session.id)
        return data

    # ------------------------------------------------------------------ pages
    pages = {
        "/": "index.html",
        "/stage": "stage.html",
        "/admin": "admin.html",
        "/overlay": "overlay.html",
    }
    # ".html" aliases so the same relative links work here and on static hosting
    pages |= {f"/{page}": page for page in pages.values()}
    for route, page in pages.items():

        def _page(page: str = page) -> FileResponse:
            return FileResponse(WEB_DIR / page)

        app.add_api_route(route, _page, include_in_schema=False)
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon() -> FileResponse:
        return FileResponse(WEB_DIR / "favicon.svg", media_type="image/svg+xml")

    # ------------------------------------------------------------------ public API
    @app.get("/api/health")
    async def health() -> dict:
        return {
            "ok": True,
            "version": __version__,
            "asr": settings.asr_provider,
            "mt": settings.mt_provider,
            "broker": settings.broker,
            "active_ingests": len(app.state.pipelines),
            "audience_here": broker.hub.listeners(),
        }

    @app.get("/api/config")
    async def config() -> dict:
        return {
            "languages": LANGUAGES,
            "public_url": settings.public_url,
            "sample_rate": settings.sample_rate,
        }

    @app.get("/api/sessions")
    async def list_sessions() -> list[dict]:
        return [await with_status(s) for s in await broker.list_sessions()]

    @app.get("/api/sessions/{session_id}")
    async def get_session(session_id: str) -> dict:
        return await with_status(await get_session_or_404(session_id))

    @app.get("/api/sessions/{session_id}/history")
    async def history(session_id: str, lang: str = "source", after: int = 0, limit: int = 200):
        session = await get_session_or_404(session_id)
        events = await broker.history(session.id, resolve_lang(session, lang), after, limit)
        return [e.model_dump() for e in events]

    @app.get("/api/sessions/{session_id}/now.{fmt}")
    async def now(session_id: str, fmt: str, lang: str = "source", lines: int = 2):
        """Latest caption lines, for vMix Data Sources / OBS text sources / tickers."""
        session = await get_session_or_404(session_id)
        code = resolve_lang(session, lang)
        events = await broker.history(session.id, code, limit=max(1, min(lines, 10)))
        text = "\n".join(e.text for e in events)
        if fmt == "json":
            return {
                "session": session.id,
                "lang": lang,
                "text": text,
                "seq": events[-1].seq if events else 0,
            }
        if fmt == "txt":
            return PlainTextResponse(text, headers={"Cache-Control": "no-store"})
        raise HTTPException(404, "format must be txt or json")

    @app.get("/api/sessions/{session_id}/transcript.{fmt}")
    async def transcript(session_id: str, fmt: str, lang: str = "source"):
        session = await get_session_or_404(session_id)
        events = await broker.history(session.id, resolve_lang(session, lang))
        render = {"txt": to_txt, "srt": to_srt, "vtt": to_vtt}.get(fmt)
        if not render:
            raise HTTPException(404, "format must be txt, srt or vtt")
        media = {"txt": "text/plain", "srt": "application/x-subrip", "vtt": "text/vtt"}[fmt]
        name = f"{session.id}-{lang}.{fmt}"
        return PlainTextResponse(
            render(events),
            media_type=f"{media}; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    @app.get("/api/sessions/{session_id}/qr.svg")
    async def qr(session_id: str, request: Request, lang: str | None = None):
        import segno

        session = await get_session_or_404(session_id)
        base = settings.public_url.rstrip("/") or str(request.base_url).rstrip("/")
        url = f"{base}/?session={session.id}" + (f"&lang={lang}" if lang else "")
        svg = segno.make(url, error="m").svg_inline(scale=8, border=2, dark="#111", light="#fff")
        return Response(svg, media_type="image/svg+xml")

    @app.post("/api/sessions/{session_id}/summary")
    async def summary(session_id: str, lang: str = "es") -> dict:
        """AI summary of what has been said so far (cached for 60 s per language)."""
        session = await get_session_or_404(session_id)
        tr: Translator | None = app.state.translator
        if tr is None:
            raise HTTPException(503, "no language model configured")
        events = await broker.history(session.id, "source")
        if not events:
            return {"summary": "", "segments": 0}
        key = (session.id, lang)
        cached = app.state.summaries.get(key)
        if cached and (time.time() - cached[0] < SUMMARY_TTL or cached[1] == len(events)):
            return {"summary": cached[2], "segments": cached[1], "cached": True}
        transcript_text = to_txt(events)[-30000:]
        system = (
            f"You summarise live conference talks for the audience in {language_name(lang)}. "
            "Write 3-6 short bullet points with the key ideas so far, keeping technical "
            "terms. Output only the bullets."
        )
        text = await tr.complete(system, f"Talk: {session.title}\n\nTranscript:\n{transcript_text}")
        app.state.summaries[key] = (time.time(), len(events), text)
        return {"summary": text, "segments": len(events)}

    @app.get("/api/sessions/{session_id}/stream")
    async def stream(
        session_id: str,
        request: Request,
        langs: str = "source",
        backlog: int = BACKLOG,
        last_event_id: str | None = Header(None),
    ):
        """Server-Sent Events: ``final``, ``interim`` and ``status`` events.

        ``langs`` is a comma-separated list (``source`` = original language).
        Reconnecting clients resume from ``Last-Event-ID`` without gaps.
        """
        session = await get_session_or_404(session_id)
        wanted = {resolve_lang(session, lang.strip()) for lang in langs.split(",") if lang.strip()}
        last_seen: dict[str, int] = {}
        if last_event_id:
            for part in last_event_id.split(","):
                lang, _, seq = part.partition("=")
                if lang in wanted and seq.isdigit():
                    last_seen[lang] = int(seq)

        def fmt(ev: CaptionEvent) -> str:
            lines = f"event: {ev.type}\n"
            if ev.type == "final":
                last_seen[ev.lang] = max(last_seen.get(ev.lang, 0), ev.seq)
                lines += "id: " + ",".join(f"{k}={v}" for k, v in sorted(last_seen.items())) + "\n"
            return lines + f"data: {ev.model_dump_json()}\n\n"

        async def gen():
            metrics.AUDIENCE.inc()
            try:
                async with broker.subscribe(session.id) as queue:
                    yield "retry: 2000\n\n"
                    status = await broker.get_status(session.id)
                    yield fmt(
                        CaptionEvent(
                            type="status",
                            session=session.id,
                            lang="*",
                            data=status or {"live": False},
                        )
                    )
                    for lang in sorted(wanted):
                        after = last_seen.get(lang, 0)
                        if not after and backlog <= 0:
                            continue
                        events = await broker.history(
                            session.id, lang, after, None if after else backlog
                        )
                        for ev in events:
                            yield fmt(ev)
                    while True:
                        try:
                            ev = await asyncio.wait_for(queue.get(), HEARTBEAT_SECONDS)
                        except TimeoutError:
                            if await request.is_disconnected():
                                return
                            yield ": ping\n\n"
                            continue
                        if ev.lang != "*" and ev.lang not in wanted:
                            continue
                        if ev.type == "final" and ev.seq <= last_seen.get(ev.lang, 0):
                            continue  # already sent from history
                        yield fmt(ev)
            finally:
                metrics.AUDIENCE.dec()

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/metrics", include_in_schema=False)
    async def prom() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    # ------------------------------------------------------------------ admin API
    admin = [Depends(require_admin)]

    @app.get("/api/admin/sessions", dependencies=admin)
    async def admin_list() -> list[dict]:
        return [await with_status(s, admin=True) for s in await broker.list_sessions()]

    @app.post("/api/admin/sessions", dependencies=admin)
    async def admin_upsert(body: SessionIn) -> dict:
        existing = await broker.get_session(body.id)
        data = body.model_dump()
        if existing:
            data = {**existing.model_dump(), **data}
        session = Session(**data)
        await broker.save_session(session)
        return session.model_dump()

    @app.delete("/api/admin/sessions/{session_id}", dependencies=admin)
    async def admin_delete(session_id: str) -> dict:
        await get_session_or_404(session_id)
        await broker.delete_session(session_id)
        return {"deleted": session_id}

    @app.post("/api/admin/sessions/{session_id}/clear", dependencies=admin)
    async def admin_clear(session_id: str) -> dict:
        await get_session_or_404(session_id)
        await broker.clear_history(session_id)
        return {"cleared": session_id}

    @app.post("/api/admin/sessions/{session_id}/rotate-key", dependencies=admin)
    async def admin_rotate(session_id: str) -> dict:
        session = await get_session_or_404(session_id)
        session.ingest_key = secrets.token_urlsafe(16)
        await broker.save_session(session)
        return session.model_dump()

    # ------------------------------------------------------------------ ingest
    @app.websocket("/ws/ingest/{session_id}")
    async def ingest(
        ws: WebSocket, session_id: str, key: str = "", rate: int = 0, takeover: bool = False
    ):
        """Audio in: binary frames of 16-bit little-endian mono PCM at ``rate`` Hz."""
        await ws.accept()
        session = await broker.get_session(session_id)
        if not session or not secrets.compare_digest(key, session.ingest_key):
            await ws.close(code=4401, reason="unknown session or bad ingest key")
            return
        owner = uuid.uuid4().hex
        if takeover:
            local = app.state.pipelines.get(session.id)
            if local is not None:
                app.state.pipelines.pop(session.id, None)
                await local.stop()
        acquired = await broker.acquire_ingest(session.id, owner)
        if not acquired and takeover:
            await broker.release_ingest(session.id, await _lock_owner(session.id))
            acquired = await broker.acquire_ingest(session.id, owner)
        if not acquired:
            await ws.close(code=4409, reason="another source is already streaming this session")
            return

        src_rate = rate or settings.sample_rate
        pipeline = SessionPipeline(
            session, broker, asr_factory(session), app.state.translator, settings
        )
        app.state.pipelines[session.id] = pipeline
        lost_lock = asyncio.Event()

        async def keep_lock():
            while True:
                await asyncio.sleep(5)
                if not await broker.acquire_ingest(session.id, owner):
                    lost_lock.set()
                    return

        async def report():
            with contextlib.suppress(Exception):
                while True:
                    await asyncio.sleep(1)
                    await ws.send_json({"type": "status", **pipeline.stats()})

        lock_task = asyncio.create_task(keep_lock())
        report_task = asyncio.create_task(report())
        try:
            await pipeline.start()
            await ws.send_json({"type": "ready", "session": session.id, "rate": src_rate})
            while not lost_lock.is_set() and not pipeline.stopped:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("bytes"):
                    chunk = resample_pcm16(msg["bytes"], src_rate, settings.sample_rate)
                    await pipeline.feed(chunk)
                elif msg.get("text"):
                    with contextlib.suppress(ValueError, TypeError):
                        cfg = json.loads(msg["text"])
                        if cfg.get("type") == "config" and int(cfg.get("rate", 0)) > 0:
                            src_rate = int(cfg["rate"])
        except WebSocketDisconnect:
            pass
        finally:
            taken_over = lost_lock.is_set() or pipeline.stopped
            lock_task.cancel()
            report_task.cancel()
            if app.state.pipelines.get(session.id) is pipeline:
                app.state.pipelines.pop(session.id, None)
            await pipeline.stop()
            await broker.release_ingest(session.id, owner)
            if taken_over and ws.client_state == WebSocketState.CONNECTED:
                with contextlib.suppress(Exception):
                    await ws.close(code=4409, reason="taken over by another source")

    async def _lock_owner(session_id: str) -> str:
        # Memory broker: read the lock table; Redis broker: read the key.
        locks = getattr(broker, "_locks", None)
        if locks is not None:
            return locks.get(session_id, ("",))[0]
        redis = getattr(broker, "_redis", None)
        if redis is not None:
            return await redis.get(broker._k("lock", session_id)) or ""  # type: ignore[attr-defined]
        return ""

    return app


def create_default_app() -> FastAPI:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    return create_app()
