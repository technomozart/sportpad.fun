import type { RewardChain } from "./reward-options.ts";

export type AutomationHeartbeat = {
  key: string;
  value: string;
  updated_at: string;
};

export type MaintenanceRun = {
  worker: string;
  state: string;
  started_at: string;
  completed_at: string | null;
};

export type LaunchAutomationReadiness = {
  ready: boolean;
  missing: string[];
};

const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 1_000;

function utcTimestamp(value: string | null): number {
  if (!value) return Number.NaN;
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function freshHeartbeat(row: AutomationHeartbeat, nowMs: number): boolean {
  const observedAt = utcTimestamp(row.updated_at);
  return Number.isFinite(observedAt) && observedAt <= nowMs + 10_000 && nowMs - observedAt <= HEARTBEAT_MAX_AGE_MS;
}

function activeJobTypes(row: AutomationHeartbeat, nowMs: number): Set<string> {
  if (!freshHeartbeat(row, nowMs)) return new Set();
  try {
    const value: unknown = JSON.parse(row.value);
    if (!value || typeof value !== "object" || !("jobTypes" in value) || !Array.isArray(value.jobTypes)) return new Set();
    return new Set(value.jobTypes.filter((jobType): jobType is string => typeof jobType === "string"));
  } catch {
    return new Set();
  }
}

export function evaluateLaunchAutomationReadiness(
  rows: AutomationHeartbeat[],
  maintenanceRuns: MaintenanceRun[],
  rewardChain: RewardChain,
  buybackTreasury: string | null,
  rewardTreasury: string | null,
  nowMs: number = Date.now(),
): LaunchAutomationReadiness {
  const missing: string[] = [];
  const chilizHeartbeat = rows.some((row) =>
    /^automation:chiliz:0x[0-9a-f]{40}$/i.test(row.key) && freshHeartbeat(row, nowMs)
  );
  if (!chilizHeartbeat) missing.push("active maintenance worker");
  for (const requirement of [
    { worker: "pump_fee_indexer", label: "recent successful fee indexing", maxAgeMs: 2 * 60 * 1_000 },
    { worker: "holder_epoch_indexer", label: "recent successful holder indexing", maxAgeMs: 2 * 60 * 1_000 },
    { worker: "treasury_observer", label: "recent successful treasury observation", maxAgeMs: 7 * 60 * 1_000 },
  ]) {
    const latest = maintenanceRuns.filter((run) => run.worker === requirement.worker)
      .sort((a, b) => utcTimestamp(b.started_at) - utcTimestamp(a.started_at))[0];
    const completedAt = utcTimestamp(latest?.completed_at ?? null);
    if (!latest || latest.state !== "succeeded" || !Number.isFinite(completedAt)
      || completedAt > nowMs + 10_000 || nowMs - completedAt > requirement.maxAgeMs) {
      missing.push(requirement.label);
    }
  }
  const buybackHeartbeat = rows.find((row) => row.key === `automation:solana:${buybackTreasury}`);
  const buybackJobs = buybackHeartbeat ? activeJobTypes(buybackHeartbeat, nowMs) : new Set<string>();
  if (!buybackTreasury || !buybackJobs.has("sportpad_buyback_burn")) {
    missing.push("active Solana buyback worker");
  }

  if (rewardChain === "chiliz") {
    const chilizReady = rows.some((row) =>
      /^automation:chiliz:0x[0-9a-f]{40}$/i.test(row.key)
      && ["chiliz_reward_purchase", "chiliz_claim_unwrap"].every((jobType) => activeJobTypes(row, nowMs).has(jobType))
    );
    if (!chilizReady) missing.push("active Chiliz reward and claim worker");
  } else {
    const rewardHeartbeat = rows.find((row) => row.key === `automation:solana:${rewardTreasury}`);
    const rewardJobs = rewardHeartbeat ? activeJobTypes(rewardHeartbeat, nowMs) : new Set<string>();
    if (!rewardTreasury || !rewardJobs.has("solana_reward_purchase")) missing.push("active Solana reward purchase worker");
    if (!rewardTreasury || !rewardJobs.has("solana_claim_payout")) missing.push("active Solana reward payout worker");
  }

  return { ready: missing.length === 0, missing };
}
