"""Machine-translation provider contract + the shared prompt."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..languages import language_name

SYSTEM_PROMPT = (
    "You are a professional simultaneous interpreter producing live subtitles for a "
    "technology conference. Translate the SEGMENT into {target}. Rules:\n"
    "- Output ONLY the translation of the segment, nothing else (no quotes, no notes).\n"
    "- Keep it faithful and concise; it is a subtitle read in real time.\n"
    "- Keep technical terms, code, product names, acronyms and people's names as they "
    "are commonly used by {target}-speaking developers (often untranslated).\n"
    "- The segment may be an incomplete sentence cut by the speech recogniser: "
    "translate it as-is, do not complete it.\n"
    "- Fix obvious speech-recognition errors only when the CONTEXT makes them certain."
)


def build_prompt(
    text: str, source_lang: str, target_lang: str, context: list[str], glossary: list[str]
) -> tuple[str, str]:
    """Return (system, user) prompts."""
    system = SYSTEM_PROMPT.format(target=language_name(target_lang))
    parts: list[str] = []
    if glossary:
        parts.append("GLOSSARY (keep these terms exactly): " + "; ".join(glossary))
    if context:
        parts.append("CONTEXT (previous sentences, do not translate):\n" + "\n".join(context))
    src = "auto-detected language" if source_lang == "auto" else language_name(source_lang)
    parts.append(f"SEGMENT ({src}):\n{text}")
    return system, "\n\n".join(parts)


def clean_output(text: str) -> str:
    text = text.strip()
    for prefix in ("SEGMENT:", "Translation:", "Traducción:"):
        if text.startswith(prefix):
            text = text[len(prefix) :].strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'«":
        text = text[1:-1].strip()
    return " ".join(text.split())


class Translator(ABC):
    @abstractmethod
    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        context: list[str] | None = None,
        glossary: list[str] | None = None,
    ) -> str: ...

    @abstractmethod
    async def complete(self, system: str, prompt: str) -> str:
        """Free-form generation (used for talk summaries)."""

    async def close(self) -> None:  # pragma: no cover - trivial
        pass
