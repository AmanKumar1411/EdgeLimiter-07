import type { Env } from "../types/env";

export async function queue(
  batch: MessageBatch<any>,
  env: Env
) {
  for (const message of batch.messages) {
    const { apiKey, blocked } = message.body;

    const existingLog =
      await env.DB.prepare(
        `SELECT * FROM logs_summary
         WHERE api_key = ?`
      )
        .bind(apiKey)
        .first();

    if (existingLog) {
      await env.DB.prepare(`
        UPDATE logs_summary
        SET
          total_requests = total_requests + 1,
          blocked_requests = blocked_requests + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE api_key = ?
      `)
        .bind(blocked, apiKey)
        .run();
    } else {
      await env.DB.prepare(`
        INSERT INTO logs_summary
        (
          api_key,
          total_requests,
          blocked_requests
        )
        VALUES (?, ?, ?)
      `)
        .bind(apiKey, 1, blocked)
        .run();
    }

    message.ack();
  }
}