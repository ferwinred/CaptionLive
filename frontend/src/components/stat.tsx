import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stat({ icon: Icon, label, value, hint, tone }: {
  icon: LucideIcon; label: string; value: React.ReactNode; hint?: string; tone?: "live" | "warn" | "ok";
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
        <Icon className={cn("h-4 w-4", tone === "live" && "text-live", tone === "warn" && "text-warn", tone === "ok" && "text-ok")} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
