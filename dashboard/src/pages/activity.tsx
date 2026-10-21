import { Inbox, RefreshCw, SearchX } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorMessage, SkeletonRows } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, Table, Td, Th, usePagination } from "@/components/ui/table";
import { api, type RequestLog } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { SEVERITY_TONE, describeOutcome, outcomeOf, severityOf, type Outcome } from "@/lib/limits";
import { useTenant } from "@/lib/tenant";
import { useApi } from "@/lib/use-api";

const OUTCOME_TONE = { allowed: "success", limited: "danger", rejected: "warning" } as const;

const OUTCOME_FILTERS: { value: Outcome | ""; label: string }[] = [
  { value: "", label: "All outcomes" },
  { value: "allowed", label: "Allowed" },
  { value: "limited", label: "Rate limited" },
  { value: "rejected", label: "Rejected (auth, no limit, bad request)" },
];

function matches(log: RequestLog, filters: { outcome: string; route: string; key: string; q: string }) {
  if (filters.outcome && outcomeOf(log) !== filters.outcome) return false;
  if (filters.route && log.route !== filters.route) return false;
  if (filters.key && log.apiKey !== filters.key) return false;
  if (filters.q) {
    const haystack = [log.ipAddress, log.country, log.apiKey, log.route].join(" ").toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

export function Activity() {
  const { tenantId, session } = useTenant();
  const report = useApi(
    `securityReport:${tenantId}:${session.apiKey}`,
    () => api.securityReport(tenantId, session.apiKey),
    15_000,
  );
  const [params, setParams] = useSearchParams();
  const filters = {
    outcome: params.get("outcome") ?? "",
    route: params.get("route") ?? "",
    key: params.get("key") ?? "",
    q: params.get("q") ?? "",
  };

  function setFilter(name: keyof typeof filters, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  }

  const logs = report.data?.recentLogs ?? [];
  const routes = [...new Set(logs.map((log) => log.route).filter(Boolean))].sort();
  const filtered = logs.filter((log) => matches(log, filters));
  const page = usePagination(filtered);
  const filtering = Object.values(filters).some(Boolean);
  const severity = report.data ? severityOf(report.data.abuseScore) : undefined;

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every /check call for this project, newest first. Updates every 15 seconds."
        actions={
          <Button onClick={report.reload}>
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        }
      />

      {report.error && <ErrorMessage message={report.error} onRetry={report.reload} className="mb-4" />}

      {report.data && severity && (
        <Card className="mb-4">
          <CardHeader
            title="Threat summary"
            description={
              report.data.intelligenceSource === "ai"
                ? `Workers AI · ${formatDateTime(report.data.generatedAt)}`
                : "Rule-based analysis"
            }
            actions={<Badge tone={SEVERITY_TONE[severity]}>{severity} risk</Badge>}
          />
          <div className="space-y-2 px-4 py-3 text-sm">
            <p>{report.data.aiSummary}</p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Recommendation:</span> {report.data.recommendation}
            </p>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input
            type="search"
            aria-label="Search by IP, country, key or route"
            placeholder="Search IP, country, key…"
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
            className="w-full sm:w-64"
          />
          <Select
            aria-label="Outcome"
            value={filters.outcome}
            onChange={(e) => setFilter("outcome", e.target.value)}
            className="w-full sm:w-auto"
          >
            {OUTCOME_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Route"
            value={filters.route}
            onChange={(e) => setFilter("route", e.target.value)}
            className="w-full sm:w-auto"
          >
            <option value="">All routes</option>
            {routes.map((route) => (
              <option key={route} value={route}>
                {route}
              </option>
            ))}
          </Select>
          {filters.key && <Badge tone="accent">Key {filters.key}</Badge>}
          {filtering && (
            <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatNumber(filtered.length)} of {logs.length} recent requests
          </span>
        </div>

        {report.loading && !report.data ? (
          <SkeletonRows rows={6} />
        ) : !logs.length ? (
          <EmptyState
            icon={Inbox}
            title="No requests yet"
            description="Requests show up here a few seconds after your backend calls /check."
          />
        ) : !filtered.length ? (
          <EmptyState
            icon={SearchX}
            title="No requests match these filters"
            description="Try another route or outcome, or clear the filters."
            action={<Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Route</Th>
                  <Th>Outcome</Th>
                  <Th>API key</Th>
                  <Th>IP</Th>
                  <Th>Country</Th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((log) => (
                  <tr key={log.id}>
                    <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(log.createdAt)}</Td>
                    <Td className="font-mono">{log.route || "—"}</Td>
                    <Td>
                      <Badge tone={OUTCOME_TONE[outcomeOf(log)]}>{describeOutcome(log)}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-muted-foreground">{log.apiKey ?? "—"}</Td>
                    <Td className="font-mono text-muted-foreground">{log.ipAddress ?? "—"}</Td>
                    <Td className="text-muted-foreground">{log.country ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination {...page} />
          </>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Top IPs" description="Last 24 hours, by requests blocked for this project" />
        {report.data?.topAbusiveIps.length ? (
          <Table>
            <thead>
              <tr>
                <Th>IP</Th>
                <Th>Country</Th>
                <Th className="text-right">Requests</Th>
                <Th className="text-right">Blocked</Th>
                <Th className="text-right">Projects seen</Th>
              </tr>
            </thead>
            <tbody>
              {report.data.topAbusiveIps.map((ip) => (
                <tr key={ip.ipAddress}>
                  <Td className="font-mono">{ip.ipAddress}</Td>
                  <Td className="text-muted-foreground">{ip.country ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(ip.totalRequests)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(ip.blockedRequests)}</Td>
                  <Td className="text-right tabular-nums">{ip.tenantCount}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No IP data in the last 24 hours.</p>
        )}
      </Card>
    </>
  );
}
