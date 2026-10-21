import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Eye, ChevronLeft, KeyRound } from "lucide-react";
import { getTopKeys, type TopKey, type Session } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton, Spinner } from "@/components/Loading";
import { ErrorAlert } from "@/pages/RegisterPage";
import { LiveControlSection } from "./LiveControlSection";
import { PoliciesSection } from "./PoliciesSection";
import { AnalyticsSection } from "./AnalyticsSection";
import { OperationsSection } from "./OperationsSection";
import { SecurityIntelSection } from "./SecurityIntelSection";
import { KeysSection } from "./KeysSection";
import { AuditSection } from "./AuditSection";

interface TenantRow {
  tenantId: string;
  totalRequests: number;
  blockedRequests: number;
  abuseScore: number;
  apiKey: string;
}

function rowsFromTopKeys(keys: TopKey[]): TenantRow[] {
  const map = new Map<string, TenantRow>();
  for (const k of keys) {
    // Skip entries where we don't know the real tenant.
    if (!k.tenantId) continue;
    const existing = map.get(k.tenantId);
    if (existing) {
      existing.totalRequests += k.totalRequests;
      existing.blockedRequests += k.blockedRequests;
      existing.abuseScore = Math.max(existing.abuseScore, k.abuseScore);
    } else {
      map.set(k.tenantId, {
        tenantId: k.tenantId,
        totalRequests: k.totalRequests,
        blockedRequests: k.blockedRequests,
        abuseScore: k.abuseScore,
        apiKey: k.apiKey,
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.totalRequests - a.totalRequests,
  );
}

type SubTab =
  | "live"
  | "policies"
  | "analytics"
  | "security"
  | "operations"
  | "keys"
  | "audit";

export function TenantsSection({
  session,
  onTenantChange,
}: {
  session: Session;
  onTenantChange: (id: string) => void;
}) {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("analytics");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getTopKeys(session.apiKey);
      setTenants(rowsFromTopKeys(Array.isArray(data) ? data : []));
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, [session.apiKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (selected) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => setSelected(null)}
            className="btn-outline !py-2 text-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to tenants
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Viewing
            </span>
            <code className="font-mono text-primary">{selected}</code>
            <StatusBadge tone="secondary">Admin Drill-Down</StatusBadge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border/10 pb-2">
          {(
            [
              ["analytics", "Analytics"],
              ["live", "Live Control"],
              ["policies", "Policies"],
              ["security", "Security"],
              ["operations", "Operations"],
              ["keys", "API Keys"],
              ["audit", "Audit"],
            ] as [SubTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                subTab === id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {subTab === "analytics" && (
          <AnalyticsSection session={session} viewedTenantId={selected} />
        )}
        {subTab === "live" && (
          <LiveControlSection
            session={session}
            onTenantChange={onTenantChange}
            viewedTenantId={selected}
          />
        )}
        {subTab === "policies" && (
          <PoliciesSection
            session={session}
            onTenantChange={onTenantChange}
            viewedTenantId={selected}
          />
        )}
        {subTab === "security" && (
          <SecurityIntelSection session={session} viewedTenantId={selected} />
        )}
        {subTab === "keys" && (
          <KeysSection session={session} viewedTenantId={selected} />
        )}
        {subTab === "audit" && (
          <AuditSection session={session} viewedTenantId={selected} />
        )}
        {subTab === "operations" && (
          <OperationsSection
            session={session}
            onTenantChange={onTenantChange}
            viewedTenantId={selected}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Tenants</h2>
          <p className="text-muted-foreground">
            All client tenants observed on the platform. Drill in to inspect any
            tenant's traffic.
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
        {loading && !tenants ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !tenants || tenants.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10 flex flex-col items-center gap-2">
            <KeyRound className="h-7 w-7 opacity-40" />
            No tenants observed yet. Register one to get started.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Tenant</th>
                  <th className="px-2 py-2 font-medium text-right">Requests</th>
                  <th className="px-2 py-2 font-medium text-right">Blocked</th>
                  <th className="px-2 py-2 font-medium text-right">Abuse</th>
                  <th className="px-2 py-2 font-medium text-right">Status</th>
                  <th className="px-2 py-2 font-medium text-right" />
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const blockRate =
                    t.totalRequests > 0
                      ? (t.blockedRequests / t.totalRequests) * 100
                      : 0;
                  return (
                    <tr
                      key={t.tenantId}
                      className="border-t border-border/10 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-2 py-3 font-mono text-primary">
                        {t.tenantId}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {t.totalRequests.toLocaleString()}
                      </td>
                      <td className="px-2 py-3 text-right text-destructive">
                        {t.blockedRequests.toLocaleString()}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({blockRate.toFixed(1)}%)
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <span
                          className={`font-medium ${
                            t.abuseScore > 70
                              ? "text-destructive"
                              : t.abuseScore > 40
                                ? "text-warning"
                                : "text-success"
                          }`}
                        >
                          {Math.round(t.abuseScore)}%
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <StatusBadge
                          tone={t.totalRequests > 0 ? "success" : "muted"}
                        >
                          {t.totalRequests > 0 ? "Active" : "Idle"}
                        </StatusBadge>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <button
                          onClick={() => setSelected(t.tenantId)}
                          className="btn-outline !py-1.5 !px-3 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
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
  );
}
