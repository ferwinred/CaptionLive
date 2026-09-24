"""Speech recognition providers."""

from __future__ import annotations

from ..config import Settings
from .base import ASRStream, Transcript


def create_asr(settings: Settings, source_lang: str, glossary: list[str]) -> ASRStream:
    provider = settings.asr_provider
    if provider == "mock":
        from .mock import MockASR

        return MockASR(rate=settings.sample_rate)
    if provider == "whisper":
        from .whisper_local import WhisperASR

        return WhisperASR(settings, source_lang, glossary)
    from .gemini_live import GeminiLiveASR

    return GeminiLiveASR(settings, source_lang, glossary)


__all__ = ["ASRStream", "Transcript", "create_asr"]
