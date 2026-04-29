import { useState } from "react";
import { Save, RotateCcw, CheckCircle2 } from "lucide-react";
import { createPolicy, type Session } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";
import { Spinner } from "../components/Loading";
import { Field, ErrorAlert } from "../pages/RegisterPage";
import { logActivity } from "../lib/activity";

const DEFAULTS = {
  route: "",
  apiKey: "",
  limit: 100,
  window: 60,
  algorithm: "sliding_window",
};

export function PoliciesSection({
  session,
  onTenantChange,
}: {
  session: Session;
  onTenantChange: (id: string) => void;
}) {
  const [tenantId, setTenantId] = useState(session.tenantId);

  /*
    NEW:
    API Key input section
  */
  const [apiKey, setApiKey] = useState(session.apiKey || DEFAULTS.apiKey);

  const [route, setRoute] = useState(DEFAULTS.route);
  const [limit, setLimit] = useState<number>(DEFAULTS.limit);
  const [windowSec, setWindowSec] = useState<number>(DEFAULTS.window);
  const [algorithm, setAlgorithm] = useState<string>(DEFAULTS.algorithm);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function reset() {
    setRoute(DEFAULTS.route);
    setApiKey(session.apiKey || DEFAULTS.apiKey);
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
      const response = await createPolicy(
        {
          tenantId: tenantId.trim(),
          route: route.trim(),
          limit,
          window: windowSec,
          algorithm: algorithm as
            | "sliding_window"
            | "fixed_window"
            | "token_bucket",
        },
        apiKey.trim(),
      );

      setSuccess(response.message || "Policy saved successfully.");

      onTenantChange(tenantId.trim());

      logActivity({
        title: "Policy saved",
        detail: `${tenantId} | ${route} | ${algorithm}`,
        tone: "success",
      });

      setTimeout(() => setSuccess(null), 5000);
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
          <h2 className="text-2xl font-bold tracking-tight">Create Policy</h2>

          <p className="text-muted-foreground max-w-2xl">
            Define per-route rate limit rules and deploy them globally to all
            edge POPs.
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

          {/* NEW API KEY FIELD */}
          <Field label="API Key">
            <input
              required
              type="password"
              disabled={loading}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="edge_live_xxxxxxxxx"
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
    </div>
  );
}
