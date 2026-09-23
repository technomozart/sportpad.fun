import type { AutomationHeartbeat } from "./launch-automation-gate.ts";

export type ClaimLaneReadiness = { ready: boolean; missing: string[] };
export type ClaimReadinessByChain = { solana: ClaimLaneReadiness; chiliz: ClaimLaneReadiness };

const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 1_000;

function hasFreshJob(
  rows: AutomationHeartbeat[],
  workerKey: string | null,
  jobType: string,
  nowMs: number,
): boolean {
  if (!workerKey) return false;
  return rows.some((row) => {
    if (row.key.toLowerCase() !== workerKey.toLowerCase()) return false;
    const observedAt = Date.parse(`${row.updated_at.replace(" ", "T")}Z`);
    if (!Number.isFinite(observedAt) || observedAt > nowMs + 10_000 || nowMs - observedAt > HEARTBEAT_MAX_AGE_MS) {
      return false;
    }
    try {
      const value: unknown = JSON.parse(row.value);
      return Boolean(value && typeof value === "object" && "jobTypes" in value
        && Array.isArray(value.jobTypes) && value.jobTypes.includes(jobType));
    } catch {
      return false;
    }
  });
}

export function evaluateClaimReadinessByChain(input: {
  configuredClaims: ClaimLaneReadiness;
  heartbeats: AutomationHeartbeat[];
  solanaRewardTreasury: string | null;
  chilizTreasury: string | null;
  financialLedgerVerified: boolean;
  solanaPayoutVerified: boolean;
  chilizMigrationVerified: boolean;
  nowMs?: number;
}): ClaimReadinessByChain {
  const nowMs = input.nowMs ?? Date.now();
  // The old generic signer setting is replaced by an exact, live chain worker
  // capability. Everything else in the configured claim lane remains required.
  const configuredMissing = input.configuredClaims.missing.filter((item) => item !== "reward vault signer");
  const solanaMissing = [...configuredMissing];
  if (!input.solanaRewardTreasury || !hasFreshJob(input.heartbeats,
    `automation:solana:${input.solanaRewardTreasury}`, "solana_claim_payout", nowMs)) {
    solanaMissing.push("active Solana reward payout worker");
  }
  if (!input.financialLedgerVerified) solanaMissing.push("financial-ledger verification");
  if (!input.solanaPayoutVerified) solanaMissing.push("Solana claim payout canary verification");

  const chilizMissing = [...configuredMissing];
  const validChilizTreasury = input.chilizTreasury && /^0x[0-9a-f]{40}$/i.test(input.chilizTreasury)
    ? input.chilizTreasury : null;
  if (!validChilizTreasury || !hasFreshJob(input.heartbeats,
    `automation:chiliz:${validChilizTreasury}`, "chiliz_claim_unwrap", nowMs)) {
    chilizMissing.push("active Chiliz reward claim worker");
  }
  if (!input.financialLedgerVerified) chilizMissing.push("financial-ledger verification");
  if (!input.chilizMigrationVerified) chilizMissing.push("Chiliz V2 execution verification");

  return {
    solana: { ready: solanaMissing.length === 0, missing: solanaMissing },
    chiliz: { ready: chilizMissing.length === 0, missing: chilizMissing },
  };
}
