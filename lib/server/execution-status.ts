import "server-only";

import { env } from "cloudflare:workers";
import { FINANCIAL_LEDGER_VERIFIED } from "@/lib/protocol/automation-safety";
import { CHILIZ_ASSET_MIGRATION_VERIFIED } from "@/lib/protocol/chiliz-receipts";

import {
  DEFAULT_PROTOCOL_CONTROLS,
  readExecutionConfig,
  type ProtocolControls,
} from "@/lib/server/execution-config";
import { readGlobalLaunchReadiness } from "@/lib/server/launch-automation-readiness";

type CountRow = { count: number };
type ControlRow = {
  settlement_paused: number;
  rewards_paused: number;
  buyback_paused: number;
  pause_reason: string;
  revision: number;
  updated_at: string;
};
type ObservationRow = {
  purpose: string;
  address: string;
  balance_lamports: string;
  slot: number;
  observed_at: string;
};
type WorkerRunRow = {
  worker: string;
  state: string;
  items_seen: number;
  items_changed: number;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
};
type AutomationHeartbeatRow = { key: string; value: string; updated_at: string };
type ProtocolSettingRow = { value: string };
type FeeLaunchRow = {
  id: string;
  name: string;
  symbol: string;
  mainnet_mint: string;
  reward_symbol: string;
  mainnet_reward_treasury: string;
  mainnet_buyback_treasury: string;
};

