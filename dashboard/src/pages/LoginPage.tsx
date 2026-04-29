import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";

import { sessionStore } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Spinner } from "@/components/Loading";

import { Field, ErrorAlert } from "./RegisterPage";

export default function Login() {
  const navigate = useNavigate();

  const [tenantId, setTenantId] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError(null);
    setLoading(true);

    const tid = tenantId.trim();
    const key = apiKey.trim();

    if (!tid || !key) {
      setError("Enter both Tenant ID and API Key.");
      setLoading(false);
      return;
    }

    sessionStore.set({
      email: tid,
      tenantId: tid,
      apiKey: key,
      role: "client",
    });

    navigate("/dashboard", { replace: true });
    setLoading(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md glass-card p-8 md:p-10 animate-fade-in-up relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-glow pointer-events-none" />

        <div className="relative space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>

            <StatusBadge tone="primary">Client Access</StatusBadge>
          </div>

          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">EdgeLimiter</h2>

            <p className="text-muted-foreground">
              Enter your credentials to access your protection dashboard.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Tenant ID">
              <input
                type="text"
                required
                disabled={loading}
                value={tenantId}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  setError(null);
                }}
                placeholder="company-a"
                className="form-input font-mono"
                autoComplete="username"
              />
            </Field>

            <Field label="API Key">
              <input
                type="password"
                required
                disabled={loading}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError(null);
                }}
                placeholder="edge_live_••••••••"
                className="form-input font-mono"
                autoComplete="current-password"
              />
            </Field>

            {error && <ErrorAlert message={error} />}

            <button
              type="submit"
              disabled={loading || !tenantId || !apiKey}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-3 font-semibold hover:brightness-110 hover:shadow-glow-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading && <Spinner />}

              {loading ? "Verifying..." : "Access Dashboard"}
            </button>

            <p className="text-sm text-muted-foreground text-center">
              No account?{" "}
              <Link to="/register" className="text-primary hover:underline">
                Register here
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
