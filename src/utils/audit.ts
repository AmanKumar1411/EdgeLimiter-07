import type { Env } from "../types/env";

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
  await env.DB.prepare(`
    INSERT INTO audit_logs (
      tenant_id,
      api_key,
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
      payload.apiKey || null,
      payload.route || null,
      payload.actor,
      payload.actionType,
      payload.message,
      payload.severity,
      new Date().toISOString()
    )
    .run();
}