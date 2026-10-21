import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { SecretValue } from "@/components/ui/copy-button";
import { ErrorMessage } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { ApiError, api, sessionStore } from "@/lib/api";
import { errorMessage } from "@/lib/format";

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold">
      <span className="flex size-6 items-center justify-center rounded bg-primary text-[11px] text-primary-foreground">
        EL
      </span>
      EdgeLimiter
    </Link>
  );
}

const EXAMPLE = `POST /check
x-api-key: edge_limit_••••
{ "tenantId": "acme", "route": "/api/login" }

HTTP/1.1 429 Too Many Requests
Retry-After: 12
X-RateLimit-Limit: 100

{ "allowed": false, "remaining": 0, "retryAfter": 12 }`;

const STEPS = [
  ["Create a project", "You get an API key for your backend."],
  ["Add a limit", "For example, 100 requests per minute on /api/login."],
  ["Call /check", "Before serving a request. Over the limit, reply 429 with Retry-After."],
];

export function Landing() {
  const signedIn = sessionStore.get();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Brand />
        {signedIn ? (
          <Link to={signedIn.role === "super_admin" ? "/admin" : "/dashboard"} className={buttonVariants()}>
            Open dashboard
          </Link>
        ) : (
          <div className="flex gap-2">
            <Link to="/login" className={buttonVariants({ variant: "ghost" })}>
              Sign in
            </Link>
            <Link to="/register" className={buttonVariants({ variant: "primary" })}>
              Create a project
            </Link>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-12">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Rate limits for your API, decided at the edge.</h1>
            <p className="mt-3 max-w-md text-muted-foreground">
              Set a limit per route. Before serving a request your backend asks{" "}
              <code className="font-mono text-foreground">/check</code>, and gets allow or block with standard
              rate-limit headers.
            </p>
            <div className="mt-6 flex gap-2">
              <Link to="/register" className={buttonVariants({ variant: "primary" })}>
                Create a project
              </Link>
              <Link to="/login" className={buttonVariants()}>
                Sign in
              </Link>
            </div>
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-card p-4 font-mono text-[12px] leading-relaxed">
            {EXAMPLE}
          </pre>
        </div>

        <ol className="mt-14 grid gap-3 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="rounded-lg border bg-card p-4">
              <div className="text-xs text-muted-foreground">Step {i + 1}</div>
              <div className="mt-1 font-medium">{title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-muted-foreground">
        <Link to="/admin-login" className="hover:text-foreground">
          Admin sign in
        </Link>
      </footer>
    </div>
  );
}

function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Brand />
      <div className="mt-6 w-full max-w-sm rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        <div className="mt-5">{children}</div>
      </div>
      {footer && <p className="mt-4 text-sm text-muted-foreground">{footer}</p>}
    </div>
  );
}

export function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ apiKey: string; tenantId: string; email: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      setCreated(await api.register(email, projectId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function continueToSetup() {
    if (!created) return;
    sessionStore.set({ ...created, role: "client" });
    navigate("/dashboard/setup");
  }

  if (created) {
    return (
      <AuthLayout title="Project created" description={`Your project ${created.tenantId} is ready.`}>
        <div className="space-y-4">
          <SecretValue label="API key" value={created.apiKey} />
          <p className="text-sm text-muted-foreground">
            Copy this key now. It's stored hashed and won't be shown again; you can create more keys later.
          </p>
          <Button variant="primary" className="w-full" onClick={continueToSetup}>
            I've saved my key, continue
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create a project"
      description="A project holds your limits and API keys."
      footer={
        <>
          Already have a key?{" "}
          <Link to="/login" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Project ID" hint="Lowercase letters, digits, - and _. You can't change it later.">
          <Input
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value.toLowerCase())}
            placeholder="acme-api"
            pattern="[a-z0-9]([a-z0-9_\-]{0,62}[a-z0-9])?"
            className="font-mono"
          />
        </Field>
        {error && <ErrorMessage message={error} />}
        <Button type="submit" variant="primary" className="w-full" disabled={saving}>
          {saving ? "Creating…" : "Create project"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function Login({ admin }: { admin: boolean }) {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(undefined);
    const key = apiKey.trim();
    try {
      const account = await api.whoami(key);
      if (account.tenantId !== projectId.trim()) {
        setError("This API key belongs to a different project.");
      } else if (admin && account.role !== "super_admin") {
        setError("This API key does not have admin privileges.");
      } else {
        sessionStore.set({ ...account, apiKey: key });
        navigate(account.role === "super_admin" && admin ? "/admin" : "/dashboard", { replace: true });
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That API key isn't valid or has been revoked. Check it, or create a new project."
          : errorMessage(err),
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <AuthLayout
      title={admin ? "Admin sign in" : "Sign in"}
      description={admin ? "Use a super admin API key." : "Use your project ID and an API key."}
      footer={
        admin ? undefined : (
          <>
            New here?{" "}
            <Link to="/register" className="font-medium text-foreground hover:underline">
              Create a project
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project ID">
          <Input required value={projectId} onChange={(e) => setProjectId(e.target.value)} className="font-mono" />
        </Field>
        <Field label="API key">
          <Input
            type="password"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="font-mono"
            autoComplete="off"
          />
        </Field>
        {error && <ErrorMessage message={error} />}
        <Button type="submit" variant="primary" className="w-full" disabled={checking}>
          {checking ? "Checking…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Link to="/" className={buttonVariants()}>
        Go home
      </Link>
    </div>
  );
}
