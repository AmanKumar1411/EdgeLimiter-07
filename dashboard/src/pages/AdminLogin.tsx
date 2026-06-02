import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { sessionStore, whoAmI } from "@/lib/api";
import { Field, ErrorAlert } from "./RegisterPage";

export default function AdminLogin() {
  const navigate = useNavigate();

  const [tenantId, setTenantId] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError(null);
    setLoading(true);

    const tid = tenantId.trim();
    const key = apiKey.trim();

    if (!tid || !key) {
      setError("Enter both Tenant ID and Admin API Key.");
      setLoading(false);
      return;
    }

    try {
      const { data } = await whoAmI(key);
      if (data.role !== "super_admin") {
        setError("This API key does not have admin privileges.");
        setLoading(false);
        return;
      }
      if (data.tenantId !== tid) {
        setError("Tenant ID does not match this API key.");
        setLoading(false);
        return;
      }
      sessionStore.set({
        email: data.email,
        tenantId: data.tenantId,
        apiKey: key,
        role: "super_admin",
      });
      navigate("/admin", { replace: true });
    } catch {
      setError("Invalid credentials. Please check your API key and tenant.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md glass-card p-8 md:p-10">
        <h1 className="text-2xl font-bold tracking-tight">Admin Login</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Use your admin tenant and API key.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <Field label="Tenant ID">
            <input
              type="text"
              required
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              className="form-input"
              placeholder="admin-tenant"
            />
          </Field>

          <Field label="Admin API Key">
            <input
              type="password"
              required
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="form-input"
              placeholder="admin_live_xxxxx"
            />
          </Field>

          {error ? <ErrorAlert message={error} /> : null}

          <button
            type="submit"
            disabled={loading || !tenantId || !apiKey}
            className="btn-primary w-full"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
