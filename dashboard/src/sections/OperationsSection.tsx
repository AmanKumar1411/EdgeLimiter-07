import { useState } from "react";
import { Trash2, CheckCircle2 } from "lucide-react";
import { resetCounter, type Session } from "../lib/api";
import { Spinner } from "../components/Loading";
import { Field, ErrorAlert } from "../pages/RegisterPage";
import { logActivity } from "../lib/activity";

export function OperationsSection({
  session,
  onTenantChange,
}: {
  session: Session;
  onTenantChange: (id: string) => void;
}) {
  const [tenantId, setTenantId] = useState(session.tenantId);
  const [route, setRoute] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const response = await resetCounter(
        { tenantId: tenantId.trim(), route: route.trim() },
        session.apiKey,
      );
      setSuccess(response.message || "Counter reset successfully.");
      onTenantChange(tenantId.trim());
      logActivity({
        title: "Counter reset",
        detail: `${tenantId} | ${route}`,
        tone: "warning",
      });
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset counter");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Operations</h2>
        <p className="text-muted-foreground">
          Manage rate limiters across your edge.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
        <div className="space-y-1">
          <h3 className="font-semibold">Reset Counter</h3>
          <p className="text-sm text-muted-foreground">
            Immediately clear the rate limit counter for a tenant + route
            combination.
          </p>
        </div>
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
        </div>

        {error && <ErrorAlert message={error} />}
        {success && (
          <div className="flex items-start gap-2.5 rounded-lg border border-success/40 bg-success/10 px-3.5 py-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-danger">
          {loading ? <Spinner /> : <Trash2 className="h-4 w-4" />}
          {loading ? "Resetting..." : "Reset Counter"}
        </button>
      </form>
    </div>
  );
}
