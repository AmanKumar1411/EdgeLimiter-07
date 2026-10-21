import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Plus, RefreshCw, Ban } from "lucide-react";
import {
  createKey,
  listKeys,
  revokeKey,
  sessionStore,
  type ApiKeyInfo,
  type Session,
} from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyField } from "@/components/CopyField";
import { Skeleton, Spinner } from "@/components/Loading";
import { ErrorAlert } from "@/pages/RegisterPage";
import { logActivity } from "@/lib/activity";

// D1 CURRENT_TIMESTAMP is UTC without a zone ("YYYY-MM-DD HH:MM:SS").
function formatTimestamp(value: string) {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Lists and revokes API keys. Clients see their own keys; an admin viewing a
 * tenant (viewedTenantId) sees every key in that tenant. New keys are always
 * created for the signed-in user and shown exactly once.
 */
export function KeysSection({
  session,
  viewedTenantId,
}: {
  session: Session;
  viewedTenantId?: string;
}) {
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "create" | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const adminView = session.role === "super_admin" && !!viewedTenantId;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await listKeys(
        session.apiKey,
        adminView ? viewedTenantId : undefined,
      );
      setKeys(data.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, [session.apiKey, adminView, viewedTenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate() {
    setBusy("create");
    setError(null);
    setNewKey(null);
    try {
      const { data } = await createKey(session.apiKey);
      setNewKey(data.apiKey);
      logActivity({ title: "API key created", detail: data.hint, tone: "success" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setBusy(null);
    }
  }

  async function handleRevoke(key: ApiKeyInfo) {
    const warning = key.current
      ? "This is the key you are signed in with. Revoking it signs you out immediately. Continue?"
      : `Revoke ${key.hint}? Requests using it will be rejected immediately.`;
    if (!window.confirm(warning)) return;

    setBusy(key.id);
    setError(null);
    try {
      const { data } = await revokeKey(key.id, session.apiKey);
      logActivity({ title: "API key revoked", detail: key.hint, tone: "warning" });
      if (data.current) {
        sessionStore.clear();
        navigate(session.role === "super_admin" ? "/admin-login" : "/login", {
          replace: true,
        });
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">API Keys</h2>
          <p className="text-muted-foreground max-w-2xl">
            Keys are stored hashed and shown only once. Revocation takes effect
            on the next request.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="btn-outline !py-2 text-sm"
          >
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          {!adminView && (
            <button
              onClick={handleCreate}
              disabled={busy === "create"}
              className="btn-primary !py-2 text-sm"
            >
              {busy === "create" ? <Spinner /> : <Plus className="h-4 w-4" />}
              New key
            </button>
          )}
        </div>
      </header>

      {error && <ErrorAlert message={error} />}

      {newKey && (
        <div className="glass-card p-5 space-y-3 border border-warning/30">
          <div className="text-sm font-medium text-warning">
            Copy this key now — it will not be shown again.
          </div>
          <CopyField value={newKey} label="New API key" />
        </div>
      )}

      <div className="glass-card p-6">
        {loading && !keys ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !keys || keys.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10 flex flex-col items-center gap-2">
            <KeyRound className="h-7 w-7 opacity-40" />
            No keys found.
          </div>
        ) : (
          <ul className="divide-y divide-border/10">
            {keys.map((key) => (
              <li
                key={key.id}
                className="py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm">{key.hint}</code>
                    <StatusBadge tone={key.status === "active" ? "success" : "muted"}>
                      {key.status}
                    </StatusBadge>
                    {key.current && <StatusBadge tone="primary">this session</StatusBadge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {key.email} · created {formatTimestamp(key.createdAt)}
                    {key.revokedAt && ` · revoked ${formatTimestamp(key.revokedAt)}`}
                  </div>
                </div>
                {key.status === "active" && (
                  <button
                    onClick={() => handleRevoke(key)}
                    disabled={busy === key.id}
                    className="btn-outline !py-1.5 !px-2.5 text-xs text-destructive"
                  >
                    {busy === key.id ? <Spinner /> : <Ban className="h-3.5 w-3.5" />}
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
