/** Query the durable intent ledger before leasing any new reward purchase.
 * A malformed response is treated as unavailable so an ambiguous prior swap
 * cannot be followed by a second automatic spend. */
export async function reconcileRewardPurchases(api, workerId, enabled, replayPrepared,
  replaceExpired) {
  if (!enabled || !workerId) return { reconciled: false, pending: false };
  const result = await api({ action: "reconcile", workerId });
  if (!result || typeof result.reconciled !== "boolean" ||
    typeof result.pending !== "boolean" ||
    (result.prepared && result.orderRequired)) {
    throw new Error("reward_reconciliation_unverified");
  }
  if (result.orderRequired) {
    const stage = result.orderRequired;
    if (!result.pending || typeof replaceExpired !== "function" ||
      typeof stage.jobId !== "string" || typeof stage.entityId !== "string" ||
      !stage.payload || typeof stage.payload !== "object" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(stage.replacesSwapSignature ?? "")) {
      throw new Error("reward_replacement_payload_invalid");
    }
    await replaceExpired(stage);
    return { reconciled: true, pending: true };
  }
  if (result.prepared) {
    if (!result.pending || typeof replayPrepared !== "function" ||
      typeof result.prepared.jobId !== "string" ||
      typeof result.prepared.signature !== "string" ||
      typeof result.prepared.unsignedTransactionBase64 !== "string" ||
      !Number.isSafeInteger(result.prepared.lastValidBlockHeight)) {
      throw new Error("reward_replay_payload_invalid");
    }
    await replayPrepared(result.prepared);
    return { reconciled: true, pending: true };
  }
  return { reconciled: result.reconciled, pending: result.pending };
}

export function rewardWorkerJobTypes(enabled, recovery) {
  return enabled && !recovery.pending
    ? ["solana_reward_purchase", "solana_claim_payout"]
    : ["solana_claim_payout"];
}
