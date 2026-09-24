// Shared helpers for the CaptionLive web apps (no build step, plain ES modules).

export const $ = (sel, root = document) => root.querySelector(sel);
export const params = new URLSearchParams(location.search);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export const store = {
  get(key, fallback = null) { try { return JSON.parse(localStorage.getItem("cl:" + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("cl:" + key, JSON.stringify(value)); } catch {} },
};

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || "dark";
}

/**
 * Live caption subscription over Server-Sent Events.
 * EventSource reconnects on its own and resumes via Last-Event-ID, so no caption is lost
 * on flaky conference Wi-Fi.
 */
export class CaptionStream {
  constructor(sessionId, langs, handlers) {
    this.url = `/api/sessions/${encodeURIComponent(sessionId)}/stream?langs=${encodeURIComponent(langs.join(","))}`;
    this.handlers = handlers;
    this.open();
  }
  open() {
    this.es = new EventSource(this.url);
    for (const type of ["final", "interim", "status"]) {
      this.es.addEventListener(type, (e) => this.handlers[type]?.(JSON.parse(e.data)));
    }
    this.es.onerror = () => this.handlers.connection?.(false);
    this.es.onopen = () => this.handlers.connection?.(true);
  }
  close() { this.es?.close(); }
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
