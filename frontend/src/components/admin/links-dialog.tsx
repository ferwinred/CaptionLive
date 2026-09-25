"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { DEFAULT_API, endpoints, getApiBase } from "@/lib/api";
import type { Session } from "@/lib/types";
import { copy } from "@/lib/utils";

export function frontUrl(path: string, params: Record<string, string> = {}) {
  const u = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (getApiBase() !== DEFAULT_API) u.searchParams.set("api", getApiBase());
  return u.toString();
}

function Row({ label, url, secret }: { label: string; url: string; secret?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border p-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-muted">{label}</div>
        <div className="truncate font-mono text-xs">{secret ? url.replace(/key=[^&]+/, "key=••••••") : url}</div>
      </div>
      <button className="rounded-md p-2 hover:bg-surface-2" title="Copiar"
              onClick={async () => { if (await copy(url)) { setDone(true); setTimeout(() => setDone(false), 1500); } }}>
        {done ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className="rounded-md p-2 hover:bg-surface-2" title="Abrir"><ExternalLink className="h-4 w-4" /></a>
    </div>
  );
}

export function LinksDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  if (!session) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  const id = session.id;
  return (
    <Dialog open onClose={onClose} title={`Enlaces · ${session.title || id}`} className="max-w-2xl"
            description="Para la audiencia, el equipo de sala y el streaming (OBS / vMix).">
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Audiencia</h4>
          <Row label="Vista de audiencia" url={frontUrl(`/s/${encodeURIComponent(id)}`)} />
        </section>
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Escenario</h4>
          <Row label="Consola de escenario (incluye la clave: compartir solo con el técnico)" secret
               url={frontUrl("/stage", { session: id, key: session.ingest_key ?? "" })} />
          <Row label="Ingesta por CLI (ffmpeg)" secret
               url={`captionlive ingest --server ${getApiBase()} --session ${id} --key ${session.ingest_key} --input <fuente>`} />
        </section>
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Streaming</h4>
          {session.languages.map((l) => (
            <Row key={`o-${l.code}`} label={`Overlay OBS/vMix (Browser Source) · ${l.name}`}
                 url={frontUrl(`/overlay/${encodeURIComponent(id)}`, { lang: l.code })} />
          ))}
          {session.languages.map((l) => (
            <Row key={`t-${l.code}`} label={`Texto para vMix Data Source · ${l.name}`} url={endpoints.nowUrl(id, l.code)} />
          ))}
        </section>
      </div>
    </Dialog>
  );
}
