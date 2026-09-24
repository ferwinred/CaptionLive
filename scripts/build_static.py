"""Build the web apps as a static site (GitHub Pages, Vercel, Netlify, any CDN).

    python scripts/build_static.py [--out site] [--api https://captions.example.org]

Without --api the site runs in demo mode (simulated stages in the browser) and viewers can
connect it to a backend with ?api=https://... or the "Conectar a un servidor" button.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "captionlive" / "web"
PAGES = ["index.html", "stage.html", "admin.html", "overlay.html"]


def build(out: Path, api: str = "") -> None:
    if out.exists():
        shutil.rmtree(out)
    static = out / "static"
    shutil.copytree(WEB, static, ignore=shutil.ignore_patterns(*PAGES))
    for page in PAGES:
        shutil.copy(WEB / page, out / page)
    config = {"static": True, "api": api.rstrip("/")}
    (static / "config.js").write_text(
        f"window.CAPTIONLIVE = {json.dumps(config)};\n", encoding="utf-8"
    )
    (out / ".nojekyll").write_text("", encoding="utf-8")
    (out / "404.html").write_text(
        '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./">',
        encoding="utf-8",
    )
    print(f"static site written to {out} (api={config['api'] or 'demo mode'})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="site")
    parser.add_argument("--api", default="")
    args = parser.parse_args()
    build(Path(args.out), args.api)
