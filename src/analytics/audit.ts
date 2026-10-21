import { maskApiKey } from "../keys/keys";
import type { Background, Env } from "../shared/env";
import { log } from "../shared/log";

export interface AuditEntry {
  tenantId: string;
  apiKey?: string;
  route?: string;
  actor: string;
  actionType: string;
  message: string;
  severity: "Low" | "Medium" | "High" | "Critical";
}

/** Best-effort: runs after the response; only a masked key is stored. */
export function writeAudit(env: Env, ctx: Background, entry: AuditEntry) {
  const write = async () => {
    await env.DB.prepare(
      `
      INSERT INTO audit_logs (tenant_id, api_key_hint, route, actor, action_type, message, severity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
      .bind(
        entry.tenantId,
        entry.apiKey ? maskApiKey(entry.apiKey) : null,
        entry.route || null,
        entry.actor,
        entry.actionType,
        entry.message,
        entry.severity,
        new Date().toISOString(),
      )
      .run();
  };
  ctx.waitUntil(
    write().catch((err) =>
      log.error("audit_write_failed", err, { actionType: entry.actionType, tenantId: entry.tenantId }),
    ),
  );
}
