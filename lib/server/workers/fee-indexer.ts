import "server-only";

import { env } from "cloudflare:workers";
import { PublicKey } from "@solana/web3.js";

import { feeEventId } from "@/lib/protocol/accounting";
import { verifyPumpFeeDistributions, type FinalizedSolanaTransaction } from "@/lib/protocol/pump-fee-distribution";
import { feeSharingConfigPda } from "@/lib/protocol/pump-devnet-verification";
import { readExecutionConfig } from "@/lib/server/execution-config";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import { acquireWorkerLease, releaseWorkerLease } from "./lease";

const WORKER = "pump_fee_indexer";
const LEASE_KEY = "worker:pump-fee-indexer";
const SIGNATURE_LIMIT = 1_000;
const TRANSACTION_BATCH = 25;

export type FeeIndexerTrigger = "operator" | "scheduled" | "internal";

type LaunchRow = {
  id: string;
  mainnet_mint: string;
  mainnet_fee_slot: number;
  mainnet_reward_treasury: string;
  mainnet_buyback_treasury: string;
};

type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  confirmationStatus: string | null;
};

type RpcEnvelope<T> = { jsonrpc: "2.0"; id: number; result?: T; error?: { code: number; message: string } };

function workerErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  if (message.includes("disabled")) return "worker_disabled";
  if (message.includes("lease")) return "lease_unavailable";
  if (message.includes("backlog")) return "scan_backlog";
  if (message.includes("RPC") || message.includes("Helius")) return "rpc_unavailable";
  if (message.includes("Pump distribution")) return "distribution_verification_failed";
  return "fee_indexer_failed";
}

async function rpc<T>(apiKey: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Helius RPC returned ${response.status}.`);
  const payload = await response.json() as RpcEnvelope<T>;
  if (payload.error || payload.result === undefined) throw new Error(`Helius RPC ${method} failed.`);
  return payload.result;
}

async function fetchTransactions(apiKey: string, signatures: string[]) {
  const results = new Map<string, FinalizedSolanaTransaction>();
  for (let offset = 0; offset < signatures.length; offset += TRANSACTION_BATCH) {
    const batch = signatures.slice(offset, offset + TRANSACTION_BATCH);
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch.map((signature, index) => ({
        jsonrpc: "2.0",
        id: index + 1,
        method: "getTransaction",
        params: [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }],
      }))),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Helius RPC returned ${response.status}.`);
    const payload = await response.json() as Array<RpcEnvelope<FinalizedSolanaTransaction | null>>;
    const byId = new Map(payload.map((item) => [item.id, item]));
    batch.forEach((signature, index) => {
      const item = byId.get(index + 1);
      if (!item || item.error || !item.result) throw new Error(`Helius RPC getTransaction failed for ${signature}.`);
      results.set(signature, item.result);
    });
  }
  return results;
}

