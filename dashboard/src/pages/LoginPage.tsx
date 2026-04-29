import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { loginUser } from "../lib/api";
import { saveSession } from "../auth/session";

export function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError(null);

    if (!email || !password) {
      setError("Email and password are required.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const result = await loginUser({
        email,
        password,
      });

      saveSession({
        email: result.email,
        role: result.role,
        tenantId: result.tenantId,
        apiKey: result.apiKey,
      });

      // Full reload ensures App.tsx reads fresh localStorage
      if (result.role === "super_admin") {
        window.location.href = "/admin";
      } else {
        window.location.href = "/dashboard";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");

      setStatus("error");
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="auth-header-row">
          <Badge tone="warning">Secure Access</Badge>
        </div>

        <h2>Login to EdgeLimiter</h2>

        <p className="auth-description">
          Sign in to access your tenant control plane and protection rules.
        </p>

        <form className="form-rows" onSubmit={handleSubmit}>
          <Field label="Email">
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
              placeholder="Your password"
            />
          </Field>

          <Button type="submit" loading={status === "loading"}>
            Login
          </Button>
        </form>

        {status === "error" && error ? (
          <div className="notice notice-error">{error}</div>
        ) : null}

        <div className="auth-footer">
          New here?{" "}
          <span className="auth-link" onClick={() => navigate("/register")}>
            Create Account
          </span>
        </div>
      </section>
    </div>
  );
}
