import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import type { BadgeTone } from "../components/Badge";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { resetCounter } from "../lib/api";

const DEFAULT_ROUTE = "login-api";

type ResetCounterPanelProps = {
  tenantId: string;
  onTenantIdChange: (value: string) => void;
  apiKey: string;
  onActivity?: (entry: {
    title: string;
    detail: string;
    tone?: BadgeTone;
  }) => void;
};

export function ResetCounterPanel({
  tenantId,
  onTenantIdChange,
  apiKey,
  onActivity,
}: ResetCounterPanelProps) {
  const [route, setRoute] = useState(DEFAULT_ROUTE);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const normalizedTenantId = tenantId.trim();
    const normalizedRoute = route.trim();

    if (!normalizedTenantId || !normalizedRoute) {
      setMessage("Tenant ID and route are required.");
      setStatus("error");
      return;
    }

    if (!apiKey) {
      setMessage("Admin API key is required to reset a counter.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const response = await resetCounter(
        {
          tenantId: normalizedTenantId,
          route: normalizedRoute,
        },
        apiKey,
      );

      setMessage(response.message);
      setStatus("success");
      onActivity?.({
        title: "Counter reset",
        detail: `${normalizedTenantId} | ${normalizedRoute}`,
        tone: "warning",
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Counter reset failed.";
      setMessage(errorMessage);
      setStatus("error");
    }
  };

  return (
    <section className="panel" style={{ "--delay": "220ms" } as CSSProperties}>
      <div className="panel-head">
        <div>
          <h2>Reset Counter</h2>
          <p>Clear active rate limit state for a tenant route.</p>
        </div>
        <Badge tone="warning">Admin ops</Badge>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <Field label="Tenant ID" className="span-6">
          <input
            className="input"
            value={tenantId}
            onChange={(event) => onTenantIdChange(event.target.value)}
            placeholder="company-a"
          />
        </Field>

        <Field label="Route" className="span-6">
          <input
            className="input"
            value={route}
            onChange={(event) => setRoute(event.target.value)}
            placeholder="login-api"
          />
        </Field>

        <div className="form-actions span-12">
          <Button type="submit" loading={status === "loading"}>
            Reset Counter
          </Button>
          <span className="muted">Restores full allowance immediately.</span>
        </div>
      </form>

      {message ? (
        <div
          className={`notice ${status === "success" ? "notice-success" : "notice-error"}`}
        >
          {message}
        </div>
      ) : null}
    </section>
  );
}
