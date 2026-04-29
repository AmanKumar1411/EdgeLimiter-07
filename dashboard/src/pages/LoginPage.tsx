import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { saveSession } from "../auth/session";

export function LoginPage() {
  const navigate = useNavigate();

  const [tenantId, setTenantId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!tenantId || !apiKey) {
      setError("Tenant ID and API Key are required.");
      return;
    }

    saveSession({
      email: "client@tenant.com",
      role: "client",
      tenantId,
      apiKey,
    });

    navigate("/dashboard");
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="auth-header-row">
          <Badge tone="warning">API Access</Badge>
        </div>

        <h2>Access EdgeLimiter</h2>

        <p className="auth-description">
          Use your Tenant ID and API Key to access your security dashboard.
        </p>

        <form className="form-rows" onSubmit={handleSubmit}>
          <Field label="Tenant ID">
            <input
              className="input"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="company-a"
            />
          </Field>

          <Field label="API Key">
            <input
              className="input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_live_xxxxx"
            />
          </Field>

          <Button type="submit">
            Access Dashboard
          </Button>
        </form>

        {error ? (
          <div className="notice notice-error">
            {error}
          </div>
        ) : null}

        <div className="auth-footer">
          New here?{" "}
          <span
            className="auth-link"
            onClick={() => navigate("/register")}
          >
            Create Account
          </span>
        </div>
      </section>
    </div>
  );
}