import { useCallback, useEffect, useState } from "react";
import { Save, RotateCcw, CheckCircle2, Pencil, Trash2, ListChecks } from "lucide-react";
import {
  deletePolicy,
  listPolicies,
  savePolicy,
  type Policy,
  type Session,
} from "../../lib/api";
import { StatusBadge } from "../StatusBadge";
import { Skeleton, Spinner } from "../Loading";
import { Field, ErrorAlert } from "@/pages/RegisterPage";
import { logActivity } from "../../lib/activity";

const DEFAULTS = {
  route: "",
  limit: 100,
  window: 60,
  algorithm: "sliding_window",
};

export function PoliciesSection({
  session,
  onTenantChange,
  viewedTenantId,
}: {
  session: Session;
  onTenantChange: (id: string) => void;
  viewedTenantId?: string;
}) {
  const [tenantId, setTenantId] = useState(viewedTenantId ?? session.tenantId);
  const [route, setRoute] = useState(DEFAULTS.route);
  const [limit, setLimit] = useState<number>(DEFAULTS.limit);
  const [windowSec, setWindowSec] = useState<number>(DEFAULTS.window);
  const [algorithm, setAlgorithm] = useState<string>(DEFAULTS.algorithm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const listTenant = (viewedTenantId ?? session.tenantId).trim();

  const refreshList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const { data } = await listPolicies(listTenant, session.apiKey);
      setPolicies(
        [...data.policies].sort((a, b) => a.route.localeCompare(b.route)),
      );
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load policies");
    } finally {
      setListLoading(false);
    }
  }, [listTenant, session.apiKey]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  function edit(policy: Policy) {
    setTenantId(policy.tenantId);
    setRoute(policy.route);
    setLimit(policy.limit);
    setWindowSec(policy.window);
    setAlgorithm(policy.algorithm);
    setError(null);
    setSuccess(null);
  }

  async function remove(policy: Policy) {
    if (!window.confirm(`Delete the policy for ${policy.route}? Checks on this route will return 404.`)) {
      return;
    }
    setDeleting(policy.route);
    setListError(null);
    try {
      await deletePolicy(policy.tenantId, policy.route, session.apiKey);
      logActivity({
        title: "Policy deleted",
        detail: `${policy.tenantId} | ${policy.route}`,
        tone: "warning",
      });
      await refreshList();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete policy");
    } finally {
      setDeleting(null);
    }
  }

  function reset() {
    setRoute(DEFAULTS.route);
    setLimit(DEFAULTS.limit);
    setWindowSec(DEFAULTS.window);
    setAlgorithm(DEFAULTS.algorithm);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const { data } = await savePolicy(
        {
          tenantId: tenantId.trim(),
          route: route.trim(),
          limit,
          window: windowSec,
          algorithm,
        },
        session.apiKey,
      );
      setSuccess(data.message || "Policy saved successfully.");
      onTenantChange(tenantId.trim());
      logActivity({
        title: "Policy saved",
        detail: `${tenantId} | ${route} | ${algorithm}`,
        tone: "success",
      });
      setTimeout(() => setSuccess(null), 5000);
      refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Policies</h2>
          <p className="text-muted-foreground max-w-2xl">
            Define per-route rate limit rules. Changes reach every edge
            location within about 60 seconds (KV propagation).
          </p>
        </div>
        <StatusBadge tone="secondary">Client Admin</StatusBadge>
      </header>

      <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Tenant ID">
            <input
              required
              disabled={loading}
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="form-input font-mono"
            />
          </Field>
          <Field label="Route">
            <input
              required
              disabled={loading}
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              placeholder="login-api"
              className="form-input font-mono"
            />
          </Field>
          <Field label="Limit" hint="Requests per window">
            <input
              required
              type="number"
              min={1}
              disabled={loading}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="form-input"
            />
          </Field>
          <Field label="Window" hint="Seconds per rate limit window">
            <input
              required
              type="number"
              min={1}
              disabled={loading}
              value={windowSec}
              onChange={(e) => setWindowSec(Number(e.target.value))}
              className="form-input"
            />
          </Field>
          <Field label="Algorithm">
            <select
              disabled={loading}
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value)}
              className="form-input"
            >
              <option value="sliding_window">Sliding window</option>
              <option value="fixed_window">Fixed window</option>
              <option value="token_bucket">Token bucket</option>
            </select>
          </Field>
        </div>

        {error && <ErrorAlert message={error} />}
        {success && (
          <div className="flex items-start gap-2.5 rounded-lg border border-success/40 bg-success/10 px-3.5 py-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? <Spinner /> : <Save className="h-4 w-4" />}
            {loading ? "Saving..." : "Save Policy"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={loading}
            className="btn-outline"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      </form>

      <section className="glass-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            Existing policies
            <code className="font-mono text-xs text-muted-foreground">{listTenant}</code>
          </h3>
          <button
            onClick={refreshList}
            disabled={listLoading}
            className="btn-outline !py-1.5 text-xs"
          >
            {listLoading ? <Spinner /> : null}
            Refresh
          </button>
        </div>

        {listError && <ErrorAlert message={listError} />}

        {listLoading && !policies ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !policies || policies.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No policies yet. Save one above to start enforcing limits.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Route</th>
                  <th className="px-2 py-2 font-medium">Limit</th>
                  <th className="px-2 py-2 font-medium">Algorithm</th>
                  <th className="px-2 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.route} className="border-t border-border/10">
                    <td className="px-2 py-2.5 font-mono break-all">{p.route}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap">
                      {p.limit} / {p.window}s
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusBadge tone="muted">{p.algorithm.replace("_", " ")}</StatusBadge>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => edit(p)}
                          className="btn-outline !py-1.5 !px-2.5 text-xs"
                          aria-label={`Edit ${p.route}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => remove(p)}
                          disabled={deleting === p.route}
                          className="btn-outline !py-1.5 !px-2.5 text-xs text-destructive"
                          aria-label={`Delete ${p.route}`}
                        >
                          {deleting === p.route ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
