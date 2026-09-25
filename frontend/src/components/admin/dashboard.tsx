"use client";

import {
  Activity, AlertTriangle, DollarSign, Download, Eraser, KeyRound, Link2, LogOut, MoreHorizontal, Pencil, Plus,
  QrCode, Radio, RotateCw, Trash2, Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LevelMeter } from "@/components/level-meter";
import { QrDialog } from "@/components/qr-dialog";
import { Stat } from "@/components/stat";
import { LiveBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { usePoll } from "@/hooks/use-poll";
import { ApiError, endpoints, getApiBase } from "@/lib/api";
import { FLAGS } from "@/lib/languages";
import type { Session } from "@/lib/types";
import { cn, formatDuration, formatMs, formatUsd } from "@/lib/utils";
import { frontUrl, LinksDialog } from "./links-dialog";
import { SessionForm } from "./session-form";

const TOKEN_KEY = "cl:admin";

export function AdminDashboard() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(sessionStorage.getItem(TOKEN_KEY) ?? ""), []);
  if (token === null) return null;
  return token ? <Dashboard token={token} onLogout={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); }} />
               : <Login onLogin={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }} />;
}

function Login({ onLogin }: { onLogin: (t: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await endpoints.admin.sessions(value.trim());
      onLogin(value.trim());
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Token incorrecto" : `Sin conexión con ${getApiBase()}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-20">
      <Card>
        <CardContent className="space-y-5 p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft"><KeyRound className="h-6 w-6 text-brand" /></div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Panel de producción</h1>
            <p className="mt-1 text-sm text-muted">Ingresá el token de administración (CL_ADMIN_TOKEN).</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <Label>Token</Label>
              <Input type="password" autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} autoComplete="current-password" />
            </label>
            {error && <p className="text-sm text-live">{error}</p>}
            <Button type="submit" className="w-full" disabled={!value || busy}>{busy ? "Verificando…" : "Entrar"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { data, error, refresh } = usePoll(() => endpoints.admin.sessions(token), 2000, [token]);
  const [editing, setEditing] = useState<Session | null | undefined>(undefined);
  const [links, setLinks] = useState<Session | null>(null);
  const [qr, setQr] = useState<Session | null>(null);

  useEffect(() => { if (error instanceof ApiError && error.status === 401) onLogout(); }, [error, onLogout]);

  const sessions = data ?? [];
  const live = sessions.filter((s) => s.status.live);
  const audience = sessions.reduce((a, s) => a + s.audience_here, 0);
  const cost = sessions.reduce((a, s) => a + (s.status.est_cost_usd ?? 0), 0);
  const errors = live.reduce((a, s) => a + (s.status.asr_errors ?? 0) + (s.status.mt_errors ?? 0), 0);
  const avg = (k: "first_caption_ms" | "translation_ms") => {
    const v = live.map((s) => s.status[k]).filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  async function act(label: string, fn: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    try { await fn(); toast.success(label); refresh(); } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Producción</h1>
          <p className="text-sm text-muted">Estado de todas las salas, actualizado cada 2 s · <span className="font-mono text-xs">{getApiBase().replace(/^https?:\/\//, "")}</span></p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4" /> Nueva sesión</Button>
          <Button variant="outline" size="icon" onClick={onLogout} title="Salir"><LogOut className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Radio} label="En vivo" value={`${live.length}/${sessions.length}`} tone={live.length ? "live" : undefined} />
        <Stat icon={Users} label="Espectadores" value={audience} hint="conectados a este nodo" />
        <Stat icon={Activity} label="1er subtítulo" value={formatMs(avg("first_caption_ms"))} hint="promedio salas en vivo" />
        <Stat icon={Activity} label="Traducción" value={formatMs(avg("translation_ms"))} hint="promedio salas en vivo" />
        <Stat icon={errors ? AlertTriangle : DollarSign} label={errors ? "Errores" : "Costo est."} tone={errors ? "warn" : undefined}
              value={errors ? errors : formatUsd(cost)} hint={errors ? formatUsd(cost) + " acumulado" : "acumulado de la sesión"} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!data && Array.from({ length: 3 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-border bg-surface" />)}
        {sessions.map((s) => (
          <SessionPanel key={s.id} s={s}
            onEdit={() => setEditing(s)} onLinks={() => setLinks(s)} onQr={() => setQr(s)}
            onClear={() => act("Transcripción borrada", () => endpoints.admin.clear(token, s.id), `¿Borrar la transcripción de ${s.id}? Exportala antes si la necesitás.`)}
            onRotate={() => act("Nueva clave generada", () => endpoints.admin.rotateKey(token, s.id), "La fuente actual deberá usar la nueva clave. ¿Continuar?")}
            onDelete={() => act("Sesión eliminada", () => endpoints.admin.remove(token, s.id), `¿Eliminar ${s.id} y su transcripción?`)} />
        ))}
        {data && !sessions.length && (
          <Card className="md:col-span-2 xl:col-span-3"><CardContent className="py-12 text-center text-muted">No hay sesiones. Creá la primera con “Nueva sesión”.</CardContent></Card>
        )}
      </div>

      <SessionForm open={editing !== undefined} onClose={() => setEditing(undefined)} token={token} session={editing ?? null} onSaved={refresh} />
      <LinksDialog session={links} onClose={() => setLinks(null)} />
      <QrDialog open={Boolean(qr)} onClose={() => setQr(null)} title={qr ? `QR · ${qr.title || qr.id}` : ""}
                url={qr ? frontUrl(`/s/${encodeURIComponent(qr.id)}`) : ""} />
    </div>
  );
}

function SessionPanel({ s, onEdit, onLinks, onQr, onClear, onRotate, onDelete }: {
  s: Session; onEdit: () => void; onLinks: () => void; onQr: () => void; onClear: () => void; onRotate: () => void; onDelete: () => void;
}) {
  const st = s.status;
  const silent = st.live && (st.level_db ?? -90) < -55;
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <Card className={cn("flex flex-col", st.live && "border-live/40")}>
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LiveBadge live={st.live} />
            {st.live && <span className="text-xs tabular-nums text-muted">{formatDuration(st.audio_seconds)}</span>}
          </div>
          <h3 className="mt-2 truncate font-semibold tracking-tight">{s.title || s.id}</h3>
          <p className="truncate text-xs text-muted">{[s.room, s.speaker].filter(Boolean).join(" · ") || s.id}</p>
        </div>
        <div className="relative" ref={menuRef}>
          <Button variant="ghost" size="icon" onClick={() => setMenu((m) => !m)} aria-label="Más acciones"><MoreHorizontal className="h-4 w-4" /></Button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl">
              {[
                { icon: Pencil, label: "Editar", fn: onEdit },
                { icon: RotateCw, label: "Nueva clave de ingesta", fn: onRotate },
                { icon: Eraser, label: "Borrar transcripción", fn: onClear },
                { icon: Trash2, label: "Eliminar sesión", fn: onDelete, danger: true },
              ].map(({ icon: Icon, label, fn, danger }) => (
                <button key={label} onClick={() => { setMenu(false); fn(); }}
                        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2", danger && "text-live")}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-5">
        <div>
          <LevelMeter db={st.live ? st.level_db : -90} />
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>{st.live ? `${st.level_db} dBFS` : "Sin audio"}</span>
            {silent && <span className="font-medium text-warn">¿Micrófono muteado?</span>}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ["1er subt.", formatMs(st.first_caption_ms)],
            ["Traducción", formatMs(st.translation_ms)],
            ["Audiencia", s.audience_here],
            ["Errores", st.live ? (st.asr_errors ?? 0) + (st.mt_errors ?? 0) : "—"],
            ["Reconex.", st.live ? st.asr_reconnects ?? 0 : "—"],
            ["Costo", st.est_cost_usd != null ? formatUsd(st.est_cost_usd) : "—"],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-surface-2 px-2 py-1.5">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="text-sm font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {st.last_error && (
          <p className="flex gap-2 rounded-lg bg-warn/10 p-2 text-xs"><AlertTriangle className="h-4 w-4 shrink-0 text-warn" /> <span className="line-clamp-2">{st.last_error}</span></p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {s.languages.map((l) => (
            <span key={l.code} className="rounded-md border border-border px-2 py-0.5 text-xs">
              {FLAGS[l.original ? s.source_lang : l.code] ?? "🌐"} {l.original ? `${s.source_lang} (orig.)` : l.code}
            </span>
          ))}
          {s.glossary.length > 0 && <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs">{s.glossary.length} términos</span>}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border p-3 mt-4">
        <Button variant="secondary" size="sm" onClick={onLinks}><Link2 className="h-4 w-4" /> Enlaces</Button>
        <Button variant="secondary" size="sm" onClick={onQr}><QrCode className="h-4 w-4" /> QR</Button>
        <ExportMenu s={s} />
      </div>
    </Card>
  );
}

function ExportMenu({ s }: { s: Session }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative ml-auto">
      <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}><Download className="h-4 w-4" /> Exportar</Button>
      {open && (
        <div className="absolute right-0 bottom-full z-20 mb-1 w-56 rounded-xl border border-border bg-surface p-2 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {s.languages.map((l) => (
            <div key={l.code} className="flex items-center justify-between gap-2 px-1 py-1 text-sm">
              <span className="truncate">{l.name}</span>
              <span className="flex gap-1">
                {(["srt", "vtt", "txt"] as const).map((f) => (
                  <a key={f} href={endpoints.transcriptUrl(s.id, l.code, f)} download className="rounded-md px-1.5 py-0.5 text-xs uppercase text-brand hover:bg-surface-2">{f}</a>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
