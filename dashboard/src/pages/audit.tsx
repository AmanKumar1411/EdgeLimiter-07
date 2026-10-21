import { RefreshCw, ScrollText, SearchX } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorMessage, SkeletonRows } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, Table, Td, Th, usePagination } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { SEVERITY_TONE } from "@/lib/limits";
import { useTenant } from "@/lib/tenant";
import { useApi } from "@/lib/use-api";

const EVENTS: Record<string, string> = {
  policy_created: "Limit saved",
  policy_deleted: "Limit deleted",
  rate_limit_reset: "Counter reset",
  rate_limit_block: "Limit reached",
  api_key_created: "Key created",
  api_key_revoked: "Key revoked",
};

export function Audit() {
  const { tenantId, session } = useTenant();
  const log = useApi(`auditLog:${tenantId}:${session.apiKey}`, () => api.auditLog(tenantId, session.apiKey), 60_000);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const event = params.get("event") ?? "";

  const entries = log.data ?? [];
  const filtered = entries.filter(
    (entry) =>
      (!event || entry.action_type === event) &&
      (!query || `${entry.message} ${entry.actor}`.toLowerCase().includes(query.toLowerCase())),
  );
  const page = usePagination(filtered);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Changes to limits and keys, and the moments a limit started blocking. Last 50 events."
        actions={
          <Button onClick={log.reload}>
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        }
      />

      {log.error && <ErrorMessage message={log.error} onRetry={log.reload} className="mb-4" />}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input
            type="search"
            aria-label="Search events"
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select
            aria-label="Event type"
            value={event}
            onChange={(e) => setParams(e.target.value ? { event: e.target.value } : {}, { replace: true })}
            className="w-full sm:w-auto"
          >
            <option value="">All events</option>
            {Object.entries(EVENTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {log.loading && !log.data ? (
          <SkeletonRows rows={5} />
        ) : !entries.length ? (
          <EmptyState
            icon={ScrollText}
            title="Nothing recorded yet"
            description="Saving a limit, resetting a counter, creating a key or hitting a limit adds an entry here."
          />
        ) : !filtered.length ? (
          <EmptyState icon={SearchX} title="No events match" description="Try a different event type or search." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Event</Th>
                  <Th>Details</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(entry.created_at)}</Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={SEVERITY_TONE[entry.severity] ?? "neutral"}>
                        {EVENTS[entry.action_type] ?? entry.action_type}
                      </Badge>
                    </Td>
                    <Td>{entry.message}</Td>
                    <Td className="text-muted-foreground">{entry.actor}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination {...page} />
          </>
        )}
      </Card>
    </>
  );
}
