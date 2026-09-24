"""Translation with Gemini (default ``gemini-2.5-flash-lite``: fast and very cheap)."""

from __future__ import annotations

from ..config import Settings
from .base import Translator, build_prompt, clean_output


class GeminiTranslator(Translator):
    def __init__(self, settings: Settings, client=None) -> None:
        self.settings = settings
        self.model = settings.gemini_mt_model
        if client is None:
            from google import genai

            key = settings.gemini_api_key or None
            client = genai.Client(api_key=key) if key else genai.Client()
        self._client = client

    async def _generate(self, system: str, prompt: str, max_tokens: int) -> str:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
            max_output_tokens=max_tokens,
        )
        if "2.5" in self.model:  # disable "thinking" on 2.5 models: latency matters
            config.thinking_config = types.ThinkingConfig(thinking_budget=0)
        resp = await self._client.aio.models.generate_content(
            model=self.model, contents=prompt, config=config
        )
        return resp.text or ""

    async def translate(self, text, source_lang, target_lang, context=None, glossary=None):
        system, prompt = build_prompt(text, source_lang, target_lang, context or [], glossary or [])
        return clean_output(await self._generate(system, prompt, 512))

    async def complete(self, system: str, prompt: str) -> str:
        return (await self._generate(system, prompt, 2048)).strip()
