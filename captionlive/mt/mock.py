"""Fake translator for tests and key-less demos: ``[es] original text``."""

from __future__ import annotations

import asyncio

from .base import Translator


class MockTranslator(Translator):
    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self.calls: list[tuple[str, str, str]] = []

    async def translate(self, text, source_lang, target_lang, context=None, glossary=None):
        self.calls.append((text, source_lang, target_lang))
        if self.delay:
            await asyncio.sleep(self.delay)
        return f"[{target_lang}] {text}"

    async def complete(self, system: str, prompt: str) -> str:
        return "- Resumen de prueba (mock)."
