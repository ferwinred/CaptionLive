import type { AppConfig, Session, SessionInput } from "./types";

export const DEFAULT_API =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "https://captionlive-api-production.up.railway.app";

const KEY = "cl:api";

/** Backend base URL: ?api=... (remembered) > saved > NEXT_PUBLIC_API_URL. */
export function getApiBase(): string {
  if (typeof window === "undefined") return DEFAULT_API;
  const fromUrl = new URLSearchParams(window.location.search).get("api");
  try {
    if (fromUrl !== null) {
      if (fromUrl.trim()) localStorage.setItem(KEY, fromUrl.trim().replace(/\/$/, ""));
      else localStorage.removeItem(KEY);
    }
    return localStorage.getItem(KEY) || DEFAULT_API;
  } catch {
    return fromUrl?.trim() || DEFAULT_API;
  }
}

export function setApiBase(url: string | null) {
  try {
    if (url) localStorage.setItem(KEY, url.replace(/\/$/, ""));
    else localStorage.removeItem(KEY);
  } catch {}
}

export const apiUrl = (path: string) => getApiBase() + path;

export function wsUrl(path: string) {
  const u = new URL(apiUrl(path));
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(apiUrl(path), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const endpoints = {
  config: () => api<AppConfig>("/api/config"),
  health: () => api<{ ok: boolean; version: string; asr: string; mt: string; active_ingests: number }>("/api/health"),
  sessions: () => api<Session[]>("/api/sessions"),
  session: (id: string) => api<Session>(`/api/sessions/${enc(id)}`),
  summary: (id: string, lang: string) =>
    api<{ summary: string; segments: number }>(`/api/sessions/${enc(id)}/summary?lang=${enc(lang)}`, { method: "POST" }),
  transcriptUrl: (id: string, lang: string, fmt: "txt" | "srt" | "vtt") =>
    apiUrl(`/api/sessions/${enc(id)}/transcript.${fmt}?lang=${enc(lang)}`),
  nowUrl: (id: string, lang: string) => apiUrl(`/api/sessions/${enc(id)}/now.txt?lang=${enc(lang)}`),
  streamUrl: (id: string, langs: string[]) => apiUrl(`/api/sessions/${enc(id)}/stream?langs=${enc(langs.join(","))}`),
  ingestUrl: (id: string, key: string, takeover: boolean) =>
    wsUrl(`/ws/ingest/${enc(id)}?key=${enc(key)}&rate=16000${takeover ? "&takeover=1" : ""}`),
  admin: {
    sessions: (token: string) => api<Session[]>("/api/admin/sessions", { token }),
    upsert: (token: string, body: SessionInput) => api<Session>("/api/admin/sessions", { method: "POST", body, token }),
    remove: (token: string, id: string) => api(`/api/admin/sessions/${enc(id)}`, { method: "DELETE", token }),
    clear: (token: string, id: string) => api(`/api/admin/sessions/${enc(id)}/clear`, { method: "POST", token }),
    rotateKey: (token: string, id: string) =>
      api<Session>(`/api/admin/sessions/${enc(id)}/rotate-key`, { method: "POST", token }),
  },
};