async function indexLaunch(database: D1Database, apiKey: string, launch: LaunchRow) {
  const cursorKey = `pump-fees:${launch.id}`;
  const cursorRow = await database.prepare("SELECT value FROM service_cursors WHERE key = ?1 LIMIT 1")
    .bind(cursorKey).first<{ value: string }>();
  const cursorBefore = cursorRow?.value ?? null;
  const sharingConfig = feeSharingConfigPda(new PublicKey(launch.mainnet_mint)).toBase58();
  const options: Record<string, unknown> = { commitment: "finalized", limit: SIGNATURE_LIMIT };
  if (cursorBefore) options.until = cursorBefore;
  const signatures = await rpc<SignatureInfo[]>(apiKey, "getSignaturesForAddress", [sharingConfig, options]);
  if (signatures.some((item) => item.confirmationStatus !== "finalized")) {
    throw new Error("Helius RPC returned a non-finalized fee signature.");
  }
  const oldest = signatures.at(-1);
  if (signatures.length === SIGNATURE_LIMIT && (cursorBefore || (oldest && oldest.slot > launch.mainnet_fee_slot))) {
    throw new Error(`Fee scan backlog exceeds the ${SIGNATURE_LIMIT}-signature safety window.`);
  }
  const relevant = signatures.filter((item) => item.slot > launch.mainnet_fee_slot && item.err === null);
  const transactions = await fetchTransactions(apiKey, relevant.map((item) => item.signature));
  const verified = relevant
    .slice()
    .reverse()
    .flatMap((item) => verifyPumpFeeDistributions({
      transaction: transactions.get(item.signature)!,
      mint: launch.mainnet_mint,
      rewardTreasury: launch.mainnet_reward_treasury,
      buybackTreasury: launch.mainnet_buyback_treasury,
    }));

  if (signatures.length === 0) return { seen: 0, changed: 0, cursorBefore, cursorAfter: cursorBefore };
  const cursorAfter = signatures[0].signature;
  const statements: D1PreparedStatement[] = [];
  for (const distribution of verified) {
    const eventId = feeEventId(distribution.signature, distribution.instructionIndex);
    const settlementId = `settlement:${eventId}`;
    statements.push(
      database.prepare(`
        INSERT OR IGNORE INTO fee_events
          (id, launch_id, source_signature, instruction_index, source_slot, gross_amount_atomic, state)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'reconciled')
      `).bind(eventId, launch.id, distribution.signature, distribution.instructionIndex, distribution.slot, distribution.grossAmountAtomic),
      database.prepare(`
        INSERT OR IGNORE INTO settlements
          (id, fee_event_id, reward_amount_atomic, buyback_amount_atomic, state)
        VALUES (?1, ?2, ?3, ?4, 'reconciled')
      `).bind(settlementId, eventId, distribution.rewardAmountAtomic, distribution.buybackAmountAtomic),
      database.prepare(`
        INSERT OR IGNORE INTO protocol_events
          (id, category, entity_type, entity_id, event_type, idempotency_key, state, signature, slot, amount_atomic, mint)
        VALUES (?1, 'fees', 'launch', ?2, 'pump_fee_distributed', ?1, 'verified', ?3, ?4, ?5, ?6)
      `).bind(`fee:${eventId}`, launch.id, distribution.signature, distribution.slot, distribution.grossAmountAtomic, launch.mainnet_mint),
    );
  }
  statements.push(database.prepare(`
    INSERT INTO service_cursors (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(cursorKey, cursorAfter));
  const writeResults = await database.batch(statements);
  let changed = 0;
  for (let index = 0; index < verified.length; index += 1) {
    changed += Number(writeResults[index * 3]?.meta.changes ?? 0);
  }
  return { seen: signatures.length, changed, cursorBefore, cursorAfter };
}

export async function runFeeIndexer(trigger: FeeIndexerTrigger) {
  if (!env.DB) throw new Error("D1 binding `DB` is unavailable.");
  if (!readExecutionConfig().flags.feeIndexerEnabled) throw new Error("Pump fee indexer is disabled.");
  const apiKey = readProviderCredentials().heliusApiKey;
  if (!apiKey) throw new Error("Helius is not configured.");
  const owner = crypto.randomUUID();
  if (!(await acquireWorkerLease({ database: env.DB, key: LEASE_KEY, owner }))) {
    return { skipped: true, reason: "lease_held" as const };
  }

  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO worker_runs (id, worker, \"trigger\", state) VALUES (?1, ?2, ?3, 'running')")
    .bind(runId, WORKER, trigger).run();
  try {
    const launches = await env.DB.prepare(`
      SELECT id, mainnet_mint, mainnet_fee_slot, mainnet_reward_treasury, mainnet_buyback_treasury
      FROM launch_drafts
      WHERE status IN ('mainnet_published', 'mainnet_suspended')
        AND mainnet_mint IS NOT NULL
        AND mainnet_fee_slot IS NOT NULL
        AND mainnet_reward_treasury IS NOT NULL
        AND mainnet_buyback_treasury IS NOT NULL
      ORDER BY id
    `).all<LaunchRow>();
    let itemsSeen = 0;
    let itemsChanged = 0;
    for (const launch of launches.results) {
      const result = await indexLaunch(env.DB, apiKey, launch);
      itemsSeen += result.seen;
      itemsChanged += result.changed;
    }
    await env.DB.prepare(`
      UPDATE worker_runs SET state = 'succeeded', items_seen = ?2, items_changed = ?3, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?1
    `).bind(runId, itemsSeen, itemsChanged).run();
    return { skipped: false, runId, launches: launches.results.length, itemsSeen, itemsChanged };
  } catch (error) {
    await env.DB.prepare("UPDATE worker_runs SET state = 'failed', error_code = ?2, completed_at = CURRENT_TIMESTAMP WHERE id = ?1")
      .bind(runId, workerErrorCode(error)).run();
    throw error;
  } finally {
    await releaseWorkerLease(env.DB, LEASE_KEY, owner);
  }
}
