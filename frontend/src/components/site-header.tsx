"use client";

import { LayoutDashboard, Mic, Radio, Server } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BackendDialog } from "./backend-dialog";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";

const nav = [
  { href: "/", label: "Sesiones", icon: Radio },
  { href: "/stage", label: "Escenario", icon: Mic },
  { href: "/admin", label: "Producción", icon: LayoutDashboard },
];

export function SiteHeader() {
  const path = usePathname();
  const [backend, setBackend] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" || path.startsWith("/s/") : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setBackend(true)} title="Servidor" aria-label="Servidor">
            <Server className="h-[18px] w-[18px]" />
          </Button>
          <ThemeToggle />
          <a href="https://github.com/ferwinred/CaptionLive" target="_blank" rel="noreferrer" aria-label="GitHub"
             className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-2">
            <GithubIcon />
          </a>
        </div>
      </div>
      <nav className="flex border-t border-border/70 md:hidden">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={cn("flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium",
              (href === "/" ? path === "/" : path.startsWith(href)) ? "text-brand" : "text-muted")}>
            <Icon className="h-4 w-4" /> {label}
          </Link>
        ))}
      </nav>
      <BackendDialog open={backend} onClose={() => setBackend(false)} />
    </header>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
