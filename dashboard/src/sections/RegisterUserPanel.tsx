import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import type { BadgeTone } from "../components/Badge";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { CopyField } from "../components/CopyField";
import { Field } from "../components/Field";
import { registerUser } from "../lib/api";

type RegisterUserPanelProps = {
  onApiKey: (value: string) => void;
  onActivity?: (entry: {
    title: string;
    detail: string;
    tone?: BadgeTone;
  }) => void;
};

export function RegisterUserPanel({
  onApiKey,
  onActivity,
}: RegisterUserPanelProps) {
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
      const response = await registerUser({
        email,
        tenantId,
        role: "client",
      });

      setApiKey(response.apiKey);
      onApiKey(response.apiKey);

      setStatus("success");

      onActivity?.({
        title: "Client onboarded",
        detail: `${email} → ${tenantId}`,
        tone: "info",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Registration failed.";

      setError(message);
      setStatus("error");
    }
  };

  return (
    <section
      className="panel"
      style={
        {
          "--delay": "140ms",
        } as CSSProperties
      }
    >
      <div className="panel-head">
        <div>
          <h2>Register Client</h2>
          <p>
            Onboard a new company, generate API key, and create client access.
          </p>
        </div>

        <Badge tone="warning">Super Admin</Badge>
      </div>

      <form className="form-rows" onSubmit={handleSubmit}>
        <Field label="Email address" hint="Primary owner account">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ops@company.com"
          />
        </Field>

        <Field label="Password" hint="Used for client login">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter secure password"
          />
        </Field>

        <Field label="Tenant ID" hint="Company / tenant identifier">
          <input
            className="input"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            placeholder="your-tenant-id"
          />
        </Field>

        <Button type="submit" loading={status === "loading"}>
          Create Account + Generate Key
        </Button>
      </form>

      <CopyField label="Issued API Key" value={apiKey} />

      {status === "error" && error ? (
        <div className="notice notice-error">{error}</div>
      ) : null}

      {status === "success" ? (
        <div className="notice notice-success">
          Client successfully onboarded. API key is ready to use.
        </div>
      ) : null}
    </section>
  );
}
