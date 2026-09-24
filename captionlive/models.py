"""Shared data models."""

from __future__ import annotations

import re
import secrets
import time
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .languages import LANGUAGES

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


class SessionIn(BaseModel):
    """Payload to create / update a session (a stage, room or track)."""

    id: str = Field(description="URL-friendly identifier, e.g. 'main-stage'")
    title: str = ""
    room: str = ""
    speaker: str = ""
    source_lang: str = Field("en", description="Spoken language (BCP-47) or 'auto'")
    target_langs: list[str] = Field(default_factory=lambda: ["es"])
    glossary: list[str] = Field(
        default_factory=list,
        description="Technical terms, product and speaker names. Biases ASR and is "
        "kept untranslated by MT.",
    )

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not SLUG_RE.match(v):
            raise ValueError("id must be lowercase letters, digits and dashes")
        return v

    @field_validator("source_lang")
    @classmethod
    def _src(cls, v: str) -> str:
        v = v.strip()
        if v != "auto" and v not in LANGUAGES:
            raise ValueError(f"unsupported language {v!r}")
        return v

    @field_validator("target_langs")
    @classmethod
    def _targets(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for lang in v:
            lang = lang.strip()
            if lang not in LANGUAGES:
                raise ValueError(f"unsupported language {lang!r}")
            if lang not in out:
                out.append(lang)
        return out

    @field_validator("glossary")
    @classmethod
    def _glossary(cls, v: list[str]) -> list[str]:
        return [t.strip() for t in v if t.strip()][:200]


class Session(SessionIn):
    ingest_key: str = Field(default_factory=lambda: secrets.token_urlsafe(16))
    created_at: float = Field(default_factory=time.time)

    def public(self) -> dict:
        """What the audience is allowed to see."""
        return self.model_dump(exclude={"ingest_key"})

    def languages(self) -> list[str]:
        """Every caption language the audience can pick."""
        langs = ["source"] + [t for t in self.target_langs if t != self.source_lang]
        return langs


EventType = Literal["interim", "final", "status"]


class CaptionEvent(BaseModel):
    """One caption update published to the audience.

    * ``interim`` events replace the current line (low latency, may change).
    * ``final`` events are committed text; they are stored in history.
    """

    type: EventType
    session: str
    lang: str  # "source" or a BCP-47 target code
    text: str = ""
    seq: int = 0  # monotonically increasing per session+lang for finals
    segment: int = 0  # utterance id, shared across languages
    source_lang: str = ""
    ts: float = Field(default_factory=time.time)
    latency_ms: int | None = None  # time since the audio for this text was received
    data: dict | None = None  # for status events
