// Pure caption state machine (no React, no DOM) so it can be unit-tested with node --test.
import type { CaptionEvent, LangCode, SessionStatus } from "./types.ts";

export interface Line {
  segment: number;
  seq: number;
  text: string;
  ts: number;
  fallback: boolean;
}

export interface CaptionState {
  lines: Record<LangCode, Line[]>; // finals per language, ordered by seq
  source: Record<number, string>; // segment -> original text
  interim: string; // current (uncommitted) original text
  status: SessionStatus;
  lastEventAt: number;
}

export const MAX_LINES = 500;

export const initialCaptionState = (): CaptionState => ({
  lines: {},
  source: {},
  interim: "",
  status: { live: false },
  lastEventAt: 0,
});

export function reduceCaption(state: CaptionState, ev: CaptionEvent): CaptionState {
  if (ev.type === "status") {
    const status = { ...state.status, ...(ev.data ?? {}) };
    return { ...state, status, interim: status.live ? state.interim : "" };
  }
  if (ev.type === "interim") {
    if (ev.lang !== "source" || ev.text === state.interim) return state;
    return { ...state, interim: ev.text, lastEventAt: Date.now() };
  }
  // final
  const current = state.lines[ev.lang] ?? [];
  if (current.some((l) => l.seq === ev.seq)) return state; // duplicate (reconnect replay)
  const line: Line = {
    segment: ev.segment,
    seq: ev.seq,
    text: ev.text,
    ts: ev.ts,
    fallback: Boolean(ev.data?.fallback),
  };
  let next = [...current, line];
  if (next.length > 1 && next[next.length - 2].seq > line.seq) next.sort((a, b) => a.seq - b.seq);
  if (next.length > MAX_LINES) next = next.slice(-MAX_LINES);
  const source =
    ev.lang === "source" ? trimSource({ ...state.source, [ev.segment]: ev.text }) : state.source;
  return {
    ...state,
    lines: { ...state.lines, [ev.lang]: next },
    source,
    interim: ev.lang === "source" ? "" : state.interim,
    lastEventAt: Date.now(),
  };
}

function trimSource(src: Record<number, string>): Record<number, string> {
  const keys = Object.keys(src).map(Number);
  if (keys.length <= MAX_LINES * 2) return src;
  keys.sort((a, b) => a - b);
  const out: Record<number, string> = {};
  for (const k of keys.slice(-MAX_LINES)) out[k] = src[k];
  return out;
}

export interface ViewLine extends Line {
  original?: string;
}

/** Lines to display for `lang` plus the pending (not yet translated) original text. */
export function selectView(state: CaptionState, lang: LangCode, withOriginal: boolean) {
  const lines: ViewLine[] = (state.lines[lang] ?? []).map((l) =>
    withOriginal && lang !== "source" ? { ...l, original: state.source[l.segment] } : l,
  );
  let pending = state.interim;
  if (lang !== "source") {
    const last = lines.length ? lines[lines.length - 1].segment : -1;
    const waiting = Object.entries(state.source)
      .filter(([seg]) => Number(seg) > last)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, t]) => t);
    pending = [...waiting, state.interim].filter(Boolean).join(" ");
  }
  return { lines, pending };
}

export function transcriptText(state: CaptionState, lang: LangCode): string {
  return (state.lines[lang] ?? []).map((l) => l.text).join("\n");
}
