import { Check, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckSnippet } from "@/components/code-snippet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { cn, errorMessage, formatTime, maskKey } from "@/lib/format";
import { describeOutcome, outcomeOf } from "@/lib/limits";
import { useTenant } from "@/lib/tenant";
import { useApi } from "@/lib/use-api";

const STARTER = { route: "/api/hello", limit: 10, window: 60, algorithm: "sliding_window" } as const;

function Step({ number, done, title, children }: { number: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
          done && "border-success/40 bg-success/10 text-success",
        )}
        aria-hidden
      >
        {done ? <Check className="size-3.5" /> : number}
      </span>
      <div className="min-w-0 flex-1 pb-8">
        <h2 className="font-medium">
          {title}
          <span className="sr-only">{done ? " (done)" : ""}</span>
        </h2>
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export function Setup() {
  const { tenantId, session, basePath } = useTenant();
  const policies = useApi(`policies:${tenantId}:${session.apiKey}`, () => api.policies(tenantId, session.apiKey));
  // Poll so the first request appears as soon as the queue writes it (~5s).
  const report = useApi(`securityReport:${tenantId}:${session.apiKey}`, () => api.securityReport(tenantId, session.apiKey), 3_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const route = policies.data?.[0]?.route;
  const recent = (report.data?.recentLogs ?? []).slice(0, 5);
  const received = recent.length > 0;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const createStarterLimit = () =>
    run(async () => {
      await api.savePolicy({ tenantId, ...STARTER }, session.apiKey);
      policies.reload();
    });

  const sendTestRequest = () => run(() => api.check(tenantId, route!, session.apiKey));

  return (
    <>
      <PageHeader title="Get started" description="Three steps from zero to your first rate-limited request." />

      <ol className="max-w-3xl">
        <Step number={1} done title="Create a project">
          Project <span className="font-mono text-foreground">{tenantId}</span> is ready.
        </Step>

        <Step number={2} done title="Get an API key">
          You're signed in with <span className="font-mono text-foreground">{maskKey(session.apiKey)}</span>. Keys are
          shown only once; create and revoke them on{" "}
          <Link to={`${basePath}/keys`} className="text-accent hover:underline">
            API keys
          </Link>
          .
        </Step>

        <Step number={3} done={received} title="Send a request and watch it arrive">
          {!route ? (
            <div className="space-y-3">
              <p>
                Requests are checked against a limit, so add one first. A good starter: {STARTER.limit} requests per minute
                on <span className="font-mono text-foreground">{STARTER.route}</span>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={createStarterLimit} disabled={busy || policies.loading}>
                  Create starter limit
                </Button>
                <Link to={`${basePath}/limits`} className={buttonVariants()}>
                  Choose my own
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p>
                Run this from a terminal or your backend. Your key is filled in when you copy.
              </p>
              <CheckSnippet tenantId={tenantId} route={route} apiKey={session.apiKey} />
              <Button onClick={sendTestRequest} disabled={busy}>
                Or send one from the browser
              </Button>
              <div className="rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">Live requests</span>
                  {!received && (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> Waiting for your first request…
                    </span>
                  )}
                </div>
                {received ? (
                  <ul className="divide-y">
                    {recent.map((log) => (
                      <li key={log.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        <span className="shrink-0 whitespace-nowrap tabular-nums">{formatTime(log.createdAt)}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-foreground">{log.route}</span>
                        <Badge tone={outcomeOf(log) === "allowed" ? "success" : "danger"}>{describeOutcome(log)}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-4 text-center text-xs">Requests usually appear within 5 seconds.</p>
                )}
              </div>
            </div>
          )}
          {error && <ErrorMessage message={error} className="mt-3" />}
        </Step>
      </ol>

      {received && (
        <div className="max-w-3xl rounded-lg border bg-card px-4 py-3">
          <div className="font-medium">You're set up.</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Add limits for your real routes, then follow traffic on the{" "}
            <Link to={basePath} className="text-accent hover:underline">
              overview
            </Link>
            .
          </p>
        </div>
      )}
    </>
  );
}
