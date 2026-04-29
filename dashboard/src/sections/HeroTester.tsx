import { useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import { Badge } from "../components/Badge";
import type { BadgeTone } from "../components/Badge";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { runCheck } from "../lib/api";

const DEFAULT_ROUTE = "login-api";

type HeroTesterProps = {
  tenantId: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onActivity?: (entry: {
    title: string;
    detail: string;
    tone?: BadgeTone;
  }) => void;
};

export function HeroTester({
  tenantId,
  apiKey,
  onApiKeyChange,
  onActivity,
}: HeroTesterProps) {
  const [route, setRoute] = useState(DEFAULT_ROUTE);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof runCheck>
  > | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!apiKey || !tenantId || !route) {
      setError("API key, tenant ID, and route are required.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const response = await runCheck({ tenantId, route }, apiKey);
      setResult(response);
      setLastCheckedAt(new Date().toLocaleTimeString());
      setStatus("success");
      onActivity?.({
        title: response.data.allowed ? "Check allowed" : "Check blocked",
        detail: `${tenantId} | ${route}`,
        tone: response.data.allowed ? "success" : "danger",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Check failed.";
      setError(message);
      setStatus("error");
    }
  };

  const verdict = result?.data.allowed;

  const resetTime = useMemo(() => {
    if (!result?.rateLimit.reset) {
      return "n/a";
    }
    return new Date(result.rateLimit.reset * 1000).toLocaleTimeString();
  }, [result]);

  const prefillDemo = () => {
    setRoute(DEFAULT_ROUTE);
  };

  return (
    <section
      id="live-control"
      className="hero panel section-anchor"
      style={{ "--delay": "80ms" } as CSSProperties}
    >
      <div className="hero-head">
        <div>
          <div className="eyebrow">Live Control Plane</div>
          <h1>EdgeLimiter Live Rate Test</h1>
          <p className="hero-subtitle">
            Validate limits in real time, inspect headers, and confirm each
            route is enforced across the edge.
          </p>
        </div>
        <div className="hero-actions">
          <Badge tone="info">Latency-aware</Badge>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={prefillDemo}
          >
            Use demo values
          </Button>
        </div>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <Field
          label="Tenant ID"
          hint="Shared across all panels."
          className="span-3"
        >
          <input className="input" value={tenantId} disabled />
        </Field>
        <Field label="Route" className="span-3">
          <input
            className="input"
            value={route}
            onChange={(event) => setRoute(event.target.value)}
            placeholder="login-api"
          />
        </Field>
        <Field
          label="API Key"
          hint="Issued from the Register panel."
          className="span-3"
        >
          <input
            className="input"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="sk_live_..."
          />
        </Field>
        <div className="field action-field span-3">
          <span className="field-label">Action</span>
          <Button
            type="submit"
            loading={status === "loading"}
            className="button-block"
          >
            Run check
          </Button>
          <span className="field-hint">
            {lastCheckedAt
              ? `Last check ${lastCheckedAt}`
              : "Awaiting first run"}
          </span>
        </div>
      </form>

      <div className="result-grid">
        <div className="result-card">
          <div className="result-label">Verdict</div>
          <div className="result-value">
            {verdict === undefined ? (
              <Badge tone="info">Waiting ⏳</Badge>
            ) : verdict ? (
              <Badge tone="success">Allowed ✅</Badge>
            ) : (
              <Badge tone="danger">Blocked ❌</Badge>
            )}
          </div>
        </div>
        <div className="result-card">
          <div className="result-label">Remaining</div>
          <div className="result-value">{result?.data.remaining ?? "--"}</div>
        </div>
        <div className="result-card">
          <div className="result-label">Retry After</div>
          <div className="result-value">
            {result?.data.retryAfter !== undefined
              ? `${result.data.retryAfter}s`
              : "--"}
          </div>
        </div>
        <div className="result-card">
          <div className="result-label">Algorithm</div>
          <div className="result-value">{result?.data.algorithm ?? "--"}</div>
        </div>
        <div className="result-card">
          <div className="result-label">Limit</div>
          <div className="result-value">{result?.rateLimit.limit ?? "--"}</div>
        </div>
        <div className="result-card">
          <div className="result-label">Reset At</div>
          <div className="result-value">{resetTime}</div>
        </div>
      </div>

      {status === "error" && error ? (
        <div className="notice notice-error">{error}</div>
      ) : null}

      {status === "success" && result ? (
        <div className="notice notice-success">
          {result.status === 429
            ? "Traffic blocked. Consider adjusting the limit or window."
            : "Traffic allowed. Limits are enforced as expected."}
        </div>
      ) : null}
    </section>
  );
}
