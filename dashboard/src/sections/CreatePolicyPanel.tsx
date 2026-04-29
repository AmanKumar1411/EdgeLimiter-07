import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import type { BadgeTone } from "../components/Badge";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { createPolicy } from "../lib/api";

const DEFAULT_ROUTE = "login-api";

type CreatePolicyPanelProps = {
  tenantId: string;
  onTenantIdChange: (value: string) => void;
  onActivity?: (entry: {
    title: string;
    detail: string;
    tone?: BadgeTone;
  }) => void;
};

export function CreatePolicyPanel({
  tenantId,
  onTenantIdChange,
  onActivity,
}: CreatePolicyPanelProps) {
  const [route, setRoute] = useState(DEFAULT_ROUTE);
  const [limit, setLimit] = useState("120");
  const [windowSeconds, setWindowSeconds] = useState("60");
  const [algorithm, setAlgorithm] = useState<
    "sliding_window" | "fixed_window" | "token_bucket"
  >("sliding_window");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (!tenantId || !route || !limit || !windowSeconds) {
      setMessage("Tenant, route, limit, and window are required.");
      setStatus("error");
      return;
    }

    const parsedLimit = Number(limit);
    const parsedWindow = Number(windowSeconds);

    if (!Number.isFinite(parsedLimit) || !Number.isFinite(parsedWindow)) {
      setMessage("Limit and window must be valid numbers.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const response = await createPolicy({
        tenantId,
        route,
        limit: parsedLimit,
        window: parsedWindow,
        algorithm,
      });
      setMessage(response.message);
      setStatus("success");
      onActivity?.({
        title: "Policy saved",
        detail: `${tenantId} | ${route}`,
        tone: "success",
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Policy update failed.";
      setMessage(errorMessage);
      setStatus("error");
    }
  };

  return (
    <section className="panel" style={{ "--delay": "180ms" } as CSSProperties}>
      <div className="panel-head">
        <div>
          <h2>Create Policy</h2>
          <p>Define per-route rate limits for a tenant.</p>
        </div>
        <Badge tone="success">Client admin</Badge>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <Field label="Tenant ID" className="span-3">
          <input
            className="input"
            value={tenantId}
            onChange={(event) => onTenantIdChange(event.target.value)}
            placeholder="your-tenant-id"
          />
        </Field>
        <Field label="Route" className="span-3">
          <input
            className="input"
            value={route}
            onChange={(event) => setRoute(event.target.value)}
            placeholder="login-api"
          />
        </Field>
        <Field label="Limit" hint="Requests per window." className="span-3">
          <input
            className="input"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            type="number"
            min="1"
          />
        </Field>
        <Field
          label="Window"
          hint="Seconds per rate limit window."
          className="span-3"
        >
          <input
            className="input"
            value={windowSeconds}
            onChange={(event) => setWindowSeconds(event.target.value)}
            type="number"
            min="1"
          />
        </Field>
        <Field label="Algorithm" className="span-6">
          <select
            className="input select"
            value={algorithm}
            onChange={(event) =>
              setAlgorithm(
                event.target.value as
                  | "sliding_window"
                  | "fixed_window"
                  | "token_bucket",
              )
            }
          >
            <option value="sliding_window">Sliding window</option>
            <option value="fixed_window">Fixed window</option>
            <option value="token_bucket">Token bucket</option>
          </select>
        </Field>
        <div className="form-actions span-6">
          <Button type="submit" loading={status === "loading"}>
            Save policy
          </Button>
          <span className="muted">Applies instantly across the edge.</span>
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
