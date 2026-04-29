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
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");

  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  const [error, setError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError(null);

    if (!email || !password || !tenantId) {
      setError("Email, password, and tenant ID are required.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const result = await registerUser({
        email,
        password,
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
          Onboard your tenant, generate your API key, and start protecting your
          APIs in minutes.
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

          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a password"
            />
          </Field>

          <Field label="Tenant ID" hint="Used to namespace all your policies">
            <input
              className="input"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="company-a"
            />
          </Field>

          <Button type="submit" loading={status === "loading"}>
            Create Account
          </Button>
        </form>

        {status === "error" && error ? (
          <div className="notice notice-error">{error}</div>
        ) : null}

        {status === "success" ? (
          <div className="auth-success">
            <Badge tone="success">Onboarding Complete</Badge>

            <p>
              Your company is now onboarded. Save your API key and continue to
              login.
            </p>

            <CopyField label="Generated API Key" value={apiKey} />

            <Button onClick={() => navigate("/login")}>
              Continue to Login
            </Button>
          </div>
        ) : null}

        <div className="auth-footer">
          Already have an account?{" "}
          <span className="auth-link" onClick={() => navigate("/login")}>
            Login here
          </span>
        </div>
      </section>
    </div>
  );
}
