"use client";

import {
  ArrowDown, ChevronLeft, Download, Expand, Loader2, QrCode, Settings2, Sparkles, Wifi, WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/components/logo";
import { QrDialog } from "@/components/qr-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { LiveBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useCaptionStream } from "@/hooks/use-caption-stream";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePoll } from "@/hooks/use-poll";
import { DEFAULT_API, endpoints, getApiBase } from "@/lib/api";
import { selectView } from "@/lib/captions";
import { FLAGS } from "@/lib/languages";
import { cn, formatMs } from "@/lib/utils";

export function Viewer({ sessionId }: { sessionId: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const { data: session, error } = usePoll(() => endpoints.session(sessionId), 15000, [sessionId]);

  const [prefs, setPrefs] = useLocalStorage("viewer", {
    size: 34,
    dual: false,
    liveOriginal: true,
    speak: false,
    focus: false,
  });
  const [savedLang, setSavedLang] = useLocalStorage<string | null>(`lang:${sessionId}`, null);
  const lang = useMemo(() => {
    if (!session) return null;
    const codes = session.languages.map((l) => l.code);
    const wanted = search.get("lang") ?? savedLang;
    if (wanted && codes.includes(wanted)) return wanted;
    const browser = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "es";
    if (codes.includes(browser)) return browser;
    if (browser === session.source_lang) return "source";
    return codes.find((c) => c !== "source") ?? "source";
  }, [session, search, savedLang]);

  const langs = !lang ? [] : lang === "source" ? ["source"] : [lang, "source"];
  const { state, connection } = useCaptionStream(session ? sessionId : null, langs);
  const view = lang ? selectView(state, lang, prefs.dual) : { lines: [], pending: "" };
  const live = state.status.live;

  const [settings, setSettings] = useState(false);
  const [qr, setQr] = useState(false);
  const [summary, setSummary] = useState<{ open: boolean; text: string; loading: boolean }>({ open: false, text: "", loading: false });

  // auto-follow
  const bottomRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    const onScroll = () => setFollowing(window.innerHeight + window.scrollY >= document.body.scrollHeight - 120);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (following) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [view.lines.length, view.pending, following]);

  // text-to-speech of new finals
  const spoken = useRef<number>(0);
  useEffect(() => {
    const last = view.lines.at(-1);
    if (!last) return;
    if (!spoken.current) { spoken.current = last.seq; return; }
    if (prefs.speak && last.seq > spoken.current && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(last.text);
      u.lang = lang === "source" ? session?.source_lang ?? "en" : lang ?? "es";
      u.rate = 1.08;
      speechSynthesis.speak(u);
    }
    spoken.current = last.seq;
  }, [view.lines, prefs.speak, lang, session]);

  function chooseLang(code: string) {
    setSavedLang(code);
    const p = new URLSearchParams(search.toString());
    p.set("lang", code);
    router.replace(`?${p}`, { scroll: false });
  }

  async function loadSummary() {
    setSummary({ open: true, text: "", loading: true });
    const target = lang === "source" ? session?.source_lang ?? "es" : lang ?? "es";
    try {
      const r = await endpoints.summary(sessionId, target);
      setSummary({ open: true, text: r.summary || "Todavía no hay suficiente contenido.", loading: false });
    } catch (e) {
      setSummary({ open: true, text: `No se pudo generar el resumen: ${(e as Error).message}`, loading: false });
    }
  }

  const shareUrl = typeof window !== "undefined" ? shareLink(sessionId, lang) : "";
  const lines = prefs.focus ? view.lines.slice(-3) : view.lines;

  if (error && !session) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <WifiOff className="h-10 w-10 text-muted" />
        <h1 className="text-xl font-semibold">No encontramos esta sala</h1>
        <p className="text-muted">{error.message} — servidor: <code className="font-mono text-xs">{getApiBase()}</code></p>
        <Link href="/" className="font-medium text-brand">Ver todas las salas</Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh" style={{ ["--caption-size" as string]: `${prefs.size}px` }}>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-1 text-muted hover:text-fg" aria-label="Volver a las salas">
            <ChevronLeft className="h-5 w-5" /> <LogoMark className="h-6 w-6" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-semibold tracking-tight">{session?.title || sessionId}</h1>
              <LiveBadge live={live} className="shrink-0" />
            </div>
            {session && (session.speaker || session.room) && (
              <p className="truncate text-xs text-muted">{[session.speaker, session.room].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={loadSummary} title="Resumen IA"><Sparkles className="h-[18px] w-[18px]" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setQr(true)} title="Compartir"><QrCode className="h-[18px] w-[18px]" /></Button>
            <Button variant="ghost" size="icon" onClick={() => document.documentElement.requestFullscreen?.()} title="Pantalla completa" className="hidden sm:inline-flex">
              <Expand className="h-[18px] w-[18px]" />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={() => setSettings(true)} title="Ajustes"><Settings2 className="h-[18px] w-[18px]" /></Button>
          </div>
          {session && lang && (
            <div className="w-full overflow-x-auto">
              <Segmented
                value={lang}
                onChange={chooseLang}
                options={session.languages.map((l) => ({
                  value: l.code,
                  title: l.name,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <span>{FLAGS[l.original ? session.source_lang : l.code] ?? "🌐"}</span>
                      {l.name}
                      {l.original && <span className="text-[10px] uppercase tracking-wider text-muted">original</span>}
                    </span>
                  ),
                }))}
              />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 pb-[45vh] sm:px-6" aria-live="polite">
        {!session ? (
          <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
        ) : lines.length === 0 && !view.pending ? (
          <div className="py-24 text-center text-muted">
            <p className="text-xl">{live ? "Escuchando…" : "La charla todavía no empezó."}</p>
            <p className="mt-2 text-sm">Los subtítulos aparecerán acá automáticamente.</p>
          </div>
        ) : (
          <div className="space-y-[0.55em] font-medium leading-snug" style={{ fontSize: "var(--caption-size)" }}>
            {lines.map((l, i) => (
              <p key={l.seq}
                 className={cn("caption-in transition-colors", i < lines.length - 2 ? "text-muted" : "text-fg",
                   l.fallback && "decoration-warn/70 underline decoration-dashed underline-offset-8")}
                 title={l.fallback ? "Traducción no disponible: se muestra el original" : undefined}>
                {l.text}
                {l.original && <span className="mt-1 block text-[0.52em] font-normal text-muted">{l.original}</span>}
              </p>
            ))}
            {view.pending && (lang === "source" || prefs.liveOriginal) && (
              <p className="italic text-muted/80">
                {view.pending}
                <span className="ml-1 inline-block h-[0.8em] w-[0.08em] translate-y-[0.1em] animate-live bg-brand" />
              </p>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {!following && (
        <Button onClick={() => { setFollowing(true); bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }}
                className="fixed right-4 bottom-16 z-30 shadow-lg" size="md">
          <ArrowDown className="h-4 w-4" /> Seguir en vivo
        </Button>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border/70 bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2 text-xs text-muted sm:px-6">
          <span className="flex items-center gap-1.5">
            {connection === "open" ? <Wifi className="h-3.5 w-3.5 text-ok" /> : <WifiOff className="h-3.5 w-3.5 text-warn" />}
            {connection === "open" ? "Conectado" : connection === "connecting" ? "Conectando…" : "Reconectando…"}
          </span>
          {live && lang !== "source" && <span className="hidden sm:inline">Traducción ≈ {formatMs(state.status.translation_ms)}</span>}
          <span className="ml-auto hidden sm:inline">Traducción automática: puede contener errores.</span>
        </div>
      </footer>

      <Dialog open={settings} onClose={() => setSettings(false)} title="Ajustes de lectura">
        <label className="block py-2">
          <span className="flex justify-between text-sm font-medium">Tamaño de letra <span className="tabular-nums text-muted">{prefs.size}px</span></span>
          <input type="range" min={18} max={80} step={2} value={prefs.size}
                 onChange={(e) => setPrefs({ ...prefs, size: +e.target.value })} className="mt-2 w-full accent-[var(--brand)]" />
        </label>
        <div className="divide-y divide-border">
          <Switch checked={prefs.dual} onChange={(v) => setPrefs({ ...prefs, dual: v })}
                  label="Mostrar el original debajo" description="Útil para seguir términos técnicos o aprender el idioma." />
          <Switch checked={prefs.liveOriginal} onChange={(v) => setPrefs({ ...prefs, liveOriginal: v })}
                  label="Original en vivo mientras se traduce" description="Muestra en gris lo que se está diciendo antes de la traducción." />
          <Switch checked={prefs.focus} onChange={(v) => setPrefs({ ...prefs, focus: v })}
                  label="Modo proyector" description="Solo las últimas líneas, ideal para la pantalla de la sala." />
          <Switch checked={prefs.speak} onChange={(v) => { if (!v) speechSynthesis?.cancel(); setPrefs({ ...prefs, speak: v }); }}
                  label="Leer en voz alta" description="Síntesis de voz del navegador (con auriculares)." />
        </div>
        {lang && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Download className="h-4 w-4" /> Descargar transcripción</p>
            <div className="flex gap-2">
              {(["srt", "vtt", "txt"] as const).map((f) => (
                <a key={f} href={endpoints.transcriptUrl(sessionId, lang, f)} download
                   className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium uppercase hover:bg-surface-2">{f}</a>
              ))}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={summary.open} onClose={() => setSummary((s) => ({ ...s, open: false }))} title="Resumen de lo dicho hasta ahora"
              description="Generado con IA a partir de la transcripción.">
        {summary.loading ? (
          <div className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Generando…</div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{summary.text}</div>
        )}
      </Dialog>

      <QrDialog open={qr} onClose={() => setQr(false)} url={shareUrl} title="Compartir esta sala" />
    </div>
  );
}

function shareLink(sessionId: string, lang: string | null) {
  const u = new URL(`/s/${encodeURIComponent(sessionId)}`, window.location.origin);
  if (lang) u.searchParams.set("lang", lang);
  if (getApiBase() !== DEFAULT_API) u.searchParams.set("api", getApiBase());
  return u.toString();
}
