import { cn, levelPercent } from "@/lib/utils";

export function LevelMeter({ db, className, segments = 20 }: { db?: number; className?: string; segments?: number }) {
  const lit = Math.round((levelPercent(db) / 100) * segments);
  return (
    <div className={cn("flex h-3 items-end gap-[3px]", className)} aria-label={`Nivel ${db ?? -90} dBFS`} role="meter"
         aria-valuemin={-60} aria-valuemax={0} aria-valuenow={db ?? -90}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-full flex-1 rounded-[2px] transition-colors duration-75",
            i < lit ? (i >= segments * 0.85 ? "bg-live" : i >= segments * 0.65 ? "bg-warn" : "bg-ok") : "bg-border",
          )}
        />
      ))}
    </div>
  );
}
