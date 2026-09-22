import { splitCreatorFee } from "./accounting.ts";

export const SETTLEMENT_STATES = [
  "observed",
  "reconciled",
  "reward_swap_planned",
  "reward_swap_submitted",
  "reward_swap_finalized",
  "buyback_planned",
  "buyback_submitted",
  "buyback_finalized",
  "burn_planned",
  "burn_submitted",
  "complete",
  "failed",
] as const;

export type SettlementState = typeof SETTLEMENT_STATES[number];

const ALLOWED_TRANSITIONS: Record<SettlementState, readonly SettlementState[]> = {
  observed: ["reconciled", "failed"],
  reconciled: ["reward_swap_planned", "failed"],
  reward_swap_planned: ["reward_swap_submitted", "failed"],
  reward_swap_submitted: ["reward_swap_finalized", "failed"],
  reward_swap_finalized: ["buyback_planned", "failed"],
  buyback_planned: ["buyback_submitted", "failed"],
  buyback_submitted: ["buyback_finalized", "failed"],
  buyback_finalized: ["burn_planned", "failed"],
  burn_planned: ["burn_submitted", "failed"],
  burn_submitted: ["complete", "failed"],
  complete: [],
  failed: [],
};

export type ExecutionReadinessInput = {
  globalEnabled: boolean;
  settlementEnabled: boolean;
  rewardsEnabled: boolean;
  buybackEnabled: boolean;
  claimsEnabled: boolean;
  workerTokenConfigured: boolean;
  feeCollectorSignerConfigured: boolean;
  rewardVaultSignerConfigured: boolean;
  buybackSignerConfigured: boolean;
  sportpadMintConfigured: boolean;
  settlementPaused: boolean;
  rewardsPaused: boolean;
  buybackPaused: boolean;
};

export function parseAtomicAmount(value: string, field = "amount") {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${field} must be a non-negative integer string`);
  }
  return BigInt(value);
}

export function assertSettlementTransition(from: SettlementState, to: SettlementState) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid settlement transition: ${from} -> ${to}`);
  }
}

export function createSettlementPlan({
  feeEventId,
  grossAmountAtomic,
}: {
  feeEventId: string;
  grossAmountAtomic: string;
}) {
  const normalizedFeeEventId = feeEventId.trim();
  if (!normalizedFeeEventId) throw new TypeError("feeEventId is required");
  const gross = parseAtomicAmount(grossAmountAtomic, "grossAmountAtomic");
  const { rewardAtomic, buybackAtomic } = splitCreatorFee(gross);
  return {
    idempotencyKey: `settlement:${normalizedFeeEventId}`,
    feeEventId: normalizedFeeEventId,
    grossAmountAtomic: gross.toString(),
    rewardAmountAtomic: rewardAtomic.toString(),
    buybackAmountAtomic: buybackAtomic.toString(),
  };
}

export function deriveExecutionReadiness(input: ExecutionReadinessInput) {
  const sharedMissing: string[] = [];
  if (!input.globalEnabled) sharedMissing.push("mainnet execution approval");
  if (!input.workerTokenConfigured) sharedMissing.push("worker authentication token");

  const settlementMissing = [...sharedMissing];
  if (!input.settlementEnabled) settlementMissing.push("settlement worker approval");
  if (!input.feeCollectorSignerConfigured) settlementMissing.push("fee collector signer");
  if (input.settlementPaused) settlementMissing.push("settlement pause lifted");

  const rewardsMissing = [...sharedMissing];
  if (!input.rewardsEnabled) rewardsMissing.push("reward worker approval");
  if (!input.rewardVaultSignerConfigured) rewardsMissing.push("reward vault signer");
  if (input.rewardsPaused) rewardsMissing.push("reward pause lifted");

  const buybackMissing = [...sharedMissing];
  if (!input.buybackEnabled) buybackMissing.push("buyback worker approval");
  if (!input.buybackSignerConfigured) buybackMissing.push("buyback signer");
  if (!input.sportpadMintConfigured) buybackMissing.push("SPORTPAD mint");
  if (input.buybackPaused) buybackMissing.push("buyback pause lifted");

  const claimsMissing = [...rewardsMissing];
  if (!input.claimsEnabled) claimsMissing.push("claim worker approval");

  return {
    settlement: { ready: settlementMissing.length === 0, missing: settlementMissing },
    rewards: { ready: rewardsMissing.length === 0, missing: rewardsMissing },
    buyback: { ready: buybackMissing.length === 0, missing: buybackMissing },
    claims: { ready: claimsMissing.length === 0, missing: claimsMissing },
  };
}
