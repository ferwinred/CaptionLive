"use client";

import { Activity, AlertTriangle, Clock, DollarSign, ExternalLink, KeyRound, Languages, Mic, Radio, RefreshCw, Square } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LevelMeter } from "@/components/level-meter";
import { Stat } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCaptionStream } from "@/hooks/use-caption-stream";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePoll } from "@/hooks/use-poll";
import { endpoints } from "@/lib/api";
import { selectView } from "@/lib/captions";
import type { SessionStatus } from "@/lib/types";
import { formatDuration, formatMs, formatUsd } from "@/lib/utils";

type Phase = "idle" | "connecting" | "live" | "reconnecting";

export function StageConsole() {
  const search = useSearchParams();
  const { data: sessions } = usePoll(endpoints.sessions, 20000);
  const [saved, setSaved] = useLocalStorage("stage", { session: "", key: "", device: "", agc: false, ns: true });
  const [sessionId, setSessionId] = useState("");
  const [key, setKey] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(-90);
  const [stats, setStats] = useState<SessionStatus | null>(null);
  const [takeover, setTakeover] = useState(false);

  useEffect(() => {
    setSessionId(search.get("session") ?? saved.session);
    setKey(search.get("key") ?? saved.key);
    if (search.get("key")) window.history.replaceState(null, "", `/stage?session=${encodeURIComponent(search.get("session") ?? "")}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.session, saved.key]);

  const loadDevices = useCallback(async () => {
    try {
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
    } catch {}
  }, []);
  useEffect(() => {
    loadDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices);
  }, [loadDevices]);

  // audio + websocket plumbing kept in refs
  const rt = useRef<{ ctx?: AudioContext; stream?: MediaStream; node?: AudioWorkletNode; ws?: WebSocket; stop: boolean; retry: number }>({ stop: true, retry: 0 });

  const connect = useCallback((sid: string, k: string, forceTakeover: boolean) => {
    const r = rt.current;
    const ws = new WebSocket(endpoints.ingestUrl(sid, k, forceTakeover || r.retry > 0));
    ws.binaryType = "arraybuffer";
    r.ws = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "ready") { r.retry = 0; setPhase("live"); }
      if (msg.type === "status") setStats(msg);
    };
    ws.onclose = (e) => {
      if (r.stop) return;
      if (e.code === 4401 || e.code === 4409) {
        toast.error(e.code === 4401 ? "Clave de ingesta o sala inválida" : "Otra fuente está transmitiendo esta sala", { description: e.reason });
        stop();
        return;
      }
      r.retry++;
      setPhase("reconnecting");
      setTimeout(() => !r.stop && connect(sid, k, true), Math.min(1000 * 2 ** r.retry, 10000));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (!sessionId || !key) return toast.error("Elegí la sala y cargá la clave de ingesta");
    setSaved({ ...saved, session: sessionId, key });
    const r = rt.current;
    r.stop = false;
    setPhase("connecting");
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: saved.device ? { exact: saved.device } : undefined,
          channelCount: 1, echoCancellation: false, autoGainControl: saved.agc, noiseSuppression: saved.ns,
        },
      });
      loadDevices();
      r.ctx = new AudioContext();
      await r.ctx.audioWorklet.addModule("/pcm-worklet.js");
      r.node = new AudioWorkletNode(r.ctx, "pcm-worklet", { processorOptions: { targetRate: 16000 } });
      r.node.port.onmessage = ({ data }) => {
        setLevel(20 * Math.log10(Math.max(data.peak, 1e-5)));
        if (r.ws?.readyState === WebSocket.OPEN) r.ws.send(data.pcm);
      };
      r.ctx.createMediaStreamSource(r.stream).connect(r.node);
      connect(sessionId, key, takeover);
    } catch (e) {
      toast.error("No se pudo acceder al audio", { description: (e as Error).message });
      stop();
    }
  }

  function stop() {
    const r = rt.current;
    r.stop = true;
    r.ws?.close();
    r.node?.disconnect();
    r.ctx?.close().catch(() => {});
    r.stream?.getTracks().forEach((t) => t.stop());
    setPhase("idle");
    setLevel(-90);
  }
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const running = phase !== "idle";
  const session = sessions?.find((s) => s.id === sessionId);
  const previewLang = session?.target_langs.find((l) => l !== session.source_lang);
  const { state } = useCaptionStream(running && sessionId ? sessionId : null, previewLang ? ["source", previewLang] : ["source"]);
  const src = selectView(state, "source", false);
  const tr = previewLang ? selectView(state, previewLang, false) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Consola de escenario</h1>
          <p className="text-sm text-muted">Enviá el audio de la sala. Dejá esta pestaña abierta durante la charla.</p>
        </div>
        <Badge tone={phase === "live" ? "live" : phase === "idle" ? "neutral" : "warn"} className="px-3 py-1 text-sm">
          {phase === "live" && <span className="h-2 w-2 rounded-full bg-white animate-live" />}
          {{ idle: "Detenido", connecting: "Conectando…", live: "Transmitiendo", reconnecting: "Reconectando…" }[phase]}
        </Badge>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardContent className="space-y-4">
            <label className="block">
              <Label>Sala</Label>
              <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={running}>
                <option value="">Elegí una sala…</option>
                {sessions?.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
                {sessionId && !sessions?.some((s) => s.id === sessionId) && <option value={sessionId}>{sessionId}</option>}
              </Select>
            </label>
            <label className="block">
              <Label hint="(la da producción)">Clave de ingesta</Label>
              <div className="relative">
                <KeyRound className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} className="pl-9 font-mono" disabled={running} autoComplete="off" />
              </div>
            </label>
            <label className="block">
              <Label>Entrada de audio</Label>
              <div className="flex gap-2">
                <Select value={saved.device} onChange={(e) => setSaved({ ...saved, device: e.target.value })} disabled={running}>
                  <option value="">Micrófono por defecto</option>
                  {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Entrada ${d.deviceId.slice(0, 6)}`}</option>)}
                </Select>
                <Button variant="outline" size="icon" onClick={loadDevices} title="Actualizar"><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </label>
            <div className="divide-y divide-border rounded-xl border border-border px-3">
              <Switch checked={saved.ns} onChange={(v) => setSaved({ ...saved, ns: v })} label="Supresión de ruido" />
              <Switch checked={saved.agc} onChange={(v) => setSaved({ ...saved, agc: v })} label="Ganancia automática" description="Desactivar si viene de consola." />
              <Switch checked={takeover} onChange={setTakeover} label="Reemplazar otra fuente" description="Tomar la sala desde esta computadora." />
            </div>
            <div className="pt-1">
              <LevelMeter db={running ? level : -90} className="h-4" />
              <p className="mt-1 text-xs text-muted">{running && level < -50 ? "Sin señal: revisá micrófono o cable." : "Nivel de entrada"}</p>
            </div>
            {running ? (
              <Button variant="danger" size="lg" className="w-full" onClick={stop}><Square className="h-4 w-4" /> Detener</Button>
            ) : (
              <Button size="lg" className="w-full" onClick={start}><Mic className="h-5 w-5" /> Empezar a transmitir</Button>
            )}
            <p className="flex gap-2 text-xs text-muted">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Mejor calidad con la salida de línea de la consola que con el micrófono de la notebook.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={Clock} label="Al aire" value={formatDuration(stats?.audio_seconds)} />
            <Stat icon={Activity} label="1er subtítulo" value={formatMs(stats?.first_caption_ms)} />
            <Stat icon={Languages} label="Traducción" value={formatMs(stats?.translation_ms)} />
            <Stat icon={DollarSign} label="Costo est." value={formatUsd(stats?.est_cost_usd)}
                  hint={stats ? `${(stats.asr_errors ?? 0) + (stats.mt_errors ?? 0)} errores · ${stats.asr_reconnects ?? 0} reconex.` : undefined} />
          </div>
          <Card>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold"><Radio className="h-4 w-4 text-brand" /> Vista previa</span>
              {sessionId && (
                <Link href={`/s/${encodeURIComponent(sessionId)}`} target="_blank" className="flex items-center gap-1 text-sm text-brand">
                  Vista de audiencia <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            <div className="grid divide-border md:grid-cols-2 md:divide-x">
              <PreviewColumn title={`Original (${session?.source_lang ?? "—"})`} lines={src.lines.slice(-6).map((l) => l.text)} pending={src.pending} />
              {tr && <PreviewColumn title={`Traducción (${previewLang})`} lines={tr.lines.slice(-6).map((l) => l.text)} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PreviewColumn({ title, lines, pending }: { title: string; lines: string[]; pending?: string }) {
  return (
    <div className="min-h-64 p-5">
      <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">{title}</div>
      <div className="space-y-2 text-[17px] leading-snug">
        {lines.map((t, i) => <p key={i} className="caption-in">{t}</p>)}
        {pending && <p className="italic text-muted">{pending}</p>}
        {!lines.length && !pending && <p className="text-muted">Sin subtítulos todavía.</p>}
      </div>
    </div>
  );
}
