import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { CopyField } from "../components/CopyField";
import { Field } from "../components/Field";
import { registerUser } from "../lib/api";

export function RegisterPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [tenantId, setTenantId] = useState("");

  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email || !tenantId) {
      setError("Email and Tenant ID are required.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const result = await registerUser({
        email,
        tenantId,
        role: "client",
      });

      setApiKey(result.apiKey);
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
      setStatus("error");
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="auth-header-row">
          <Badge tone="info">Client Onboarding</Badge>
        </div>

        <h2>Create Your Company Account</h2>

        <p className="auth-description">
          Register your tenant and generate your API key to start protecting
          APIs.
        </p>

        <form className="form-rows" onSubmit={handleSubmit}>
          <Field label="Work Email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="team@company.com"
            />
          </Field>

          <Field label="Tenant ID" hint="Used for all API protection policies">
            <input
              className="input"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="your-tenant-id"
            />
          </Field>

          <Button type="submit" loading={status === "loading"}>
            Generate API Key
          </Button>
        </form>

        {status === "error" && error ? (
          <div className="notice notice-error">{error}</div>
        ) : null}

        {status === "success" ? (
          <div className="auth-success">
            <Badge tone="success">Onboarding Complete</Badge>

            <p>
              Save your API key securely. You’ll use it to access your
              dashboard.
            </p>

            <CopyField value={apiKey} label="Generated API Key" />

            <Button onClick={() => navigate("/login")}>
              Continue to Dashboard Access
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
