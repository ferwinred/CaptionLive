"use client";

// OBS / vMix browser source: transparent background, lower-third captions.
// Params: lang, lines (2), size (42), color, bg, pos (bottom|top), margin (6), align, font, hide (8s), shadow (1)
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCaptionStream } from "@/hooks/use-caption-stream";
import { selectView } from "@/lib/captions";

export function Overlay({ sessionId }: { sessionId: string }) {
  const q = useSearchParams();
  const p = (k: string, d: string) => q.get(k) ?? d;
  const lang = p("lang", "source");
  const nLines = Number(p("lines", "2"));
  const hideAfter = Number(p("hide", "8")) * 1000;
  const { state } = useCaptionStream(sessionId, [lang === "source" ? "source" : lang]);
  const view = selectView(state, lang, false);
  const rows = [...view.lines.slice(-nLines).map((l) => l.text), ...(lang === "source" && view.pending ? [view.pending] : [])].slice(-nLines);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);
  const signature = rows.join("|");
  useEffect(() => {
    if (!signature) return;
    setVisible(true);
    if (hideAfter <= 0) return;
    const t = setTimeout(() => setVisible(false), hideAfter);
    return () => clearTimeout(t);
  }, [signature, hideAfter]);

  const top = p("pos", "bottom") === "top";
  return (
    <div
      className="fixed left-1/2 w-max -translate-x-1/2 font-semibold leading-tight transition-opacity duration-300"
      style={{
        [top ? "top" : "bottom"]: `${p("margin", "6")}vh`,
        maxWidth: `${p("maxwidth", "80")}vw`,
        fontSize: `${p("size", "42")}px`,
        color: p("color", "#ffffff"),
        background: p("bg", "rgba(0,0,0,.72)"),
        textAlign: p("align", "center") as "center" | "left",
        fontFamily: q.get("font") ?? undefined,
        textShadow: p("shadow", "1") === "1" ? "0 2px 4px rgba(0,0,0,.8)" : "none",
        padding: ".3em .7em",
        borderRadius: ".3em",
        opacity: visible && rows.length ? 1 : 0,
      }}
    >
      {rows.map((r, i) => <p key={i} style={{ margin: 0 }}>{r}</p>)}
    </div>
  );
}
