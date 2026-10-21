import { ArrowRight, Building2, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SecretValue } from "@/components/ui/copy-button";
import { EmptyState, ErrorMessage, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stats";
import { Pagination, Table, Td, Th, usePagination } from "@/components/ui/table";
import { api, sessionStore, type TopKey } from "@/lib/api";
import { errorMessage, formatNumber } from "@/lib/format";
import { useApi } from "@/lib/use-api";

function adminKey() {
  return sessionStore.get()!.apiKey;
}

function tenantTotals(keys: TopKey[]) {
  const totals = new Map<string, { tenantId: string; requests: number; blocked: number }>();
  for (const key of keys) {
    if (!key.tenantId) continue;
    const row = totals.get(key.tenantId) ?? { tenantId: key.tenantId, requests: 0, blocked: 0 };
    row.requests += key.totalRequests;
    row.blocked += key.blockedRequests;
    totals.set(key.tenantId, row);
  }
  return [...totals.values()].sort((a, b) => b.blocked - a.blocked || b.requests - a.requests);
}

export function SystemOverview() {
  const key = adminKey();
  const metrics = useApi(`systemMetrics:${key}`, () => api.systemMetrics(key), 30_000);
  const topKeys = useApi(`topKeys:${key}`, () => api.topKeys(key), 30_000);
  const refresh = () => {
    metrics.reload();
    topKeys.reload();
  };
  const error = metrics.error ?? topKeys.error;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="All tenants together."
        actions={
          <Button onClick={refresh}>
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        }
      />
      {error && <ErrorMessage message={error} onRetry={refresh} className="mb-4" />}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Requests"
          value={metrics.data && formatNumber(metrics.data.totalRequests)}
          hint="All tenants, all time"
          to="/admin/tenants"
        />
        <StatCard
          label="Blocked"
          value={metrics.data && formatNumber(metrics.data.blockedRequests)}
          hint="Over a limit"
          to="/admin/tenants"
          danger={Boolean(metrics.data?.blockedRequests)}
        />
        <StatCard label="Block rate" value={metrics.data?.blockRate} hint="Blocked ÷ requests" to="/admin/tenants" />
      </div>

      <Card className="mt-4">
        <CardHeader title="Top API keys" description="Across all tenants, by blocked requests" />
        {topKeys.loading && !topKeys.data ? (
          <SkeletonRows />
        ) : !topKeys.data?.length ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No traffic yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Tenant</Th>
                <Th className="text-right">Requests</Th>
                <Th className="text-right">Blocked</Th>
              </tr>
            </thead>
            <tbody>
              {topKeys.data.map((row) => (
                <tr key={row.apiKey}>
                  <Td className="font-mono">{row.apiKey}</Td>
                  <Td>
                    {row.tenantId ? (
                      <Link to={`/admin/t/${row.tenantId}`} className="text-accent hover:underline">
                        {row.tenantId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.totalRequests)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.blockedRequests)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export function Tenants() {
  const navigate = useNavigate();
  const key = adminKey();
  const topKeys = useApi(`topKeys:${key}`, () => api.topKeys(key));
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState("");

  const rows = tenantTotals(topKeys.data ?? []).filter((t) => t.tenantId.includes(query.toLowerCase()));
  const page = usePagination(rows);

  function open(event: FormEvent) {
    event.preventDefault();
    if (openId.trim()) navigate(`/admin/t/${openId.trim()}`);
  }

  return (
    <>
      <PageHeader title="Tenants" description="Tenants with traffic among the busiest keys. Open any other tenant by ID." />
      {topKeys.error && <ErrorMessage message={topKeys.error} onRetry={topKeys.reload} className="mb-4" />}

      <Card className="mb-4">
        <form onSubmit={open} className="flex flex-wrap items-end gap-2 p-4">
          <Field label="Open a tenant by ID" className="w-full sm:w-72">
            <Input value={openId} onChange={(e) => setOpenId(e.target.value)} className="font-mono" placeholder="acme" />
          </Field>
          <Button type="submit">
            Open <ArrowRight aria-hidden />
          </Button>
        </form>
      </Card>

      <Card>
        <div className="border-b p-3">
          <Input
            type="search"
            aria-label="Search tenants"
            placeholder="Search tenants…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-64"
          />
        </div>
        {topKeys.loading && !topKeys.data ? (
          <SkeletonRows />
        ) : !rows.length ? (
          <EmptyState icon={Building2} title="No tenants with traffic" description="Tenants appear here once they send requests." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Tenant</Th>
                  <Th className="text-right">Requests</Th>
                  <Th className="text-right">Blocked</Th>
                  <Th className="text-right">Block rate</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((t) => (
                  <tr key={t.tenantId}>
                    <Td className="font-mono">{t.tenantId}</Td>
                    <Td className="text-right tabular-nums">{formatNumber(t.requests)}</Td>
                    <Td className="text-right tabular-nums">{formatNumber(t.blocked)}</Td>
                    <Td className="text-right tabular-nums">
                      {t.requests ? `${((t.blocked / t.requests) * 100).toFixed(1)}%` : "—"}
                    </Td>
                    <Td className="text-right">
                      <Link to={`/admin/t/${t.tenantId}`} className="text-sm text-accent hover:underline">
                        View
                      </Link>
                    </Td>
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

export function Users() {
  const [email, setEmail] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ apiKey: string; tenantId: string; email: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setCreated(undefined);
    try {
      setCreated(await api.register(email, tenantId, adminKey()));
      setEmail("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Users" description="Add a user to an existing tenant, or create a new tenant for them." />
      <Card className="max-w-xl">
        <CardHeader title="Add a user" description="The user gets their own API key, shown once below." />
        <form onSubmit={submit} className="space-y-4 p-4">
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Tenant ID" hint="Existing tenant to join, or a new ID to create.">
            <Input
              required
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value.toLowerCase())}
              className="font-mono"
            />
          </Field>
          {error && <ErrorMessage message={error} />}
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Adding…" : "Add user"}
          </Button>
        </form>
        {created && (
          <div className="space-y-2 border-t p-4">
            <SecretValue label={`API key for ${created.email} (${created.tenantId})`} value={created.apiKey} />
            <p className="text-sm text-muted-foreground">Share it securely. It won't be shown again.</p>
          </div>
        )}
      </Card>
    </>
  );
}
