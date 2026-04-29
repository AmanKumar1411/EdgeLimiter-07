import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Shield, AlertCircle } from "lucide-react";
import { registerUser } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyField } from "@/components/CopyField";
import { Spinner } from "@/components/Loading";

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [role, setRole] = useState<"client" | "super_admin">("client");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await registerUser({ email, tenantId, role });
      if (!data.apiKey) throw new Error("No API key returned");
      setApiKey(data.apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg glass-card p-8 md:p-10 animate-fade-in-up relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-glow pointer-events-none" />
        <div className="relative space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <StatusBadge tone="secondary">Client Onboarding</StatusBadge>
          </div>

          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">
              Create Your Company Account
            </h2>
            <p className="text-muted-foreground">
              Register your tenant and generate your API key to start protecting
              APIs.
            </p>
          </div>

          {!apiKey ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  required
                  disabled={loading}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="ops@company.com"
                  className="form-input"
                />
              </Field>
              <Field
                label="Tenant ID"
                hint="Used for all API protection policies"
              >
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

              {error && <ErrorAlert message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-3 font-semibold hover:brightness-110 hover:shadow-glow-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {loading ? <Spinner /> : null}
                {loading ? "Generating..." : "Generate API Key"}
              </button>

              <p className="text-sm text-muted-foreground text-center">
                Already have an API key?{" "}
                <Link to="/login" className="text-primary hover:underline">
                  Login
                </Link>
              </p>
            </form>
          ) : (
            <div className="space-y-5 animate-fade-in-up">
              <StatusBadge tone="success" pulse>
                Onboarding Complete
              </StatusBadge>
              <p className="text-muted-foreground">
                Save your API key securely. You'll use it to access your
                dashboard.
              </p>
              <CopyField value={apiKey} label="API Key" />
              <button
                onClick={() => navigate("/login")}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-3 font-semibold hover:brightness-110 transition-all"
              >
                Continue to Dashboard Access
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {hint && (
          <span className="text-xs text-muted-foreground/70">{hint}</span>
        )}
      </div>
      {children}
    </label>
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
