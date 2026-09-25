import { ArrowRight, Download, Globe2, Languages, MonitorPlay, ShieldCheck, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { SessionGrid } from "@/components/home/session-grid";

const features = [
  { icon: Zap, title: "Tiempo real", text: "Subtítulos parciales en menos de un segundo con Gemini Live; las oraciones se traducen apenas quedan estables." },
  { icon: Languages, title: "Multilingüe", text: "Idioma original + español, inglés, portugués y más. Un glosario por sala cuida los términos técnicos." },
  { icon: Globe2, title: "A escala", text: "Decenas de salas en paralelo y miles de espectadores por nodo. Stateless + Redis para crecer." },
  { icon: MonitorPlay, title: "OBS / vMix", text: "Overlay transparente para quemar subtítulos en el stream y fuente de texto para vMix." },
  { icon: Download, title: "Exportación", text: "Transcripción completa en SRT, VTT o TXT al terminar cada charla." },
  { icon: ShieldCheck, title: "Open source", text: "Apache-2.0. Modo 100 % local con Whisper + Gemma para eventos sin nube." },
];

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-brand" /> Vibeathon Nerdearla 2026 · powered by Gemini
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">
            Cada charla, <span className="text-brand">en tu idioma</span>, mientras sucede.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted text-pretty">
            CaptionLive transcribe y traduce el audio de cada escenario en tiempo real. Elegí una sala, elegí tu idioma y seguí la charla
            desde el celular, la pantalla de la sala o el stream.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#salas" className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand px-6 font-medium text-brand-fg shadow-sm hover:brightness-110">
              Ver salas en vivo <ArrowRight className="h-4 w-4" />
            </a>
            <Link href="/admin" className="inline-flex h-12 items-center gap-2 rounded-lg border border-border px-6 font-medium hover:bg-surface-2">
              Soy organizador
            </Link>
          </div>
        </div>
      </section>

      <section id="salas" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12 sm:px-6">
        <SessionGrid />
      </section>

      <section className="border-t border-border/70 bg-surface/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight">Pensado para conferencias reales</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft">
                  <Icon className="h-5 w-5 text-brand" />
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
