import "server-only";

import { env } from "cloudflare:workers";

import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";

type RpcResponse<T> = { jsonrpc: "2.0"; id: number; result?: T; error?: { code: number; message: string } };
type BalanceResult = { context: { slot: number }; value: number };

export type TreasuryObservationTrigger = "operator" | "scheduled" | "internal";

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  if (message.includes("not configured")) return "configuration_required";
  if (message.includes("RPC")) return "rpc_unavailable";
  return "observation_failed";
}

async function fetchBalances(apiKey: string, rewardAddress: string, buybackAddress: string) {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "getBalance", params: [rewardAddress, { commitment: "finalized" }] },
      { jsonrpc: "2.0", id: 2, method: "getBalance", params: [buybackAddress, { commitment: "finalized" }] },
    ]),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const payload = await response.json() as Array<RpcResponse<BalanceResult>>;
  const reward = payload.find((item) => item.id === 1);
  const buyback = payload.find((item) => item.id === 2);
  if (!reward?.result || reward.error || !buyback?.result || buyback.error) {
    throw new Error("RPC response did not contain both finalized balances");
  }
  if (!Number.isSafeInteger(reward.result.value) || !Number.isSafeInteger(buyback.result.value)) {
    throw new Error("RPC returned an invalid balance");
  }
  return { reward: reward.result, buyback: buyback.result };
}

export async function observeTreasuries(trigger: TreasuryObservationTrigger) {
  if (!env.DB) throw new Error("D1 binding `DB` is unavailable.");
  const mainnet = readMainnetConfig();
  const heliusApiKey = readProviderCredentials().heliusApiKey;
  if (!heliusApiKey) throw new Error("Helius is not configured");
  if (!mainnet.rewardTreasury || !mainnet.buybackTreasury) throw new Error("Treasury addresses are not configured");

  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO worker_runs (id, worker, \"trigger\", state) VALUES (?1, 'treasury_observer', ?2, 'running')")
    .bind(runId, trigger).run();
  try {
    const balances = await fetchBalances(heliusApiKey, mainnet.rewardTreasury, mainnet.buybackTreasury);
    const observations = [
      { purpose: "reward", address: mainnet.rewardTreasury, ...balances.reward },
      { purpose: "buyback", address: mainnet.buybackTreasury, ...balances.buyback },
    ];
    const statements = observations.flatMap((observation) => {
      const id = `treasury:${observation.purpose}:${observation.context.slot}`;
      return [
        env.DB!.prepare("INSERT OR IGNORE INTO treasury_observations (id, purpose, address, balance_lamports, slot) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(id, observation.purpose, observation.address, String(observation.value), observation.context.slot),
        env.DB!.prepare("INSERT OR IGNORE INTO protocol_events (id, category, entity_type, entity_id, event_type, idempotency_key, state, slot, amount_atomic) VALUES (?1, 'treasury', 'treasury', ?2, 'balance_observed', ?1, 'verified', ?3, ?4)")
          .bind(id, observation.purpose, observation.context.slot, String(observation.value)),
      ];
    });
    const writeResults = await env.DB.batch(statements);
    const itemsChanged = [writeResults[0], writeResults[2]].reduce(
      (sum, result) => sum + Number(result.meta.changes ?? 0),
      0,
    );
    await env.DB.prepare("UPDATE worker_runs SET state = 'succeeded', items_seen = 2, items_changed = ?2, completed_at = CURRENT_TIMESTAMP WHERE id = ?1")
      .bind(runId, itemsChanged).run();
    return {
      runId,
      observations: observations.map((observation) => ({
        purpose: observation.purpose,
        address: observation.address,
        balanceLamports: String(observation.value),
        slot: observation.context.slot,
      })),
    };
  } catch (error) {
    await env.DB.prepare("UPDATE worker_runs SET state = 'failed', error_code = ?2, completed_at = CURRENT_TIMESTAMP WHERE id = ?1")
      .bind(runId, errorCode(error)).run();
    throw error;
  }
}
