import { useState } from "react";
import { Zap, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { checkRate, type Session } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";
import { Spinner } from "../components/Loading";
import { Field, ErrorAlert } from "../pages/RegisterPage";
import { logActivity } from "../lib/activity";

interface Result {
  allowed: boolean;
  remaining?: number;
  retryAfter?: number;
  algorithm?: string;
  reset?: string | null;
  limit?: string | null;
  checkedAt: string;
}

export function LiveControlSection({
  session,
  onTenantChange,
}: {
  session: Session;
  onTenantChange: (id: string) => void;
}) {
  const [tenantId, setTenantId] = useState(session.tenantId);
  const [route, setRoute] = useState("");
  const [apiKey, setApiKey] = useState(session.apiKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function useDemo() {
    setTenantId("company-a");
    setRoute("login-api");
    onTenantChange("company-a");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await checkRate(tenantId.trim(), route.trim(), apiKey.trim());
      const allowed = res.status === 200 && res.data.allowed !== false;
      const result: Result = {
        allowed,
        remaining: res.data.remaining ?? res.rateLimit.remaining ?? 0,
        retryAfter: res.data.retryAfter ?? res.rateLimit.retryAfter ?? 0,
        algorithm: res.data.algorithm,
        reset: res.rateLimit.reset ? String(res.rateLimit.reset) : null,
        limit: res.rateLimit.limit ? String(res.rateLimit.limit) : null,
        checkedAt: new Date().toLocaleTimeString(),
      };
      setResult(result);
      onTenantChange(tenantId.trim());
      logActivity({
        title: allowed ? "Check allowed" : "Check blocked",
        detail: `${tenantId} | ${route}`,
        tone: allowed ? "success" : "danger",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <StatusBadge tone="primary" pulse>
          <Zap className="h-3 w-3" />
          Live Control Plane
        </StatusBadge>
        <h2 className="text-3xl font-bold tracking-tight">
          EdgeLimiter Live Rate Test
        </h2>
        <p className="text-muted-foreground max-w-2xl">
          Validate limits in real time, inspect headers, and confirm each route
          is enforced across the edge.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Tenant ID">
            <input
              required
              disabled={loading}
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="form-input font-mono"
              placeholder="company-a"
            />
          </Field>
          <Field label="Route">
            <input
              required
              disabled={loading}
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              className="form-input font-mono"
              placeholder="login-api"
            />
          </Field>
          <Field label="API Key">
            <input
              type="password"
              required
              disabled={loading}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="form-input font-mono"
            />
          </Field>
        </div>

        {error && <ErrorAlert message={error} />}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={useDemo}
            disabled={loading}
            className="btn-outline"
          >
            <Sparkles className="h-4 w-4" />
            Use demo values
          </button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? <Spinner /> : <Zap className="h-4 w-4" />}
            {loading ? "Checking..." : "Test Check"}
          </button>
        </div>
      </form>

      {result && (
        <div
          className={`glass-card p-6 space-y-5 animate-fade-in-up border-2 ${
            result.allowed ? "border-success/40" : "border-destructive/40"
          }`}
        >
          <div className="flex items-center gap-3">
            {result.allowed ? (
              <CheckCircle2 className="h-7 w-7 text-success" />
            ) : (
              <XCircle className="h-7 w-7 text-destructive" />
            )}
            <div>
              <div className="text-2xl font-bold">
                {result.allowed ? "Allowed" : "Blocked"}
              </div>
              <div className="text-xs text-muted-foreground">
                Last checked at {result.checkedAt}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Detail label="Remaining" value={result.remaining ?? "—"} />
            <Detail label="Limit" value={result.limit ?? "—"} />
            <Detail
              label="Reset"
              value={
                result.reset
                  ? new Date(Number(result.reset) * 1000).toLocaleTimeString()
                  : "—"
              }
            />
            {result.allowed ? (
              <Detail label="Algorithm" value={result.algorithm ?? "—"} mono />
            ) : (
              <Detail
                label="Retry After"
                value={`${result.retryAfter ?? 0}s`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg bg-white/5 border border-border/10 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-lg font-semibold mt-1 ${mono ? "font-mono text-primary" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
