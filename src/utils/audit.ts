import type { Env } from "../types/env";
import { maskApiKey } from "./apiKeys";

/*
 Best-effort: runs in waitUntil and must never fail the request, so
 errors are logged rather than thrown. Only a masked key is stored.
*/
export async function createAuditLog(
  env: Env,
  payload: {
    tenantId: string;
    apiKey?: string;
    route?: string;
    actor: string;
    actionType: string;
    message: string;
    severity: "Low" | "Medium" | "High" | "Critical";
  }
) {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_logs (
        tenant_id,
        api_key_hint,
        route,
        actor,
        action_type,
        message,
        severity,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        payload.tenantId,
        payload.apiKey ? maskApiKey(payload.apiKey) : null,
        payload.route || null,
        payload.actor,
        payload.actionType,
        payload.message,
        payload.severity,
        new Date().toISOString()
      )
      .run();
  } catch (err) {
    console.error("audit log write failed", {
      actionType: payload.actionType,
      tenantId: payload.tenantId,
      error: String(err),
    });
  }
}
