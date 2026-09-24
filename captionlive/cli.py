"""Command line: ``captionlive serve | ingest | simulate``."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import shutil
import sys
import time

CHUNK_MS = 100


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    from .config import get_settings

    settings = get_settings()
    uvicorn.run(
        "captionlive.main:create_default_app",
        factory=True,
        host=args.host or settings.host,
        port=args.port or settings.port,
        workers=args.workers,
        proxy_headers=True,
        forwarded_allow_ips="*",
        ws_ping_interval=20,
        ws_ping_timeout=20,
    )


def _ws_url(server: str, session: str, key: str, rate: int, takeover: bool) -> str:
    base = server.rstrip("/")
    if base.startswith("http"):
        base = "ws" + base[4:]
    url = f"{base}/ws/ingest/{session}?key={key}&rate={rate}"
    return url + ("&takeover=1" if takeover else "")


async def _pump(url: str, reader, rate: int, realtime: bool, quiet: bool) -> None:
    """Send PCM from ``reader`` (async read(n) -> bytes) to the ingest WebSocket."""
    import websockets

    chunk_bytes = rate * 2 * CHUNK_MS // 1000
    async with websockets.connect(url, max_size=None, ping_interval=20) as ws:
        ready = json.loads(await ws.recv())
        if ready.get("type") != "ready":
            raise SystemExit(f"server refused: {ready}")
        print(f"streaming to {url.split('?')[0]} @ {rate} Hz", file=sys.stderr)

        async def status_printer():
            async for msg in ws:
                if quiet or isinstance(msg, bytes):
                    continue
                st = json.loads(msg)
                if st.get("type") == "status":
                    print(
                        f"\rlevel {st['level_db']:6.1f} dBFS | audio {st['audio_seconds']:7.1f}s"
                        f" | 1st caption {st.get('first_caption_ms')} ms"
                        f" | MT {st.get('translation_ms')} ms   ",
                        end="",
                        file=sys.stderr,
                    )

        printer = asyncio.create_task(status_printer())
        start = time.monotonic()
        sent = 0
        try:
            while True:
                data = await reader(chunk_bytes)
                if not data:
                    break
                await ws.send(data)
                sent += len(data)
                if realtime:  # pace files to real time; live devices pace themselves
                    ahead = sent / 2 / rate - (time.monotonic() - start)
                    if ahead > 0:
                        await asyncio.sleep(ahead)
        finally:
            printer.cancel()
            await ws.close()


async def _ingest(args: argparse.Namespace) -> None:
    rate = 16000
    url = _ws_url(args.server, args.session, args.key, rate, args.takeover)
    if args.input == "-":
        loop = asyncio.get_running_loop()
        stdin = sys.stdin.buffer

        async def reader(n: int) -> bytes:
            return await loop.run_in_executor(None, stdin.read, n)

        await _pump(url, reader, rate, realtime=args.realtime, quiet=args.quiet)
        return

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg not found: install it or pipe raw PCM with --input -")
    in_args = args.ffmpeg_input_args.split() if args.ffmpeg_input_args else []
    is_file = "://" not in args.input and not in_args
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", *in_args]
    if is_file and not args.no_realtime:
        cmd += ["-re"]
    cmd += ["-i", args.input, "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"]
    while True:
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE)

        async def reader(n: int, proc=proc) -> bytes:
            try:
                return await proc.stdout.readexactly(n)
            except asyncio.IncompleteReadError as e:
                return e.partial

        try:
            await _pump(url, reader, rate, realtime=False, quiet=args.quiet)
        except (OSError, Exception) as exc:  # noqa: BLE001 - reconnect forever for live feeds
            print(f"\nconnection error: {exc}", file=sys.stderr)
        finally:
            if proc.returncode is None:
                proc.kill()
        if is_file or not args.reconnect:
            return
        print("reconnecting in 2s...", file=sys.stderr)
        await asyncio.sleep(2)


async def _simulate(args: argparse.Namespace) -> None:
    """Load test: N concurrent stages streaming a synthetic voice-like signal."""
    import httpx

    rate = 16000
    headers = {"Authorization": f"Bearer {args.admin_token}"}
    async with httpx.AsyncClient(base_url=args.server, headers=headers) as http:
        keys = {}
        for i in range(args.sessions):
            sid = f"sim-{i + 1}"
            r = await http.post(
                "/api/admin/sessions",
                json={
                    "id": sid,
                    "title": f"Simulated stage {i + 1}",
                    "source_lang": "en",
                    "target_langs": args.langs.split(","),
                },
            )
            r.raise_for_status()
            keys[sid] = r.json()["ingest_key"]

    def voice(t0: float, n: int) -> bytes:
        import numpy as np

        t = (np.arange(n) / rate) + t0
        envelope = (np.sin(2 * math.pi * 0.25 * t) > -0.3).astype(np.float32)  # speech/pauses
        sig = 0.2 * np.sin(2 * math.pi * 180 * t) * envelope
        return (sig * 32767).astype("<i2").tobytes()

    async def one(sid: str, key: str):
        pos = 0

        async def reader(nbytes: int) -> bytes:
            nonlocal pos
            if pos / rate >= args.seconds:
                return b""
            n = nbytes // 2
            data = voice(pos / rate, n)
            pos += n
            return data

        await _pump(_ws_url(args.server, sid, key, rate, True), reader, rate, True, True)

    await asyncio.gather(*(one(s, k) for s, k in keys.items()))
    print(f"\nsimulated {args.sessions} sessions x {args.seconds}s", file=sys.stderr)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="captionlive", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("serve", help="run the API + web apps")
    p.add_argument("--host")
    p.add_argument("--port", type=int)
    p.add_argument("--workers", type=int, default=1, help=">1 requires CL_BROKER=redis")

    p = sub.add_parser("ingest", help="stream an audio source (via ffmpeg) to a session")
    p.add_argument("--server", default="http://localhost:8000")
    p.add_argument("--session", required=True)
    p.add_argument("--key", required=True, help="the session ingest key")
    p.add_argument(
        "--input",
        required=True,
        help="anything ffmpeg reads: file, srt://, rtmp://, http(s) HLS, or '-' for raw "
        "16 kHz s16le PCM on stdin",
    )
    p.add_argument(
        "--ffmpeg-input-args",
        default="",
        help="extra ffmpeg input options, e.g. '-f alsa' (Linux), '-f avfoundation' (macOS), "
        "'-f dshow' (Windows) to capture a sound card: --input 'audio=Mixer (USB)'",
    )
    p.add_argument("--no-realtime", action="store_true", help="send files as fast as possible")
    p.add_argument("--realtime", action="store_true", help="pace stdin input to real time")
    p.add_argument("--reconnect", action="store_true", default=True)
    p.add_argument("--takeover", action="store_true", help="replace the current source")
    p.add_argument("--quiet", action="store_true")

    p = sub.add_parser("simulate", help="load-test N parallel stages (use with mock providers)")
    p.add_argument("--server", default="http://localhost:8000")
    p.add_argument("--admin-token", default="change-me")
    p.add_argument("--sessions", type=int, default=10)
    p.add_argument("--seconds", type=int, default=60)
    p.add_argument("--langs", default="es,pt")

    args = parser.parse_args(argv)
    if args.cmd == "serve":
        _serve(args)
    elif args.cmd == "ingest":
        asyncio.run(_ingest(args))
    else:
        asyncio.run(_simulate(args))


if __name__ == "__main__":
    main()