function controlsFromRow(row: ControlRow | null): ProtocolControls {
  if (!row) return DEFAULT_PROTOCOL_CONTROLS;
  return {
    settlementPaused: Boolean(row.settlement_paused),
    rewardsPaused: Boolean(row.rewards_paused),
    buybackPaused: Boolean(row.buyback_paused),
    pauseReason: row.pause_reason,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export async function getExecutionStatus() {
  if (!env.DB) throw new Error("D1 binding `DB` is unavailable.");
  const results = await env.DB.batch([
    env.DB.prepare("SELECT settlement_paused, rewards_paused, buyback_paused, pause_reason, revision, updated_at FROM protocol_controls WHERE key = 'global' LIMIT 1"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM fee_events"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM settlements"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM reward_epochs"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM reward_claims WHERE state = 'confirmed'"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM protocol_events"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM reward_vaults"),
    env.DB.prepare("SELECT purpose, address, balance_lamports, slot, observed_at FROM treasury_observations WHERE id IN (SELECT id FROM treasury_observations AS latest WHERE latest.purpose = treasury_observations.purpose ORDER BY latest.slot DESC LIMIT 1) ORDER BY purpose"),
    env.DB.prepare("SELECT worker, state, items_seen, items_changed, error_code, started_at, completed_at FROM worker_runs ORDER BY started_at DESC LIMIT 10"),
    env.DB.prepare(`
      SELECT id, name, symbol, mainnet_mint, reward_symbol, mainnet_reward_treasury, mainnet_buyback_treasury
      FROM launch_drafts
      WHERE status = 'mainnet_published'
        AND mainnet_mint IS NOT NULL
        AND mainnet_reward_treasury IS NOT NULL
        AND mainnet_buyback_treasury IS NOT NULL
      ORDER BY mainnet_verified_at DESC
      LIMIT 50
    `),
    env.DB.prepare("SELECT COUNT(*) AS count FROM protocol_events WHERE event_type = 'reward_swap_submitted'"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM protocol_events WHERE event_type = 'buyback_swap_submitted'"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM protocol_events WHERE event_type = 'sportpad_burn_submitted'"),
    env.DB.prepare("SELECT key, value, updated_at FROM service_cursors WHERE key LIKE 'automation:%' ORDER BY updated_at DESC"),
    env.DB.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint' LIMIT 1"),
  ]);
  const controls = controlsFromRow((results[0].results[0] as ControlRow | undefined) ?? null);
  const execution = readExecutionConfig(controls);
  const count = (index: number) => Number((results[index].results[0] as CountRow | undefined)?.count ?? 0);
  const observations = (results[7].results as ObservationRow[]).map((row) => ({
    purpose: row.purpose,
    address: row.address,
    balanceLamports: row.balance_lamports,
    slot: row.slot,
    observedAt: row.observed_at,
  }));
  const workerRuns = (results[8].results as WorkerRunRow[]).map((row) => ({
    worker: row.worker,
    state: row.state,
    itemsSeen: row.items_seen,
    itemsChanged: row.items_changed,
    errorCode: row.error_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));
  const feeLaunches = (results[9].results as FeeLaunchRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    mint: row.mainnet_mint,
    rewardSymbol: row.reward_symbol,
    rewardTreasury: row.mainnet_reward_treasury,
    buybackTreasury: row.mainnet_buyback_treasury,
  }));
  const walletExecutionEnabled = FINANCIAL_LEDGER_VERIFIED
    && !controls.settlementPaused && !controls.rewardsPaused && !controls.buybackPaused;
  const heartbeats = results[13].results as AutomationHeartbeatRow[];
  const activeCutoff = Date.now() - 2 * 60 * 1_000;
  const automationWorkers = heartbeats.map((row) => {
    const timestamp = Date.parse(`${row.updated_at.replace(" ", "T")}Z`);
    return {
      id: row.key.slice("automation:".length),
      updatedAt: row.updated_at,
      active: Number.isFinite(timestamp) && timestamp >= activeCutoff,
    };
  });
  const chilizActive = automationWorkers.some((worker) => worker.active && worker.id.startsWith("chiliz:"));
  const solanaActive = automationWorkers.some((worker) => worker.active && worker.id.startsWith("solana:"));
  const sportpadSetting = results[14].results[0] as ProtocolSettingRow | undefined;
  const without = (lane: { ready: boolean; missing: string[] }, removable: string[]) => {
    const missing = lane.missing.filter((item) => !removable.includes(item));
    return { ready: missing.length === 0, missing };
  };
  const automatedRewardWorkersActive = chilizActive && solanaActive;
  const configuredReadiness = {
    settlement: (chilizActive || solanaActive)
      ? without(execution.readiness.settlement, ["fee collector signer"])
      : execution.readiness.settlement,
    rewards: automatedRewardWorkersActive
      ? without(execution.readiness.rewards, ["reward vault signer"])
      : execution.readiness.rewards,
    claims: automatedRewardWorkersActive
      ? without(execution.readiness.claims, ["reward vault signer"])
      : execution.readiness.claims,
    buyback: solanaActive
      ? without(execution.readiness.buyback, ["buyback signer", ...(sportpadSetting?.value ? ["SPORTPAD mint"] : [])])
      : execution.readiness.buyback,
  };
  const withStaticHolds = (lane: { ready: boolean; missing: string[] }, chilizRequired = false) => {
    const missing = [
      ...lane.missing,
      ...(!FINANCIAL_LEDGER_VERIFIED ? ["financial-ledger verification"] : []),
      ...(chilizRequired && !CHILIZ_ASSET_MIGRATION_VERIFIED ? ["Chiliz V2 execution verification"] : []),
    ];
    return { ready: lane.ready && missing.length === 0, missing };
  };
  const readiness = {
    settlement: withStaticHolds(configuredReadiness.settlement),
    rewards: withStaticHolds(configuredReadiness.rewards, true),
    claims: withStaticHolds(configuredReadiness.claims, true),
    buyback: withStaticHolds(configuredReadiness.buyback),
  };
  const launchReadiness = await readGlobalLaunchReadiness();
  // Launch readiness evaluates the selected reward chains and the pre-mint
  // 20% accrual phase. The summary mode must not require both reward chains
  // and an unavailable SPORTPAD mint when one eligible lane is ready.
  const managedExecutionReady = FINANCIAL_LEDGER_VERIFIED && launchReadiness.ready;

  return {
    version: 1,
    mode: managedExecutionReady ? "execution_ready" : walletExecutionEnabled ? "wallet_confirmed" : "execution_locked",
    controls,
    readiness,
    capabilities: {
      treasuryObserver: Boolean(execution.mainnet.rewardTreasury && execution.mainnet.buybackTreasury),
      finalizedPumpFeeIndexer: execution.flags.feeIndexerEnabled,
      holderIndexerEnabled: execution.flags.holderIndexerEnabled,
      signerProviderConfigured: execution.signerProviderConfigured,
      workerAuthenticationConfigured: execution.workerTokenConfigured,
      walletExecutionEnabled,
      unattendedAutomation: FINANCIAL_LEDGER_VERIFIED && (chilizActive || solanaActive),
    },
    automation: { workers: automationWorkers, chilizActive, solanaActive },
    launchReadiness,
    protocolSettings: { sportpadMint: sportpadSetting?.value ?? execution.mainnet.sportpadMint },
    treasuries: {
      reward: execution.mainnet.rewardTreasury,
      buyback: execution.mainnet.buybackTreasury,
      observations,
    },
    counts: {
      feeEvents: count(1),
      settlements: count(2),
      rewardEpochs: count(3),
      confirmedClaims: count(4),
      protocolEvents: count(5),
      rewardVaults: count(6),
      rewardSwaps: count(10),
      buybackSwaps: count(11),
      sportpadBurns: count(12),
    },
    workerRuns,
    feeLaunches,
  };
}
