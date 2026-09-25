export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Español", pt: "Português", fr: "Français", de: "Deutsch", it: "Italiano",
  ja: "日本語", zh: "中文", ko: "한국어", hi: "हिन्दी", ar: "العربية", ru: "Русский", nl: "Nederlands",
  pl: "Polski", tr: "Türkçe", uk: "Українська", ca: "Català", gn: "Avañe'ẽ", qu: "Runasimi",
};

export const FLAGS: Record<string, string> = {
  en: "🇬🇧", es: "🇪🇸", pt: "🇧🇷", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹", ja: "🇯🇵", zh: "🇨🇳", ko: "🇰🇷",
  hi: "🇮🇳", ar: "🇸🇦", ru: "🇷🇺", nl: "🇳🇱", pl: "🇵🇱", tr: "🇹🇷", uk: "🇺🇦", ca: "🏴", gn: "🇵🇾", qu: "🇵🇪",
};

export const langName = (code: string) => LANGUAGE_NAMES[code] ?? code;
