import { env } from "cloudflare:workers";

import { getExecutionStatus } from "@/lib/server/execution-status";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { isOperatorRequest } from "@/lib/server/publication-policy";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";
import { runFeeIndexer } from "@/lib/server/workers/fee-indexer";
import { observeTreasuries } from "@/lib/server/workers/treasury-observer";

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function pauseAll(operatorUserId: string) {
  if (!env.DB) throw new Error("D1 binding `DB` is unavailable.");
  const eventId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO protocol_controls (key, settlement_paused, rewards_paused, buyback_paused, pause_reason, revision, updated_by_user_id, updated_at)
      VALUES ('global', 1, 1, 1, 'operator_pause', 1, ?1, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        settlement_paused = 1,
        rewards_paused = 1,
        buyback_paused = 1,
        pause_reason = 'operator_pause',
        revision = protocol_controls.revision + 1,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(operatorUserId),
    env.DB.prepare(`
      INSERT INTO protocol_events (id, category, entity_type, entity_id, event_type, idempotency_key, state)
      VALUES (?1, 'control', 'protocol', 'global', 'all_lanes_paused', ?1, 'verified')
    `).bind(eventId),
  ]);
}

async function enableWalletExecution(operatorUserId: string) {
  if (!env.DB) throw new Error("D1 binding `DB` is unavailable.");
  const eventId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO protocol_controls (key, settlement_paused, rewards_paused, buyback_paused, pause_reason, revision, updated_by_user_id, updated_at)
      VALUES ('global', 0, 0, 0, 'wallet_confirmed_execution', 1, ?1, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        settlement_paused = 0,
        rewards_paused = 0,
        buyback_paused = 0,
        pause_reason = 'wallet_confirmed_execution',
        revision = protocol_controls.revision + 1,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(operatorUserId),
    env.DB.prepare(`
      INSERT INTO protocol_events (id, category, entity_type, entity_id, event_type, idempotency_key, state)
      VALUES (?1, 'control', 'protocol', 'global', 'wallet_execution_enabled', ?1, 'verified')
    `).bind(eventId),
  ]);
}

export async function GET(request: Request) {
  if (!isOperatorRequest(request)) return privateJson({ error: "Operator access is required." }, 403);
  try {
    return privateJson(await getExecutionStatus());
  } catch (error) {
    console.error("operator_operations_status_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "Operations status is temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isOperatorRequest(request)) return privateJson({ error: "Operator access is required." }, 403);
  if (!isSameOrigin(request)) return privateJson({ error: "Same-origin request required." }, 403);
  const operatorUserId = getLaunchDraftOwner(request);
  if (!operatorUserId) return privateJson({ error: "Operator access is required." }, 403);
  const rateLimit = await consumeFixedWindow({
    scope: "operator_operations",
    subject: operatorUserId,
    limit: 12,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) return rateLimitedJson("Too many operator actions.", rateLimit);

  let body: { action?: unknown };
  try {
    body = await request.json() as { action?: unknown };
  } catch {
    return privateJson({ error: "A JSON action is required." }, 400);
  }

  try {
    if (body.action === "observe_treasuries") {
      const result = await observeTreasuries("operator");
      return privateJson({ ok: true, result, status: await getExecutionStatus() });
    }
    if (body.action === "index_fees") {
      const result = await runFeeIndexer("operator");
      return privateJson({ ok: true, result, status: await getExecutionStatus() });
    }
    if (body.action === "pause_all") {
      await pauseAll(operatorUserId);
      return privateJson({ ok: true, status: await getExecutionStatus() });
    }
    if (body.action === "enable_wallet_execution") {
      await enableWalletExecution(operatorUserId);
      return privateJson({ ok: true, status: await getExecutionStatus() });
    }
    return privateJson({ error: "Unknown operations action." }, 400);
  } catch (error) {
    console.error("operator_operations_action_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "The operation failed safely. No transaction was submitted." }, 503);
  }
}
