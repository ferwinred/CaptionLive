"use client";

import { CheckCircle2, Server, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_API, getApiBase, setApiBase } from "@/lib/api";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input, Label } from "./ui/input";

export function BackendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<"idle" | "ok" | "fail" | "checking">("idle");
  const [info, setInfo] = useState("");
  useEffect(() => {
    if (open) {
      setUrl(getApiBase());
      setCheck("idle");
    }
  }, [open]);

  async function test() {
    setCheck("checking");
    try {
      const r = await fetch(url.replace(/\/$/, "") + "/api/health", { cache: "no-store" });
      const j = await r.json();
      setInfo(`v${j.version} · ASR ${j.asr} · MT ${j.mt}`);
      setCheck(j.ok ? "ok" : "fail");
    } catch {
      setCheck("fail");
      setInfo("No responde (URL, CORS o servidor caído)");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Servidor de CaptionLive" description="La web se conecta a un backend (FastAPI). Podés usar el oficial o uno propio.">
      <label className="block">
        <Label>URL del backend</Label>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://captions.midominio.org" />
      </label>
      <div className="mt-3 flex min-h-6 items-center gap-2 text-sm">
        {check === "ok" && <><CheckCircle2 className="h-4 w-4 text-ok" /> {info}</>}
        {check === "fail" && <><XCircle className="h-4 w-4 text-live" /> {info}</>}
        {check === "checking" && <span className="text-muted">Probando…</span>}
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={() => { setApiBase(null); location.reload(); }}>
          Restablecer ({new URL(DEFAULT_API).host})
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={test}><Server className="h-4 w-4" /> Probar</Button>
          <Button onClick={() => { setApiBase(url.trim()); location.reload(); }} disabled={!/^https?:\/\//.test(url)}>
            Guardar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
