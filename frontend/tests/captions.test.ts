import { test } from "node:test";
import assert from "node:assert/strict";
import { initialCaptionState, reduceCaption, selectView, MAX_LINES } from "../src/lib/captions.ts";
import type { CaptionEvent } from "../src/lib/types.ts";

const ev = (p: Partial<CaptionEvent>): CaptionEvent => ({
  type: "final", session: "s", lang: "source", text: "", seq: 0, segment: 0, source_lang: "en", ts: 0, ...p,
});

test("interim replaces and final clears the interim line", () => {
  let s = initialCaptionState();
  s = reduceCaption(s, ev({ type: "interim", text: "Hello" }));
  s = reduceCaption(s, ev({ type: "interim", text: "Hello every" }));
  assert.equal(s.interim, "Hello every");
  s = reduceCaption(s, ev({ text: "Hello everyone.", seq: 1, segment: 10 }));
  assert.equal(s.interim, "");
  assert.deepEqual(s.lines.source.map((l) => l.text), ["Hello everyone."]);
});

test("duplicates from a reconnect replay are ignored and order is kept", () => {
  let s = initialCaptionState();
  for (const seq of [1, 3, 2, 3, 1]) s = reduceCaption(s, ev({ lang: "es", seq, segment: seq, text: `t${seq}` }));
  assert.deepEqual(s.lines.es.map((l) => l.seq), [1, 2, 3]);
});

test("translated view shows originals still waiting for translation", () => {
  let s = initialCaptionState();
  s = reduceCaption(s, ev({ text: "One.", seq: 1, segment: 1 }));
  s = reduceCaption(s, ev({ text: "Two.", seq: 2, segment: 2 }));
  s = reduceCaption(s, ev({ lang: "es", text: "Uno.", seq: 1, segment: 1 }));
  s = reduceCaption(s, ev({ type: "interim", text: "Thr" }));
  const view = selectView(s, "es", true);
  assert.deepEqual(view.lines.map((l) => [l.text, l.original]), [["Uno.", "One."]]);
  assert.equal(view.pending, "Two. Thr");
  assert.equal(selectView(s, "source", false).pending, "Thr");
});

test("fallback flag and status merge", () => {
  let s = initialCaptionState();
  s = reduceCaption(s, ev({ lang: "pt", seq: 1, text: "x", data: { live: true, fallback: true } }));
  assert.equal(s.lines.pt[0].fallback, true);
  s = reduceCaption(s, ev({ type: "status", lang: "*", data: { live: true, level_db: -20 } }));
  assert.equal(s.status.live, true);
  s = reduceCaption(s, ev({ type: "interim", text: "abc" }));
  s = reduceCaption(s, ev({ type: "status", lang: "*", data: { live: false } }));
  assert.equal(s.interim, "", "going offline clears the interim line");
});

test("history is capped", () => {
  let s = initialCaptionState();
  for (let i = 1; i <= MAX_LINES + 20; i++) s = reduceCaption(s, ev({ lang: "es", seq: i, segment: i, text: String(i) }));
  assert.equal(s.lines.es.length, MAX_LINES);
  assert.equal(s.lines.es[0].seq, 21);
});
