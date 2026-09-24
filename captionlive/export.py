"""Transcript export: plain text, SubRip (.srt) and WebVTT (.vtt).

Timings are relative to the first caption of the session so the files can be
attached to the talk recording (adjust offset in the video editor if needed).
"""

from __future__ import annotations

from .models import CaptionEvent

MIN_DURATION = 1.5
MAX_DURATION = 7.0


def _cues(events: list[CaptionEvent]) -> list[tuple[float, float, str]]:
    if not events:
        return []
    t0 = events[0].ts
    cues = []
    for i, ev in enumerate(events):
        start = ev.ts - t0
        reading = max(MIN_DURATION, min(MAX_DURATION, len(ev.text) / 15))  # ~15 chars/s
        end = start + reading
        if i + 1 < len(events):
            end = min(end, max(start + 0.5, events[i + 1].ts - t0))
        cues.append((start, end, ev.text))
    return cues


def _fmt(seconds: float, sep: str) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(events: list[CaptionEvent]) -> str:
    blocks = []
    for i, (start, end, text) in enumerate(_cues(events), 1):
        blocks.append(f"{i}\n{_fmt(start, ',')} --> {_fmt(end, ',')}\n{text}\n")
    return "\n".join(blocks)


def to_vtt(events: list[CaptionEvent]) -> str:
    out = ["WEBVTT", ""]
    for start, end, text in _cues(events):
        out += [f"{_fmt(start, '.')} --> {_fmt(end, '.')}", text, ""]
    return "\n".join(out)


def to_txt(events: list[CaptionEvent]) -> str:
    return "\n".join(ev.text for ev in events) + ("\n" if events else "")
