import { SiteHeader } from "@/components/site-header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border/70 py-8 text-sm text-muted">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <span>CaptionLive · open source (Apache-2.0) · Vibeathon Nerdearla 2026</span>
          <span>Gemini Live · Next.js · FastAPI</span>
        </div>
      </footer>
    </div>
  );
}
