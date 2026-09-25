"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { endpoints } from "@/lib/api";
import { FLAGS, LANGUAGE_NAMES } from "@/lib/languages";
import type { Session, SessionInput } from "@/lib/types";
import { cn } from "@/lib/utils";

const empty: SessionInput = { id: "", title: "", room: "", speaker: "", source_lang: "en", target_langs: ["es"], glossary: [] };
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function SessionForm({ open, onClose, token, session, onSaved }: {
  open: boolean; onClose: () => void; token: string; session: Session | null; onSaved: () => void;
}) {
  const [form, setForm] = useState<SessionInput>(empty);
  const [term, setTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(session);

  useEffect(() => {
    if (!open) return;
    setForm(session ? { id: session.id, title: session.title, room: session.room, speaker: session.speaker,
      source_lang: session.source_lang, target_langs: session.target_langs, glossary: session.glossary } : empty);
    setTerm("");
  }, [open, session]);

  const set = <K extends keyof SessionInput>(k: K, v: SessionInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleLang = (code: string) =>
    set("target_langs", form.target_langs.includes(code) ? form.target_langs.filter((c) => c !== code) : [...form.target_langs, code]);
  const addTerms = (raw: string) => {
    const terms = raw.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
    if (terms.length) set("glossary", Array.from(new Set([...form.glossary, ...terms])));
    setTerm("");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, glossary: term.trim() ? Array.from(new Set([...form.glossary, term.trim()])) : form.glossary };
      await endpoints.admin.upsert(token, body);
      toast.success(editing ? "Sesión actualizada" : "Sesión creada");
      onSaved();
      onClose();
    } catch (err) {
      toast.error("No se pudo guardar", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Editar ${session?.id}` : "Nueva sesión"}
            description="Una sesión = una sala o escenario con su fuente de audio." className="max-w-2xl">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <Label>Título de la charla</Label>
            <Input required value={form.title} placeholder="Kubernetes en producción"
                   onChange={(e) => { set("title", e.target.value); if (!editing) set("id", slugify(e.target.value)); }} />
          </label>
          <label className="block">
            <Label hint="(URL)">ID</Label>
            <Input required value={form.id} disabled={editing} pattern="[a-z0-9][a-z0-9\-]*" className="font-mono"
                   onChange={(e) => set("id", slugify(e.target.value))} />
          </label>
          <label className="block">
            <Label>Sala</Label>
            <Input value={form.room} placeholder="Escenario principal" onChange={(e) => set("room", e.target.value)} />
          </label>
          <label className="block">
            <Label>Orador/a</Label>
            <Input value={form.speaker} onChange={(e) => set("speaker", e.target.value)} />
          </label>
          <label className="block">
            <Label>Idioma hablado</Label>
            <Select value={form.source_lang} onChange={(e) => set("source_lang", e.target.value)}>
              <option value="auto">Detectar automáticamente</option>
              {Object.entries(LANGUAGE_NAMES).map(([c, n]) => <option key={c} value={c}>{FLAGS[c]} {n}</option>)}
            </Select>
          </label>
        </div>

        <div>
          <Label>Traducir a</Label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(LANGUAGE_NAMES).filter(([c]) => c !== form.source_lang).map(([c, n]) => {
              const on = form.target_langs.includes(c);
              return (
                <button key={c} type="button" onClick={() => toggleLang(c)}
                        className={cn("rounded-full border px-3 py-1 text-sm transition",
                          on ? "border-brand bg-brand-soft font-medium" : "border-border text-muted hover:text-fg")}>
                  {FLAGS[c]} {n}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label hint="— términos técnicos, productos y nombres propios">Glosario</Label>
          <div className="rounded-lg border border-border bg-surface p-2 focus-within:border-brand">
            <div className="flex flex-wrap gap-1.5">
              {form.glossary.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs">
                  {t}
                  <button type="button" aria-label={`Quitar ${t}`} onClick={() => set("glossary", form.glossary.filter((g) => g !== t))}>
                    <X className="h-3 w-3 text-muted hover:text-fg" />
                  </button>
                </span>
              ))}
              <input value={term} onChange={(e) => setTerm(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTerms(term); } }}
                     onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/[,\n]/.test(t)) { e.preventDefault(); addTerms(t); } }}
                     placeholder={form.glossary.length ? "" : "Kubernetes, eBPF, Nerdearla… (Enter para agregar)"}
                     className="min-w-40 flex-1 bg-transparent px-1 py-1 text-sm outline-none" />
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">Mejora el reconocimiento de voz y la traducción los mantiene tal cual.</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
