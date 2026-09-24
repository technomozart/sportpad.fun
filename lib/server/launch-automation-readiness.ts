import "server-only";

import { env } from "cloudflare:workers";

import {
  evaluateLaunchAutomationReadiness,
  type AutomationHeartbeat,
  type LaunchAutomationReadiness,
  type MaintenanceRun,
} from "@/lib/protocol/launch-automation-gate";
import { FINANCIAL_LEDGER_VERIFIED } from "@/lib/protocol/automation-safety";
import { AUTOMATED_PUMP_FEE_COLLECTION_VERIFIED } from "@/lib/protocol/fee-collection-gate";
import { CHILIZ_ASSET_MIGRATION_VERIFIED } from "@/lib/protocol/chiliz-receipts";
import { CHILIZ_FEE_FUNDING_VERIFIED } from "@/lib/protocol/chiliz-funding-gate";
import type { RewardChain } from "@/lib/protocol/reward-options";
import { DEFAULT_PROTOCOL_CONTROLS, readExecutionConfig } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";

// Keep public launches locked until the buyback transaction and recovery path
// have passed a funded end-to-end canary. A heartbeat is not proof of safety.
const BUYBACK_EXECUTION_VERIFIED = false;
// A live Solana claim signer is not a reward-acquisition system. Fee SOL must
// first become verified AFC/ARG inventory and fund an epoch automatically.
const SOLANA_REWARD_AUTOMATION_VERIFIED = false;

type ControlsRow = {
  settlement_paused: number;
  rewards_paused: number;
  buyback_paused: number;
};

export async function readLaunchAutomationReadiness(
  database: D1Database,
  rewardChain: RewardChain,
  buybackTreasury: string | null,
  rewardTreasury: string | null,
): Promise<LaunchAutomationReadiness> {
  const [heartbeats, controlsRow, sportpadMintRow, ...maintenanceRuns] = await Promise.all([
    database.prepare(`
      SELECT key, value, updated_at FROM service_cursors WHERE key LIKE 'automation:%'
    `).all<AutomationHeartbeat>(),
    database.prepare(`
      SELECT settlement_paused, rewards_paused, buyback_paused
      FROM protocol_controls WHERE key = 'global' LIMIT 1
    `).first<ControlsRow>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
    ...["pump_fee_indexer", "holder_epoch_indexer", "treasury_observer"].map((worker) =>
      database.prepare(`
        SELECT worker, state, started_at, completed_at FROM worker_runs
        WHERE worker = ?1 AND "trigger" = 'internal'
        ORDER BY started_at DESC, rowid DESC LIMIT 1
      `).bind(worker).first<MaintenanceRun>()
    ),
  ]);
  const controls = controlsRow ? {
    ...DEFAULT_PROTOCOL_CONTROLS,
    settlementPaused: Boolean(controlsRow.settlement_paused),
    rewardsPaused: Boolean(controlsRow.rewards_paused),
    buybackPaused: Boolean(controlsRow.buyback_paused),
  } : DEFAULT_PROTOCOL_CONTROLS;
  const execution = readExecutionConfig(controls);
  const registeredMint = sportpadMintRow?.value?.trim() || null;
  const configuredMint = execution.mainnet.sportpadMint;
  // Before SPORTPAD exists, Pump's 20% leg can accumulate in its dedicated
  // treasury. Buyback execution becomes mandatory once a mint is registered.
  const requireBuybackExecution = Boolean(registeredMint || configuredMint);
  const workers = evaluateLaunchAutomationReadiness(
    heartbeats.results,
    maintenanceRuns.filter((run): run is MaintenanceRun => Boolean(run)),
    rewardChain,
    buybackTreasury,
    rewardTreasury,
    Date.now(),
    requireBuybackExecution,
  );
  const missing = [...workers.missing];
  if (registeredMint && configuredMint && registeredMint !== configuredMint) {
    missing.push("SPORTPAD mint configuration mismatch");
  }
  if (!execution.workerTokenConfigured) missing.push("worker authentication");
  if (!execution.flags.feeIndexerEnabled || !execution.flags.holderIndexerEnabled) missing.push("fee and holder indexing");
  if (!AUTOMATED_PUMP_FEE_COLLECTION_VERIFIED) missing.push("unattended Pump fee collection not verified");
  if (!execution.flags.settlementEnabled || controls.settlementPaused) missing.push("settlement execution");
  if (!execution.flags.rewardsEnabled || !execution.flags.claimsEnabled || controls.rewardsPaused) missing.push("reward and claim execution");
  if (requireBuybackExecution && (!execution.flags.buybackEnabled || controls.buybackPaused)) {
    missing.push("buyback execution");
  }
  if (!FINANCIAL_LEDGER_VERIFIED) missing.push("financial ledger and receipt verification");
  if (rewardChain === "chiliz" && !CHILIZ_ASSET_MIGRATION_VERIFIED) {
    missing.push("Chiliz V2 acquisition and payout execution not verified");
  }
  if (rewardChain === "chiliz" && !CHILIZ_FEE_FUNDING_VERIFIED) {
    missing.push("80% fee SOL to Chiliz CHZ funding not verified");
  }
  if (rewardChain === "solana" && !SOLANA_REWARD_AUTOMATION_VERIFIED) {
    missing.push("Solana Fan Token acquisition and epoch automation not verified");
  }
  if (requireBuybackExecution && !BUYBACK_EXECUTION_VERIFIED) missing.push("buyback safety verification");
  return { ready: missing.length === 0, missing };
}

export async function readGlobalLaunchReadiness(): Promise<LaunchAutomationReadiness> {
  const config = readMainnetConfig();
  if (!env.DB) return { ready: false, missing: [...config.missing, "automation status unavailable"] };
  try {
    const [chiliz, solana] = await Promise.all([
      readLaunchAutomationReadiness(env.DB, "chiliz", config.buybackTreasury, config.rewardTreasury),
      readLaunchAutomationReadiness(env.DB, "solana", config.buybackTreasury, config.rewardTreasury),
    ]);
    // A launch selects one reward chain. The global status is ready when at
    // least one chain can serve new launches; each draft still checks its own
    // selected chain before preparing a mainnet transaction.
    const chainReady = chiliz.ready || solana.ready;
    const missing = [...new Set([
      ...config.missing,
      ...(chainReady ? [] : [...chiliz.missing, ...solana.missing]),
    ])];
    return { ready: config.ready && chainReady, missing };
  } catch {
    return { ready: false, missing: [...config.missing, "automation status unavailable"] };
  }
}
