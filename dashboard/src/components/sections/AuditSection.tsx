import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { useActivity, formatRelative } from "@/lib/activity";
import { getAuditReport, type AuditLog, type Session } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton, Spinner } from "@/components/Loading";
import { ErrorAlert } from "@/pages/RegisterPage";

const REFRESH_MS = 60_000;

function severityTone(severity: AuditLog["severity"]) {
  if (severity === "Critical" || severity === "High") return "danger";
  if (severity === "Medium") return "warning";
  return "muted";
}

/**
 * Server-side audit trail for the tenant (policy changes, resets, key
 * actions, rate-limit block streaks), plus this browser's session activity.
 */
export function AuditSection({
  session,
  viewedTenantId,
}: {
  session: Session;
  viewedTenantId?: string;
}) {
  const tenantId = viewedTenantId ?? session.tenantId;
  const items = useActivity();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getAuditReport(tenantId, session.apiKey);
      setLogs(data.auditLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [tenantId, session.apiKey]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Audit Log</h2>
          <p className="text-muted-foreground">
            Recorded actions for tenant{" "}
            <code className="font-mono text-primary">{tenantId}</code>.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="btn-outline !py-2 text-sm"
        >
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </header>

      {error && <ErrorAlert message={error} />}

      <div className="glass-card p-6">
        {loading && !logs ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !logs || logs.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12 flex flex-col items-center gap-3">
            <ScrollText className="h-8 w-8 opacity-40" />
            No audit entries yet. Saving a policy, resetting a counter or
            hitting a limit will appear here.
          </div>
        ) : (
          <ul className="divide-y divide-border/10">
            {logs.map((log) => (
              <li key={log.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={severityTone(log.severity)}>{log.severity}</StatusBadge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {log.action_type}
                    </span>
                    <span className="text-xs text-muted-foreground">by {log.actor}</span>
                  </div>
                  <div className="text-sm text-foreground break-words">{log.message}</div>
                  {log.api_key_hint && (
                    <div className="text-xs text-muted-foreground font-mono">{log.api_key_hint}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length > 0 && (
        <div className="glass-card p-6 space-y-3">
          <h3 className="font-semibold text-sm">This session</h3>
          <ul className="divide-y divide-border/10">
            {items.map((item) => (
              <li
                key={item.id}
                className="py-2.5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-sm truncate">{item.title}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {item.detail}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {formatRelative(item.timestamp)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
