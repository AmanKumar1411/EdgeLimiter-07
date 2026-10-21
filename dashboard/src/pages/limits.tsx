import { Gauge, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorMessage, SkeletonRows, SuccessMessage } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination, Table, Td, Th, usePagination } from "@/components/ui/table";
import { api, type Algorithm, type Policy } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import {
  ALGORITHMS,
  MAX_SLIDING_WINDOW_LIMIT,
  MAX_WINDOW_SECONDS,
  WINDOW_UNITS,
  algorithmLabel,
  describeRule,
  describeWindow,
  splitWindow,
} from "@/lib/limits";
import { useTenant } from "@/lib/tenant";
import { useApi } from "@/lib/use-api";

const isWholeNumber = (value: string) => /^\d+$/.test(value) && Number(value) >= 1;

function preview(route: string, limit: number, window: number, algorithm: Algorithm) {
  const target = route ? `/check calls for ${route}` : "/check calls for this route";
  const per = describeWindow(window);
  const rule =
    algorithm === "token_bucket"
      ? `${target} can burst up to ${limit.toLocaleString()} requests, then ${limit.toLocaleString()} more per ${per} as the bucket refills.`
      : algorithm === "fixed_window"
        ? `${target} are allowed ${limit.toLocaleString()} times per ${per}, counted from the start of each ${per}.`
        : `${target} are allowed ${limit.toLocaleString()} times in any rolling ${per}.`;
  return `${rule} Beyond that they get 429 with Retry-After.`;
}

