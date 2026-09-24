"""Machine-translation providers."""

from __future__ import annotations

from ..config import Settings
from .base import Translator


def create_translator(settings: Settings) -> Translator | None:
    provider = settings.mt_provider
    if provider == "none":
        return None
    if provider == "mock":
        from .mock import MockTranslator

        return MockTranslator()
    if provider == "openai":
        from .openai_compat import OpenAICompatTranslator

        return OpenAICompatTranslator(settings)
    from .gemini import GeminiTranslator

    return GeminiTranslator(settings)


__all__ = ["Translator", "create_translator"]
