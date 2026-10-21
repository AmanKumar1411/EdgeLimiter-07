import { Link } from "react-router-dom";
import { Skeleton } from "./feedback";
import { cn } from "@/lib/format";

/** A headline number that links to the view explaining it. */
export function StatCard({
  label,
  value,
  hint,
  to,
  danger,
}: {
  label: string;
  value?: string;
  hint?: string;
  to: string;
  danger?: boolean;
}) {
  return (
    <Link to={to} className="block rounded-lg border bg-card p-4 transition-colors hover:border-foreground/25">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {value === undefined ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", danger && "text-danger")}>{value}</div>
      )}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Link>
  );
}

export interface TrafficBar {
  label: string;
  allowed: number;
  blocked: number;
}

/** Stacked allowed/blocked bars; deliberately minimal, no chart library. */
export function TrafficChart({ bars }: { bars: TrafficBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.allowed + b.blocked));
  const ticks = [...new Set([bars[0], bars[Math.floor(bars.length / 2)], bars[bars.length - 1]])];
  const totals = bars.reduce(
    (sum, b) => ({ allowed: sum.allowed + b.allowed, blocked: sum.blocked + b.blocked }),
    { allowed: 0, blocked: 0 },
  );

  return (
    <figure>
      <div className="flex gap-2">
        <div className="flex h-36 flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground">
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="flex h-36 flex-1 items-end gap-[3px] border-b border-l pl-[3px]">
          {bars.map((bar) => (
            <div
              key={bar.label}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${bar.label}: ${bar.allowed} allowed, ${bar.blocked} blocked`}
            >
              <div className="bg-danger/75" style={{ height: `${(bar.blocked / max) * 100}%` }} />
              <div className="bg-muted-foreground/35" style={{ height: `${(bar.allowed / max) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="ml-8 mt-1 flex justify-between text-[11px] text-muted-foreground">
        {ticks.map((tick) => (
          <span key={tick.label}>{tick.label}</span>
        ))}
      </div>
      <figcaption className="mt-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-muted-foreground/35" aria-hidden /> Allowed ({totals.allowed})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-danger/75" aria-hidden /> Blocked ({totals.blocked})
        </span>
      </figcaption>
    </figure>
  );
}
