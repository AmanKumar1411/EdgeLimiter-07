import { useEffect, useState, useCallback } from "react";
import { RefreshCw, TrendingUp, AlertTriangle } from "lucide-react";
import { fetchMetrics, fetchTopKeys } from "../lib/api";
import type { MetricsResponse, TopKey } from "../types/api";
import { StatusBadge } from "../components/StatusBadge";
import { Skeleton, Spinner } from "../components/Loading";
import { ErrorAlert } from "../pages/RegisterPage";

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function AnalyticsSection() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [topKeys, setTopKeys] = useState<TopKey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, t] = await Promise.all([fetchMetrics(), fetchTopKeys()]);
      setMetrics(m);
      setTopKeys(Array.isArray(t) ? t : []);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground">
            Traffic volume and abuse signals across the edge.
          </p>
        </div>
        <div className="flex items-center gap-3">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Traffic Summary */}
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Traffic Summary
              </h3>
              <p className="text-sm text-muted-foreground">
                Edge request totals and block rate
              </p>
            </div>
            <StatusBadge tone="success" pulse>
              Live
            </StatusBadge>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Total Requests"
              value={metrics ? formatNumber(metrics.totalRequests) : null}
              loading={loading && !metrics}
            />
            <MetricCard
              label="Blocked"
              value={metrics ? formatNumber(metrics.blockedRequests) : null}
              tone="danger"
              loading={loading && !metrics}
            />
            <MetricCard
              label="Block Rate"
              value={metrics ? metrics.blockRate : null}
              tone="warning"
              loading={loading && !metrics}
            />
          </div>
        </div>

        {/* Top API Keys */}
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" />
                Top API Keys
              </h3>
              <p className="text-sm text-muted-foreground">
                Highest blocked volume in the last window
              </p>
            </div>
            <StatusBadge tone="warning">Monitor</StatusBadge>
          </div>

          {loading && !topKeys ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !topKeys || topKeys.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border/10 rounded-lg">
              No traffic data captured yet.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">API Key</th>
                    <th className="px-2 py-2 font-medium text-right">Total</th>
                    <th className="px-2 py-2 font-medium text-right">
                      Blocked
                    </th>
                    <th className="px-2 py-2 font-medium text-right">Abuse</th>
                  </tr>
                </thead>
                <tbody>
                  {topKeys.slice(0, 5).map((k) => (
                    <tr
                      key={k.apiKey}
                      className="border-t border-border/10 hover:bg-white/5 transition-colors"
                    >
                      <td
                        className="px-2 py-2.5 font-mono text-xs text-primary truncate max-w-[150px]"
                        title={k.apiKey}
                      >
                        {k.apiKey}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {formatNumber(k.totalRequests)}
                      </td>
                      <td className="px-2 py-2.5 text-right text-destructive">
                        {formatNumber(k.blockedRequests)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {(() => {
                          const score = Number(k.abuseScore);
                          const safeScore = Number.isFinite(score) ? score : 0;
                          return (
                            <span
                              className={`font-medium ${
                                safeScore > 70
                                  ? "text-destructive"
                                  : safeScore > 40
                                    ? "text-warning"
                                    : "text-success"
                              }`}
                            >
                              {Math.round(safeScore)}%
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string | null;
  tone?: "danger" | "warning";
  loading?: boolean;
}) {
  const color =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : "text-foreground";
  return (
    <div className="rounded-lg bg-white/5 border border-border/10 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-20 mt-2" />
      ) : (
        <div className={`text-2xl font-bold mt-1 ${color}`}>{value ?? "—"}</div>
      )}
    </div>
  );
}
