import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Activity, Ban, Percent, Users } from "lucide-react";
import {
  getMetrics,
  getTopKeys,
  type MetricsRes,
  type TopKey,
  type Session,
} from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton, Spinner } from "@/components/Loading";
import { ErrorAlert } from "@/pages/RegisterPage";

const REFRESH_MS = 60_000;

function fmt(n: number) {
  return n.toLocaleString();
}

export function SystemOverviewSection({ session }: { session: Session }) {
  const { apiKey } = session;
  const [metrics, setMetrics] = useState<MetricsRes | null>(null);
  const [topKeys, setTopKeys] = useState<TopKey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, t] = await Promise.all([
        getMetrics(apiKey),
        getTopKeys(apiKey),
      ]);
      setMetrics(m.data);
      setTopKeys(Array.isArray(t.data) ? t.data : []);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load system metrics",
      );
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const activeKeys = topKeys?.length ?? 0;
  const cards = [
    {
      label: "Total Requests",
      value: metrics ? fmt(metrics.totalRequests) : null,
      icon: Activity,
      tone: "primary" as const,
    },
    {
      label: "Blocked",
      value: metrics ? fmt(metrics.blockedRequests) : null,
      icon: Ban,
      tone: "danger" as const,
    },
    {
      label: "Block Rate",
      value: metrics ? metrics.blockRate : null,
      icon: Percent,
      tone: "warning" as const,
    },
    {
      label: "Active Keys",
      value: topKeys ? fmt(activeKeys) : null,
      icon: Users,
      tone: "secondary" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">System Overview</h2>
          <p className="text-muted-foreground">
            Platform-wide rate limiting and abuse signals across all tenants.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge tone="success" pulse>
            Live
          </StatusBadge>
          {updatedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {updatedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="btn-outline !py-2 text-sm"
          >
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </header>

      {error && <ErrorAlert message={error} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          const color =
            c.tone === "danger"
              ? "text-destructive"
              : c.tone === "warning"
                ? "text-warning"
                : c.tone === "secondary"
                  ? "text-secondary"
                  : "text-primary";
          return (
            <div key={c.label} className="glass-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </span>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              {loading && c.value === null ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className={`text-3xl font-bold ${color}`}>
                  {c.value ?? "—"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
