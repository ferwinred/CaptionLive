export type LangCode = string; // "source" = original language, otherwise BCP-47

export interface Language {
  code: LangCode;
  name: string;
  original: boolean;
}

export interface SessionStatus {
  live: boolean;
  level_db?: number;
  audio_seconds?: number;
  started_at?: number;
  asr_reconnects?: number;
  asr_errors?: number;
  mt_errors?: number;
  mt_chars?: number;
  first_caption_ms?: number | null;
  translation_ms?: number | null;
  last_error?: string;
  est_cost_usd?: number;
}

export interface Session {
  id: string;
  title: string;
  room: string;
  speaker: string;
  source_lang: string;
  target_langs: string[];
  glossary: string[];
  created_at: number;
  ingest_key?: string;
  status: SessionStatus;
  languages: Language[];
  audience_here: number;
}

export interface SessionInput {
  id: string;
  title: string;
  room: string;
  speaker: string;
  source_lang: string;
  target_langs: string[];
  glossary: string[];
}

export interface CaptionEvent {
  type: "interim" | "final" | "status";
  session: string;
  lang: LangCode;
  text: string;
  seq: number;
  segment: number;
  source_lang: string;
  ts: number;
  latency_ms?: number | null;
  data?: (SessionStatus & { fallback?: boolean }) | null;
}

export interface AppConfig {
  languages: Record<string, string>;
  public_url: string;
  sample_rate: number;
}
