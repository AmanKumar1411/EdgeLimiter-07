import { useEffect, useState, useCallback } from "react";
import { ShieldAlert, Brain, Globe, RefreshCw } from "lucide-react";
import { getSecurityReport, type Session } from "../lib/api";
import type { SecurityReport } from "../types/api";
import { StatusBadge } from "../components/StatusBadge";
import { Skeleton, Spinner } from "../components/Loading";
import { ErrorAlert } from "../pages/RegisterPage";

const REFRESH_MS = 60_000;

function scoreTone(score: number): "success" | "warning" | "danger" {
  if (score >= 75) return "danger";
  if (score >= 40) return "warning";
  return "success";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Critical";
  if (score >= 75) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

export function SecurityIntelSection({ session }: { session: Session }) {
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSecurityReport(session.tenantId, session.apiKey);
      setReport(data);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load security report",
      );
    } finally {
      setLoading(false);
    }
  }, [session.tenantId, session.apiKey]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const score = report?.abuseScore ?? 0;
  const tone = scoreTone(score);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">
              Security Intelligence
            </h2>
            {report && (
              <StatusBadge tone={tone} pulse={tone === "danger"}>
                {scoreLabel(score)}
              </StatusBadge>
            )}
          </div>
          <p className="text-muted-foreground">
            AI-powered threat analysis for tenant {session.tenantId}.
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* AI Analysis - left 60% */}
        <div className="glass-card p-6 space-y-5 lg:col-span-3">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Brain className="h-5 w-5 text-secondary" />
              AI Summary
            </h3>
            {report && (
              <StatusBadge tone={tone}>Score {Math.round(score)}%</StatusBadge>
            )}
          </div>

          {loading && !report ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : report ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Abuse Score
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        tone === "danger"
                          ? "bg-destructive"
                          : tone === "warning"
                            ? "bg-warning"
                            : "bg-success"
                      }`}
                      style={{ width: `${Math.min(100, score)}%` }}
                    />
                  </div>
                  <span className="text-2xl font-bold">
                    {Math.round(score)}%
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Summary
                </div>
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                  {report.aiSummary || "No summary available."}
                </p>
              </div>

              {report.recommendation && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                  <div className="text-xs uppercase tracking-wide text-warning mb-1">
                    Recommendation
                  </div>
                  <p className="text-sm text-foreground">
                    {report.recommendation}
                  </p>
                </div>
              )}

              {report.recentLogs && report.recentLogs.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Recent Activity ({report.recentLogs.length})
                  </div>
                  <ul className="space-y-1.5 max-h-48 overflow-auto">
                    {report.recentLogs.slice(0, 8).map((log) => (
                      <li
                        key={log.id}
                        className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded bg-white/5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              log.allowed ? "bg-success" : "bg-destructive"
                            }`}
                          />
                          <span className="font-mono truncate">
                            {log.route}
                          </span>
                          <span className="text-muted-foreground truncate">
                            {log.ipAddress}
                          </span>
                        </div>
                        <span className="text-muted-foreground shrink-0">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-8">
              No analysis data available.
            </div>
          )}
        </div>

        {/* Top IPs - right 40% */}
        <div className="glass-card p-6 space-y-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Top Abusive IPs
            </h3>
            <StatusBadge tone="muted">24h</StatusBadge>
          </div>

          {loading && !report ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !report ||
            !report.topAbusiveIps ||
            report.topAbusiveIps.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8 flex flex-col items-center gap-2">
              <ShieldAlert className="h-7 w-7 opacity-40" />
              No abusive IPs detected.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">IP / Country</th>
                    <th className="px-2 py-2 font-medium text-right">Total</th>
                    <th className="px-2 py-2 font-medium text-right">
                      Blocked
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.topAbusiveIps.slice(0, 10).map((ip) => {
                    const critical = ip.blockedRequests > 50;
                    const high = ip.blockedRequests > 10;
                    return (
                      <tr
                        key={ip.ipAddress}
                        className={`border-t border-border/10 hover:bg-white/5 transition-colors ${
                          critical
                            ? "text-destructive"
                            : high
                              ? "text-warning"
                              : ""
                        }`}
                      >
                        <td className="px-2 py-2.5">
                          <div className="font-mono">{ip.ipAddress}</div>
                          <div className="text-muted-foreground text-[10px]">
                            {ip.country || "—"} · {ip.tenantCount} tenants
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          {ip.totalRequests}
                        </td>
                        <td className="px-2 py-2.5 text-right font-semibold">
                          {ip.blockedRequests}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
