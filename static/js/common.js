// Shared helpers for the CaptionLive web apps (no build step, plain ES modules).
import * as demo from "./demo.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const params = new URLSearchParams(location.search);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const store = {
  get(key, fallback = null) { try { return JSON.parse(localStorage.getItem("cl:" + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("cl:" + key, JSON.stringify(value)); } catch {} },
  del(key) { try { localStorage.removeItem("cl:" + key); } catch {} },
};

// --- Backend location -------------------------------------------------------------------
// Served by the CaptionLive server: same origin. Served as a static site (GitHub Pages,
// static/config.js sets {static: true}): ?api=https://backend (remembered) or demo mode.
const CFG = window.CAPTIONLIVE || {};
if (params.has("api")) {
  const v = params.get("api").trim();
  v ? store.set("api", v) : store.del("api");
}
export const API = (CFG.static ? store.get("api", CFG.api || "") : "").replace(/\/$/, "");
export const DEMO = !!CFG.static && !API;

/** Absolute URL of an API path on the configured backend. */
export const apiUrl = (path) => (API ? API + path : new URL(path, location.origin).href);

/** URL of another page of the web app, keeping the backend setting for static hosting. */
export function pageUrl(page, query = {}) {
  const url = new URL(page === "index" ? "./" : `./${page}${CFG.static ? ".html" : ""}`, location.href);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  if (CFG.static && API) url.searchParams.set("api", API);
  return url.href;
}

export function wsUrl(path) {
  const u = new URL(apiUrl(path));
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
}

export async function api(path, { method = "GET", body, token } = {}) {
  if (DEMO) return demo.api(path, { method, body, token });
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(path), { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

/** Download a transcript (works against a backend and in demo mode). */
export async function downloadTranscript(sessionId, lang, fmt) {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/transcript.${fmt}?lang=${lang}`;
  const a = document.createElement("a");
  if (DEMO) {
    a.href = URL.createObjectURL(new Blob([demo.transcript(sessionId, lang, fmt)], { type: "text/plain" }));
  } else {
    a.href = apiUrl(path);
  }
  a.download = `${sessionId}-${lang}.${fmt}`;
  document.body.append(a); a.click(); a.remove();
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || "dark";
}

/** Banner for static hosting: demo mode notice + connect-to-backend control. */
export function staticBanner() {
  if (!CFG.static) return;
  const bar = document.createElement("div");
  bar.className = "demo-banner";
  bar.innerHTML = DEMO
    ? `<span><strong>Modo demo</strong> — subtítulos simulados en el navegador (sin servidor).</span>
       <button type="button" data-connect>Conectar a un servidor…</button>`
    : `<span>Servidor: <code>${esc(API)}</code></span><button type="button" data-connect>Cambiar</button>
       <button type="button" data-demo>Volver al demo</button>`;
  bar.querySelector("[data-connect]").onclick = () => {
    const url = prompt("URL del backend de CaptionLive (ej. https://captions.midominio.org):", API || "https://");
    if (url && /^https?:\/\//.test(url.trim())) { store.set("api", url.trim()); location.reload(); }
  };
  const back = bar.querySelector("[data-demo]");
  if (back) back.onclick = () => { store.del("api"); const u = new URL(location.href); u.searchParams.delete("api"); location.href = u.href; };
  document.body.prepend(bar);
}

/**
 * Live caption subscription over Server-Sent Events.
 * EventSource reconnects on its own and resumes via Last-Event-ID, so no caption is lost
 * on flaky conference Wi-Fi.
 */
export class CaptionStream {
  constructor(sessionId, langs, handlers) {
    this.url = apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/stream?langs=${encodeURIComponent(langs.join(","))}`);
    this.handlers = handlers;
    if (DEMO) this.demo = demo.subscribe(sessionId, langs, handlers);
    else this.open();
  }
  open() {
    this.es = new EventSource(this.url);
    for (const type of ["final", "interim", "status"]) {
      this.es.addEventListener(type, (e) => this.handlers[type]?.(JSON.parse(e.data)));
    }
    this.es.onerror = () => this.handlers.connection?.(false);
    this.es.onopen = () => this.handlers.connection?.(true);
  }
  close() { this.es?.close(); this.demo?.close(); }
}

/** Renders finals + the live interim line for one caption language. */
export class CaptionView {
  constructor(el, { lang, maxLines = 400, showOriginal = false, liveOriginal = true } = {}) {
    this.el = el; this.lang = lang; this.maxLines = maxLines;
    this.showOriginal = showOriginal; this.liveOriginal = liveOriginal;
    this.finals = new Map(); // segment -> {text, orig, fallback}
    this.sourceBySegment = new Map();
    this.interim = "";
    this.onChange = null;
  }
  final(ev) {
    if (ev.lang === "source") this.sourceBySegment.set(ev.segment, ev.text);
    if (ev.lang === this.lang) {
      this.finals.set(ev.segment, { text: ev.text, fallback: !!ev.data?.fallback });
      if (this.lang === "source") this.interim = "";
    }
    this.trim(); this.render();
  }
  interimEvent(ev) {
    if (ev.lang !== "source") return;
    this.interim = ev.text;
    this.render();
  }
  trim() {
    while (this.finals.size > this.maxLines) this.finals.delete(this.finals.keys().next().value);
    while (this.sourceBySegment.size > this.maxLines * 2) this.sourceBySegment.delete(this.sourceBySegment.keys().next().value);
  }
  pendingSource() {
    // source sentences already committed but whose translation has not arrived yet
    if (this.lang === "source") return [];
    const last = Math.max(-1, ...this.finals.keys());
    return [...this.sourceBySegment.entries()].filter(([seg]) => seg > last).map(([, t]) => t);
  }
  render() {
    const items = [...this.finals.entries()];
    const html = items.map(([seg, f], i) => {
      const orig = this.showOriginal && this.lang !== "source" ? this.sourceBySegment.get(seg) : null;
      const cls = [i < items.length - 3 ? "old" : "", f.fallback ? "fallback" : ""].join(" ").trim();
      return `<p class="${cls}">${esc(f.text)}${orig ? `<span class="orig">${esc(orig)}</span>` : ""}</p>`;
    });
    if (this.lang === "source") {
      if (this.interim) html.push(`<p class="interim">${esc(this.interim)}</p>`);
    } else if (this.liveOriginal) {
      const pending = [...this.pendingSource(), this.interim].filter(Boolean).join(" ");
      if (pending) html.push(`<p class="interim">${esc(pending)}</p>`);
    }
    this.el.innerHTML = html.join("");
    this.onChange?.();
  }
  plainText() { return [...this.finals.values()].map((f) => f.text).join("\n"); }
}
