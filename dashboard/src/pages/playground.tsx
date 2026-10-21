import { Gauge, Lock, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckSnippet } from "@/components/code-snippet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorMessage, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { api, type CheckResult } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { useTenant } from "@/lib/tenant";
import { useApi } from "@/lib/use-api";

interface Attempt extends CheckResult {
  route: string;
  identifier: string;
  at: string;
}

export function Playground() {
  const { tenantId, session, basePath, isOwnTenant } = useTenant();
  const policies = useApi(`policies:${tenantId}:${session.apiKey}`, () => api.policies(tenantId, session.apiKey));
  const [route, setRoute] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const selected = route || policies.data?.[0]?.route || "";
  const latest = attempts[0];

  async function send(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(undefined);
    try {
      const result = await api.check(tenantId, selected, session.apiKey, identifier.trim() || undefined);
      const attempt = { ...result, route: selected, identifier: identifier.trim(), at: new Date().toLocaleTimeString() };
      setAttempts((previous) => [attempt, ...previous].slice(0, 8));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  const header = (
    <PageHeader
      title="Test request"
      description="Send a real /check call with your signed-in key and see the decision your backend would get."
    />
  );

  if (!isOwnTenant) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Lock}
            title="Only this project's keys can call /check"
            description="Sign in with one of the project's own keys to send test requests."
          />
        </Card>
      </>
    );
  }

  if (policies.loading && !policies.data) {
    return (
      <>
        {header}
        <SkeletonRows rows={4} />
      </>
    );
  }

  if (!policies.data?.length) {
    return (
      <>
        {header}
        {policies.error && <ErrorMessage message={policies.error} onRetry={policies.reload} className="mb-4" />}
        <Card>
          <EmptyState
            icon={Gauge}
            title="Add a limit first"
            description="/check answers 404 for routes without a limit."
            action={
              <Link to={`${basePath}/limits`} className={buttonVariants({ variant: "primary" })}>
                Go to limits
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Request" />
          <form onSubmit={send} className="space-y-4 p-4">
            <Field label="Route">
              <Select value={selected} onChange={(e) => setRoute(e.target.value)} className="font-mono">
                {policies.data.map((p) => (
                  <option key={p.route} value={p.route}>
                    {p.route}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Identifier (optional)" hint="Give each end user their own counter, e.g. a user ID or IP.">
              <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="user-42" />
            </Field>
            {error && <ErrorMessage message={error} />}
            <Button type="submit" variant="primary" disabled={sending}>
              <Send aria-hidden />
              {sending ? "Sending…" : "Send request"}
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Response" description={latest ? `Sent at ${latest.at}` : undefined} />
          {latest ? (
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-2">
                <Badge tone={latest.allowed ? "success" : "danger"}>{latest.allowed ? "Allowed" : "Blocked"}</Badge>
                <span className="font-mono text-sm text-muted-foreground">HTTP {latest.status}</span>
              </div>
              {latest.degraded && (
                <p className="text-sm text-warning">
                  The limiter was unavailable ({latest.degraded}), so the request was allowed without counting.
                </p>
              )}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Remaining", latest.remaining ?? "—"],
                  ["Limit", latest.limit ?? "—"],
                  ["Retry after", latest.allowed ? "—" : `${latest.retryAfter}s`],
                  ["Resets at", latest.reset ? new Date(Number(latest.reset) * 1000).toLocaleTimeString() : "—"],
                ].map(([term, value]) => (
                  <div key={term} className="rounded border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{term}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Send a request to see the decision.</p>
          )}
        </Card>
      </div>

      {attempts.length > 1 && (
        <Card className="mt-4">
          <CardHeader title="This session" />
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Route</Th>
                <Th>Identifier</Th>
                <Th>Result</Th>
                <Th className="text-right">Remaining</Th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a, i) => (
                <tr key={i}>
                  <Td className="text-muted-foreground">{a.at}</Td>
                  <Td className="font-mono">{a.route}</Td>
                  <Td className="text-muted-foreground">{a.identifier || "—"}</Td>
                  <Td>
                    <Badge tone={a.allowed ? "success" : "danger"}>{a.status}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{a.remaining ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="mt-4">
        <h2 className="mb-2 text-sm font-semibold">Call it from your backend</h2>
        <CheckSnippet tenantId={tenantId} route={selected} apiKey={session.apiKey} />
      </div>
    </>
  );
}
