import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "live" | "brand" | "warn" | "ok";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  live: "bg-live text-white border-transparent",
  brand: "bg-brand-soft text-fg border-transparent",
  warn: "bg-warn/20 text-fg border-warn/40",
  ok: "bg-ok/15 text-fg border-ok/30",
};

export function Badge({ className, tone = "neutral", ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...p}
    />
  );
}

export function LiveBadge({ live, className }: { live: boolean; className?: string }) {
  return live ? (
    <Badge tone="live" className={cn("uppercase tracking-wider", className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-white animate-live" /> En vivo
    </Badge>
  ) : (
    <Badge className={cn("uppercase tracking-wider", className)}>Offline</Badge>
  );
}
