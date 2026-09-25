import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <rect x="6" y="17" width="20" height="3.2" rx="1.6" className="fill-brand-fg" />
      <rect x="6" y="22.5" width="13" height="3.2" rx="1.6" className="fill-brand-fg" opacity=".7" />
      <circle cx="24" cy="9" r="3" fill="#fff" className="animate-live" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2 font-bold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">
        Caption<span className="text-brand">Live</span>
      </span>
    </Link>
  );
}
