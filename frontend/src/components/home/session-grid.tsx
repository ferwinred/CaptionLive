"use client";

import { AlertTriangle, MapPin, Mic2, Search, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LiveBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/hooks/use-poll";
import { endpoints, getApiBase } from "@/lib/api";
import { FLAGS } from "@/lib/languages";
import type { Session } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

export function SessionGrid() {
  const { data, error, loading } = usePoll(endpoints.sessions, 8000);
  const [q, setQ] = useState("");
  const sessions = useMemo(() => {
    const list = (data ?? []).filter((s) =>
      [s.title, s.speaker, s.room, s.id].join(" ").toLowerCase().includes(q.toLowerCase()),
    );
    return list.sort((a, b) => Number(b.status.live) - Number(a.status.live));
  }, [data, q]);
  const live = (data ?? []).filter((s) => s.status.live).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Salas</h2>
          <p className="text-sm text-muted">
            {data ? `${live} en vivo de ${data.length}` : "Cargando…"}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar charla, orador o sala" className="pl-9" />
        </div>
      </div>

      {error && !data && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <div>
            No se pudo conectar con el servidor <code className="font-mono">{getApiBase()}</code>.
            <div className="text-muted">Probá de nuevo en unos segundos o configurá otro servidor desde el ícono de servidor arriba.</div>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading && !data &&
          Array.from({ length: 3 }, (_, i) => <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-surface" />)}
        {sessions.map((s) => <SessionCard key={s.id} s={s} />)}
        {data && !sessions.length && <p className="text-muted">No hay salas que coincidan.</p>}
      </div>
    </div>
  );
}

function SessionCard({ s }: { s: Session }) {
  return (
    <Link
      href={`/s/${encodeURIComponent(s.id)}`}
      className="group relative flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <LiveBadge live={s.status.live} />
        {s.status.live && (
          <span className="text-xs tabular-nums text-muted">{formatDuration(s.status.audio_seconds)}</span>
        )}
      </div>
      <h3 className="mt-4 text-lg font-semibold leading-snug tracking-tight group-hover:text-brand">{s.title || s.id}</h3>
      <div className="mt-2 space-y-1 text-sm text-muted">
        {s.speaker && <div className="flex items-center gap-2"><Mic2 className="h-3.5 w-3.5" /> {s.speaker}</div>}
        {s.room && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {s.room}</div>}
      </div>
      <div className="mt-auto flex items-center justify-between pt-5">
        <div className="flex flex-wrap gap-1.5">
          {s.languages.map((l) => (
            <span key={l.code} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs" title={l.name}>
              {FLAGS[l.original ? s.source_lang : l.code] ?? "🌐"} {l.original ? `${s.source_lang.toUpperCase()} · original` : l.code.toUpperCase()}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-1 text-xs text-muted"><Users className="h-3.5 w-3.5" /> {s.audience_here}</span>
      </div>
    </Link>
  );
}
