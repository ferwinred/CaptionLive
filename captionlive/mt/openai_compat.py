"""Any OpenAI-compatible chat endpoint: Ollama (Gemma), vLLM, llama.cpp, LM Studio...

Example 100% local setup::

    ollama pull gemma3:4b
    CL_MT_PROVIDER=openai CL_OPENAI_BASE_URL=http://localhost:11434/v1 \
    CL_OPENAI_MODEL=gemma3:4b captionlive serve
"""

from __future__ import annotations

import httpx

from ..config import Settings
from .base import Translator, build_prompt, clean_output


class OpenAICompatTranslator(Translator):
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.model = settings.openai_model
        self._http = httpx.AsyncClient(
            base_url=settings.openai_base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            timeout=settings.mt_timeout_seconds * 4,
            transport=transport,
        )

    async def _chat(self, system: str, prompt: str, max_tokens: int) -> str:
        resp = await self._http.post(
            "/chat/completions",
            json={
                "model": self.model,
                "temperature": 0.2,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"] or ""

    async def translate(self, text, source_lang, target_lang, context=None, glossary=None):
        system, prompt = build_prompt(text, source_lang, target_lang, context or [], glossary or [])
        return clean_output(await self._chat(system, prompt, 512))

    async def complete(self, system: str, prompt: str) -> str:
        return (await self._chat(system, prompt, 2048)).strip()

    async def close(self) -> None:
        await self._http.aclose()
