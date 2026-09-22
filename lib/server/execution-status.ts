import "server-only";

import { env } from "cloudflare:workers";

import {
  DEFAULT_PROTOCOL_CONTROLS,
  readExecutionConfig,
  type ProtocolControls,
} from "@/lib/server/execution-config";

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

  return {
    version: 1,
    mode: Object.values(execution.readiness).every((lane) => lane.ready) ? "execution_ready" : "execution_locked",
    controls,
    readiness: execution.readiness,
    capabilities: {
      treasuryObserver: Boolean(execution.mainnet.rewardTreasury && execution.mainnet.buybackTreasury),
      finalizedPumpFeeIndexer: execution.flags.feeIndexerEnabled,
      holderIndexerEnabled: execution.flags.holderIndexerEnabled,
      signerProviderConfigured: execution.signerProviderConfigured,
      workerAuthenticationConfigured: execution.workerTokenConfigured,
    },
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
    },
    workerRuns,
  };
}