function LimitForm({
  initial,
  existingRoutes,
  onSaved,
  onCancel,
}: {
  initial?: Policy;
  existingRoutes: string[];
  onSaved: (route: string) => void;
  onCancel: () => void;
}) {
  const { tenantId, session } = useTenant();
  const initialWindow = splitWindow(initial?.window ?? 60);
  const [route, setRoute] = useState(initial?.route ?? "");
  const [limit, setLimit] = useState(String(initial?.limit ?? 100));
  const [count, setCount] = useState(String(initialWindow.count));
  const [unit, setUnit] = useState<number>(initialWindow.unit);
  const [algorithm, setAlgorithm] = useState<Algorithm>(initial?.algorithm ?? "sliding_window");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const window = Number(count) * unit;
  const trimmedRoute = route.trim();
  const problem = !trimmedRoute
    ? "Enter the route your backend will send to /check."
    : !initial && existingRoutes.includes(trimmedRoute)
      ? "This route already has a limit. Edit it in the table instead."
      : !isWholeNumber(limit)
        ? "Requests must be a whole number, at least 1."
        : !isWholeNumber(count)
          ? "The window must be a whole number, at least 1."
          : window > MAX_WINDOW_SECONDS
            ? "The window can be at most 30 days."
            : algorithm === "sliding_window" && Number(limit) > MAX_SLIDING_WINDOW_LIMIT
              ? `Sliding window allows up to ${MAX_SLIDING_WINDOW_LIMIT.toLocaleString()} requests per window. Use fixed window or token bucket for more.`
              : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (problem) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.savePolicy({ tenantId, route: trimmedRoute, limit: Number(limit), window, algorithm }, session.apiKey);
      onSaved(trimmedRoute);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={initial ? `Edit limit for ${initial.route}` : "New limit"}
        description="Applies to every /check call your backend makes for this route."
      />
      <form onSubmit={submit} className="space-y-5 p-4">
        <Field label="Route" hint="The exact route name your backend sends to /check, e.g. /api/login.">
          <Input
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="/api/login"
            disabled={Boolean(initial)}
            className="max-w-md font-mono"
          />
        </Field>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Rule</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Allow</span>
            <Input
              aria-label="Requests allowed"
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-28 tabular-nums"
            />
            <span>requests every</span>
            <Input
              aria-label="Window length"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-20 tabular-nums"
            />
            <Select
              aria-label="Window unit"
              value={unit}
              onChange={(e) => setUnit(Number(e.target.value))}
              className="w-32"
            >
              {WINDOW_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {Number(count) === 1 ? u.singular : u.plural}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">Algorithm</legend>
          {ALGORITHMS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2 has-[:checked]:border-foreground/40 has-[:checked]:bg-muted/60"
            >
              <input
                type="radio"
                name="algorithm"
                value={option.value}
                checked={algorithm === option.value}
                onChange={() => setAlgorithm(option.value)}
                className="mt-1 accent-[hsl(var(--accent))]"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.explanation}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="rounded bg-muted px-3 py-2.5 text-sm" aria-live="polite">
          <div className="text-xs font-medium text-muted-foreground">What this does</div>
          <p className="mt-0.5">{problem ?? preview(trimmedRoute, Number(limit), window, algorithm)}</p>
          {!problem && (
            <p className="mt-1 text-xs text-muted-foreground">
              Everyone calling this route shares the budget. Send an <code className="font-mono">identifier</code> (user
              ID, IP) with /check to give each end user their own.
            </p>
          )}
        </div>

        {error && <ErrorMessage message={error} />}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving || Boolean(problem)}>
            {saving ? "Saving…" : "Save limit"}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export function Limits() {
  const { tenantId, session } = useTenant();
  const policies = useApi(`policies:${tenantId}:${session.apiKey}`, () => api.policies(tenantId, session.apiKey));
  const [editing, setEditing] = useState<Policy | "new">();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busyRoute, setBusyRoute] = useState<string>();

  const all = [...(policies.data ?? [])].sort((a, b) => a.route.localeCompare(b.route));
  const visible = all.filter((p) => p.route.toLowerCase().includes(query.toLowerCase()));
  const page = usePagination(visible);

  async function act(policy: Policy, question: string, action: () => Promise<unknown>, done: string) {
    if (!window.confirm(question)) return;
    setBusyRoute(policy.route);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      setNotice(done);
      policies.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyRoute(undefined);
    }
  }

  const reset = (p: Policy) =>
    act(
      p,
      `Reset the counter for ${p.route}? Callers get their full allowance back immediately.`,
      () => api.resetCounter(tenantId, p.route, session.apiKey),
      `Counter for ${p.route} reset.`,
    );

  const remove = (p: Policy) =>
    act(
      p,
      `Delete the limit for ${p.route}? /check calls for this route will return 404 until you add it again.`,
      () => api.deletePolicy(tenantId, p.route, session.apiKey),
      `Limit for ${p.route} deleted.`,
    );

  return (
    <>
      <PageHeader
        title="Limits"
        description="One limit per route. Changes reach every Cloudflare location within about a minute."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} disabled={editing === "new"}>
            <Plus aria-hidden />
            New limit
          </Button>
        }
      />

      {editing && (
        <LimitForm
          key={editing === "new" ? "new" : editing.route}
          initial={editing === "new" ? undefined : editing}
          existingRoutes={all.map((p) => p.route)}
          onCancel={() => setEditing(undefined)}
          onSaved={(route) => {
            setEditing(undefined);
            setNotice(`Limit for ${route} saved.`);
            policies.reload();
          }}
        />
      )}

      <div className="mb-4 space-y-2 empty:hidden">
        {notice && <SuccessMessage message={notice} />}
        {(error ?? policies.error) && <ErrorMessage message={(error ?? policies.error)!} onRetry={policies.reload} />}
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b p-3">
          <Input
            type="search"
            aria-label="Search routes"
            placeholder="Search routes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-64"
          />
          <span className="ml-auto text-xs text-muted-foreground">
            {all.length} {all.length === 1 ? "limit" : "limits"}
          </span>
        </div>
        {policies.loading && !policies.data ? (
          <SkeletonRows />
        ) : !all.length ? (
          <EmptyState
            icon={Gauge}
            title="No limits yet"
            description="A limit tells EdgeLimiter how many requests a route may receive per window."
            action={
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus aria-hidden />
                New limit
              </Button>
            }
          />
        ) : !visible.length ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No routes match “{query}”.</p>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Route</Th>
                  <Th className="hidden sm:table-cell">Rule</Th>
                  <Th className="hidden sm:table-cell">Algorithm</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((policy) => (
                  <tr key={policy.route}>
                    <Td>
                      <div className="break-all font-mono">{policy.route}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                        {describeRule(policy)} · {algorithmLabel(policy.algorithm)}
                      </div>
                    </Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">{describeRule(policy)}</Td>
                    <Td className="hidden sm:table-cell">
                      <Badge>{algorithmLabel(policy.algorithm)}</Badge>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(policy)}
                          aria-label={`Edit ${policy.route}`}
                        >
                          <Pencil aria-hidden />
                          <span className="hidden sm:inline">Edit</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyRoute === policy.route}
                          onClick={() => reset(policy)}
                          aria-label={`Reset counter for ${policy.route}`}
                        >
                          <RotateCcw aria-hidden />
                          <span className="hidden sm:inline">Reset</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyRoute === policy.route}
                          onClick={() => remove(policy)}
                          aria-label={`Delete ${policy.route}`}
                        >
                          <Trash2 aria-hidden />
                          <span className="hidden sm:inline">Delete</span>
                        </Button>
                      </div>
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
