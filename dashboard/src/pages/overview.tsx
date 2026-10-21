import { ArrowRight, BellOff, Inbox, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorMessage, SkeletonRows } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, TrafficChart, type TrafficBar } from "@/components/ui/stats";
import { api, type RequestLog } from "@/lib/api";
import { formatNumber, formatTime, parseTimestamp } from "@/lib/format";
import { SEVERITY_TONE, severityOf } from "@/lib/limits";
import { useTenant } from "@/lib/tenant";
import { useApi } from "@/lib/use-api";

const REFRESH_MS = 30_000;

/** Requests per minute, ending at the newest log: at least 15, at most 30 bars. */
function trafficByMinute(logs: RequestLog[]): TrafficBar[] {
  if (!logs.length) return [];
  const minuteOf = (log: RequestLog) => Math.floor(parseTimestamp(log.createdAt).getTime() / 60_000);
  const minutes = logs.map(minuteOf);
  const last = Math.max(...minutes);
  const first = Math.max(Math.min(Math.min(...minutes), last - 14), last - 29);

  const bars = new Map<number, TrafficBar>();
  for (let m = first; m <= last; m++) {
    const label = new Date(m * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    bars.set(m, { label, allowed: 0, blocked: 0 });
  }
  for (const log of logs) {
    const bar = bars.get(minuteOf(log));
    if (bar) bar[log.allowed ? "allowed" : "blocked"] += 1;
  }
  return [...bars.values()];
}

function limitedRoutes(logs: RequestLog[]) {
  const byRoute = new Map<string, { route: string; total: number; limited: number }>();
  for (const log of logs) {
    if (!log.route) continue;
    const row = byRoute.get(log.route) ?? { route: log.route, total: 0, limited: 0 };
    row.total += 1;
    if (log.reason === "rate_limit_exceeded") row.limited += 1;
    byRoute.set(log.route, row);
  }
  return [...byRoute.values()].sort((a, b) => b.limited - a.limited || b.total - a.total).slice(0, 5);
}

export function Overview() {
  const { tenantId, session, basePath, isOwnTenant } = useTenant();
  const key = session.apiKey;
  const metrics = useApi(`tenantMetrics:${key}:${tenantId}`, () => api.tenantMetrics(key, tenantId), REFRESH_MS);
  const report = useApi(`securityReport:${key}:${tenantId}`, () => api.securityReport(tenantId, key), REFRESH_MS);
  const topKeys = useApi(`topKeys:${key}:${tenantId}`, () => api.topKeys(key, tenantId), REFRESH_MS);
  const audit = useApi(`auditLog:${key}:${tenantId}`, () => api.auditLog(tenantId, key), REFRESH_MS);
  const policies = useApi(`policies:${key}:${tenantId}`, () => api.policies(tenantId, key));

  const sources = [metrics, report, topKeys, audit, policies];
  const error = sources.find((s) => s.error)?.error;
  const refresh = () => sources.forEach((s) => s.reload());

  const logs = report.data?.recentLogs ?? [];
  const alerts = (audit.data ?? []).filter((entry) => entry.action_type === "rate_limit_block").slice(0, 5);
  const severity = report.data ? severityOf(report.data.abuseScore) : undefined;
  const activity = `${basePath}/activity`;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Requests checked against your limits, and what was blocked."
        actions={
          <Button onClick={refresh}>
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        }
      />

      {error && <ErrorMessage message={error} onRetry={refresh} className="mb-4" />}

      {isOwnTenant && policies.data?.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
          <div>
            <div className="font-medium">Finish setting up</div>
            <p className="text-sm text-muted-foreground">Add your first limit and send a test request. It takes a minute.</p>
          </div>
          <Link to={`${basePath}/setup`} className={buttonVariants({ variant: "primary" })}>
            Get started <ArrowRight aria-hidden />
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Requests"
          value={metrics.data && formatNumber(metrics.data.totalRequests)}
          hint="All time, allowed and blocked"
          to={activity}
        />
        <StatCard
          label="Blocked"
          value={metrics.data && formatNumber(metrics.data.blockedRequests)}
          hint="Rejected for being over a limit"
          to={`${activity}?outcome=limited`}
          danger={Boolean(metrics.data?.blockedRequests)}
        />
        <StatCard
          label="Block rate"
          value={metrics.data?.blockRate}
          hint="Blocked ÷ requests"
          to={`${activity}?outcome=limited`}
        />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent traffic"
          description={logs.length ? `Last ${logs.length} requests, per minute` : undefined}
          actions={
            <Link to={activity} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              View activity
            </Link>
          }
        />
        <div className="p-4">
          {report.loading && !report.data ? (
            <SkeletonRows rows={4} />
          ) : logs.length ? (
            <TrafficChart bars={trafficByMinute(logs)} />
          ) : (
            <EmptyState
              icon={Inbox}
              title="No requests yet"
              description="Requests appear here a few seconds after your backend calls /check."
              action={
                isOwnTenant && (
                  <Link to={`${basePath}/playground`} className={buttonVariants()}>
                    Send a test request
                  </Link>
                )
              }
            />
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Most limited routes" description="In recent requests" />
          {report.loading && !report.data ? (
            <SkeletonRows />
          ) : (
            <ul className="divide-y">
              {limitedRoutes(logs).map((row) => (
                <li key={row.route}>
                  <Link
                    to={`${activity}?route=${encodeURIComponent(row.route)}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/60"
                  >
                    <span className="truncate font-mono text-[13px]">{row.route}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      <span className={row.limited ? "text-danger" : undefined}>{row.limited} blocked</span> of{" "}
                      {row.total}
                    </span>
                  </Link>
                </li>
              ))}
              {!logs.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No data yet.</li>}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Top API keys" description="By blocked requests" />
          {topKeys.loading && !topKeys.data ? (
            <SkeletonRows />
          ) : (
            <ul className="divide-y">
              {(topKeys.data ?? []).slice(0, 5).map((row) => (
                <li key={row.apiKey}>
                  <Link
                    to={`${activity}?key=${encodeURIComponent(row.apiKey)}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/60"
                  >
                    <span className="truncate font-mono text-[13px]">{row.apiKey}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatNumber(row.totalRequests)} requests ·{" "}
                      <span className={row.blockedRequests ? "text-danger" : undefined}>
                        {formatNumber(row.blockedRequests)} blocked
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {!topKeys.data?.length && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">No data yet.</li>
              )}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent alerts"
          actions={
            <Link to={`${basePath}/audit`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Audit log
            </Link>
          }
        />
        {severity && report.data && (
          <Link to={activity} className="flex items-start gap-3 border-b px-4 py-3 hover:bg-muted/60">
            <Badge tone={SEVERITY_TONE[severity]}>{severity} risk</Badge>
            <p className="line-clamp-2 text-sm text-muted-foreground">{report.data.aiSummary}</p>
          </Link>
        )}
        {alerts.length ? (
          <ul className="divide-y">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <span className="text-sm">{alert.message}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatTime(alert.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={BellOff} title="No alerts" description="You'll see an entry here when a limit starts blocking requests." />
        )}
      </Card>
    </>
  );
}
