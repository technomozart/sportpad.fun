/** Query the durable intent ledger before leasing any new reward purchase.
 * A malformed response is treated as unavailable so an ambiguous prior swap
 * cannot be followed by a second automatic spend. */
export async function reconcileRewardPurchases(api, workerId, enabled) {
  if (!enabled || !workerId) return { reconciled: false, pending: false };
  const result = await api({ action: "reconcile", workerId });
  if (!result || typeof result.reconciled !== "boolean" ||
    typeof result.pending !== "boolean") {
    throw new Error("reward_reconciliation_unverified");
  }
  return { reconciled: result.reconciled, pending: result.pending };
}

export function rewardWorkerJobTypes(enabled, recovery) {
  return enabled && !recovery.pending
    ? ["solana_reward_purchase", "solana_claim_payout"]
    : ["solana_claim_payout"];
}
