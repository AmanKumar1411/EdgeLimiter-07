import { useEffect, useState, useCallback } from "react";
import { RefreshCw, KeyRound } from "lucide-react";
import { getTopKeys, type TopKey, type Session } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton, Spinner } from "@/components/Loading";
import { ErrorAlert } from "@/pages/RegisterPage";

const REFRESH_MS = 60_000;

function fmt(n: number) {
  return n.toLocaleString();
}

export function TopKeysSection({ session }: { session: Session }) {
  const { apiKey } = session;
  const [keys, setKeys] = useState<TopKey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getTopKeys(apiKey);
      setKeys(Array.isArray(data) ? data : []);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load top keys");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Top API Keys</h2>
          <p className="text-muted-foreground">
            Most active API keys across all tenants, ranked by total traffic and
            abuse score.
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

      <div className="glass-card p-6">
        {loading && !keys ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !keys || keys.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10 flex flex-col items-center gap-2">
            <KeyRound className="h-7 w-7 opacity-40" />
            No keys recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">API Key</th>
                  <th className="px-2 py-2 font-medium text-right">Total</th>
                  <th className="px-2 py-2 font-medium text-right">Blocked</th>
                  <th className="px-2 py-2 font-medium text-right">Abuse</th>
                  <th className="px-2 py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr
                    key={k.apiKey}
                    className="border-t border-border/10 hover:bg-white/5 transition-colors"
                  >
                    <td
                      className="px-2 py-3 font-mono text-xs text-primary truncate max-w-[260px]"
                      title={k.apiKey}
                    >
                      {k.apiKey}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {fmt(k.totalRequests)}
                    </td>
                    <td className="px-2 py-3 text-right text-destructive">
                      {fmt(k.blockedRequests)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <span
                        className={`font-medium ${
                          k.abuseScore > 70
                            ? "text-destructive"
                            : k.abuseScore > 40
                              ? "text-warning"
                              : "text-success"
                        }`}
                      >
                        {Math.round(k.abuseScore)}%
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <StatusBadge
                        tone={
                          k.abuseScore > 70
                            ? "danger"
                            : k.abuseScore > 40
                              ? "warning"
                              : "success"
                        }
                      >
                        {k.abuseScore > 70
                          ? "High"
                          : k.abuseScore > 40
                            ? "Medium"
                            : "Healthy"}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
