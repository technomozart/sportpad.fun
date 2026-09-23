import "server-only";

import { env } from "cloudflare:workers";

import {
  evaluateLaunchAutomationReadiness,
  type AutomationHeartbeat,
  type LaunchAutomationReadiness,
  type MaintenanceRun,
} from "@/lib/protocol/launch-automation-gate";
import { FINANCIAL_LEDGER_VERIFIED } from "@/lib/protocol/automation-safety";
import { CHILIZ_ASSET_MIGRATION_VERIFIED } from "@/lib/protocol/chiliz-receipts";
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
): Promise<LaunchAutomationReadiness> {
  const [heartbeats, controlsRow, ...maintenanceRuns] = await Promise.all([
    database.prepare(`
      SELECT key, value, updated_at FROM service_cursors WHERE key LIKE 'automation:%'
    `).all<AutomationHeartbeat>(),
    database.prepare(`
      SELECT settlement_paused, rewards_paused, buyback_paused
      FROM protocol_controls WHERE key = 'global' LIMIT 1
    `).first<ControlsRow>(),
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
  const workers = evaluateLaunchAutomationReadiness(
    heartbeats.results,
    maintenanceRuns.filter((run): run is MaintenanceRun => Boolean(run)),
    rewardChain,
    buybackTreasury,
  );
  const missing = [...workers.missing];
  if (!execution.workerTokenConfigured) missing.push("worker authentication");
  if (!execution.flags.feeIndexerEnabled || !execution.flags.holderIndexerEnabled) missing.push("fee and holder indexing");
  if (!execution.flags.settlementEnabled || controls.settlementPaused) missing.push("settlement execution");
  if (!execution.flags.rewardsEnabled || !execution.flags.claimsEnabled || controls.rewardsPaused) missing.push("reward and claim execution");
  if (!execution.flags.buybackEnabled || controls.buybackPaused) missing.push("buyback execution");
  if (!FINANCIAL_LEDGER_VERIFIED) missing.push("financial ledger and receipt verification");
  if (rewardChain === "chiliz" && !CHILIZ_ASSET_MIGRATION_VERIFIED) {
    missing.push("Chiliz V2 acquisition and payout execution not verified");
  }
  if (rewardChain === "solana" && !SOLANA_REWARD_AUTOMATION_VERIFIED) {
    missing.push("Solana Fan Token acquisition and epoch automation not verified");
  }
  if (!BUYBACK_EXECUTION_VERIFIED) missing.push("buyback safety verification");
  return { ready: missing.length === 0, missing };
}

export async function readGlobalLaunchReadiness(): Promise<LaunchAutomationReadiness> {
  const config = readMainnetConfig();
  if (!env.DB) return { ready: false, missing: [...config.missing, "automation status unavailable"] };
  try {
    const [chiliz, solana] = await Promise.all([
      readLaunchAutomationReadiness(env.DB, "chiliz", config.buybackTreasury),
      readLaunchAutomationReadiness(env.DB, "solana", config.buybackTreasury),
    ]);
    const missing = [...new Set([...config.missing, ...chiliz.missing, ...solana.missing])];
    return { ready: missing.length === 0, missing };
  } catch {
    return { ready: false, missing: [...config.missing, "automation status unavailable"] };
  }
}
