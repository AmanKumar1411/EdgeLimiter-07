import { Ban, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SecretValue } from "@/components/ui/copy-button";
import { EmptyState, ErrorMessage, SkeletonRows, SuccessMessage } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { api, loginPath, sessionStore, type ApiKeyInfo } from "@/lib/api";
import { errorMessage, formatDateTime } from "@/lib/format";
import { useTenant } from "@/lib/tenant";
import { useApi } from "@/lib/use-api";

export function Keys() {
  const navigate = useNavigate();
  const { tenantId, session, isOwnTenant } = useTenant();
  const keys = useApi(`keys:${session.apiKey}:${tenantId}`, () => api.keys(session.apiKey, tenantId));
  const [created, setCreated] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<number | "create">();

  async function create() {
    setBusy("create");
    setError(undefined);
    setNotice(undefined);
    try {
      setCreated((await api.createKey(session.apiKey)).apiKey);
      keys.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function revoke(key: ApiKeyInfo) {
    const question = key.current
      ? "This is the key you're signed in with. Revoking it signs you out immediately. Revoke it?"
      : `Revoke ${key.hint}? Requests using it are rejected from the next call on.`;
    if (!window.confirm(question)) return;

    setBusy(key.id);
    setError(undefined);
    try {
      const result = await api.revokeKey(key.id, session.apiKey);
      if (result.current) {
        sessionStore.clear();
        navigate(loginPath(session.role), { replace: true });
        return;
      }
      setNotice(`${key.hint} revoked.`);
      keys.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys are stored hashed and shown only once. Revoking takes effect on the next request."
        actions={
          isOwnTenant && (
            <Button variant="primary" onClick={create} disabled={busy === "create"}>
              <Plus aria-hidden />
              Create key
            </Button>
          )
        }
      />

      <div className="mb-4 space-y-2 empty:hidden">
        {created && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-card p-4">
            <SecretValue label="New API key" value={created} />
            <p className="text-sm text-muted-foreground">Copy it now. It won't be shown again.</p>
          </div>
        )}
        {notice && <SuccessMessage message={notice} />}
        {(error ?? keys.error) && <ErrorMessage message={(error ?? keys.error)!} onRetry={keys.reload} />}
      </div>

      <Card>
        <CardHeader title={isOwnTenant ? "Your keys" : `Keys in ${tenantId}`} />
        {keys.loading && !keys.data ? (
          <SkeletonRows />
        ) : !keys.data?.length ? (
          <EmptyState icon={KeyRound} title="No keys" description="Keys appear here once they're created." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {keys.data.map((key) => (
                <tr key={key.id}>
                  <Td className="whitespace-nowrap font-mono">
                    {key.hint}
                    {key.current && (
                      <span className="ml-2 font-sans">
                        <Badge tone="accent">This session</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="text-muted-foreground">{key.email}</Td>
                  <Td>
                    {key.status === "active" ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <span title={key.revokedAt ? `Revoked ${formatDateTime(key.revokedAt)}` : undefined}>
                        <Badge>Revoked</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(key.createdAt)}</Td>
                  <Td className="text-right">
                    {key.status === "active" && (
                      <Button size="sm" variant="danger" disabled={busy === key.id} onClick={() => revoke(key)}>
                        <Ban aria-hidden />
                        Revoke
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
