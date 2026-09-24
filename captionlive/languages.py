"""Languages offered in the UI. Gemini supports many more; extend freely."""

LANGUAGES: dict[str, str] = {
    "en": "English",
    "es": "Español",
    "pt": "Português",
    "fr": "Français",
    "de": "Deutsch",
    "it": "Italiano",
    "ja": "日本語",
    "zh": "中文",
    "ko": "한국어",
    "hi": "हिन्दी",
    "ar": "العربية",
    "ru": "Русский",
    "nl": "Nederlands",
    "pl": "Polski",
    "tr": "Türkçe",
    "uk": "Українська",
    "ca": "Català",
    "gn": "Avañe'ẽ",
    "qu": "Runasimi",
}


def language_name(code: str) -> str:
    return LANGUAGES.get(code, code)
