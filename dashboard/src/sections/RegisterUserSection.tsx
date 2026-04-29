import { useState } from "react";
import { UserPlus, ArrowRight } from "lucide-react";
import { registerUser } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";
import { Spinner } from "../components/Loading";
import { CopyField } from "../components/CopyField";
import { Field, ErrorAlert } from "../pages/RegisterPage";
import { logActivity } from "../lib/activity";

export function RegisterUserSection() {
  const [email, setEmail] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [role, setRole] = useState<"client" | "super_admin">("client");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setApiKey(null);
    setLoading(true);
    try {
      const data = await registerUser({ email, tenantId, role });
      if (!data.apiKey) throw new Error("No API key returned");
      setApiKey(data.apiKey);
      logActivity({
        title: "User registered",
        detail: `${email} | ${tenantId} | ${role}`,
        tone: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setEmail("");
    setTenantId("");
    setRole("client");
    setApiKey(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Register User</h2>
          <p className="text-muted-foreground">
            Create new client accounts and generate API keys.
          </p>
        </div>
        <StatusBadge tone="secondary">Super Admin</StatusBadge>
      </header>

      <div className="glass-card p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Email">
              <input
                type="email"
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                placeholder="user@company.com"
              />
            </Field>
            <Field label="Tenant ID">
              <input
                required
                disabled={loading}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="form-input font-mono"
                placeholder="company-b"
              />
            </Field>
            <Field label="Role">
              <select
                disabled={loading}
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "client" | "super_admin")
                }
                className="form-input"
              >
                <option value="client">Client</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </Field>
          </div>

          {error && <ErrorAlert message={error} />}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? <Spinner /> : <UserPlus className="h-4 w-4" />}
            {loading ? "Registering..." : "Register User"}
          </button>
        </form>

        {apiKey && (
          <div className="space-y-3 pt-4 border-t border-border/10 animate-fade-in-up">
            <StatusBadge tone="success" pulse>
              User Created
            </StatusBadge>
            <p className="text-sm text-muted-foreground">
              Share this API key securely with the new user. It will not be
              shown again.
            </p>
            <CopyField value={apiKey} label="Generated API Key" />
            <button onClick={reset} className="btn-outline text-sm !py-2">
              Register Another
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
