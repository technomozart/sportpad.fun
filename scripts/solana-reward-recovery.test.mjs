import assert from "node:assert/strict";
import test from "node:test";

import { reconcileRewardPurchases, rewardWorkerJobTypes } from "./solana-reward-recovery.mjs";

test("disabled reward purchase never queries recovery or leases purchase jobs", async () => {
  const recovery = await reconcileRewardPurchases(() => {
    throw new Error("unexpected API request");
  }, "solana:reward-treasury", false);
  assert.deepEqual(recovery, { reconciled: false, pending: false });
  assert.deepEqual(rewardWorkerJobTypes(false, recovery), ["solana_claim_payout"]);
});

test("ambiguous persisted swap prevents another purchase but permits claim payouts", async () => {
  const requests = [];
  const recovery = await reconcileRewardPurchases(async (request) => {
    requests.push(request);
    return { reconciled: false, pending: true };
  }, "solana:reward-treasury", true);
  assert.deepEqual(requests, [{ action: "reconcile", workerId: "solana:reward-treasury" }]);
  assert.deepEqual(rewardWorkerJobTypes(true, recovery), ["solana_claim_payout"]);
});

test("a confirmed recovery is reported before leasing a fresh purchase", async () => {
  const recovery = await reconcileRewardPurchases(async () => (
    { reconciled: true, pending: false }
  ), "solana:reward-treasury", true);
  assert.deepEqual(recovery, { reconciled: true, pending: false });
  assert.deepEqual(rewardWorkerJobTypes(true, recovery),
    ["solana_reward_purchase", "solana_claim_payout"]);
});

test("malformed recovery response fails closed", async () => {
  await assert.rejects(
    reconcileRewardPurchases(async () => ({ reconciled: false }), "solana:reward-treasury", true),
    /reward_reconciliation_unverified/,
  );
});

test("a persisted reward order replays only through the supplied exact-order callback", async () => {
  const prepared = { jobId: "job-1", signature: "original-signature",
    unsignedTransactionBase64: "original-order", lastValidBlockHeight: 123 };
  const replayed = [];
  const recovery = await reconcileRewardPurchases(async () => (
    { reconciled: false, pending: true, prepared }
  ), "solana:reward-treasury", true, async (order) => replayed.push(order));
  assert.deepEqual(replayed, [prepared]);
  assert.deepEqual(recovery, { reconciled: true, pending: true });
  assert.deepEqual(rewardWorkerJobTypes(true, recovery), ["solana_claim_payout"]);
});

test("a malformed or failing replay never opens another purchase lease", async () => {
  await assert.rejects(reconcileRewardPurchases(async () => (
    { reconciled: false, pending: true, prepared: { signature: "missing-fields" } }
  ), "solana:reward-treasury", true, async () => {}), /reward_replay_payload_invalid/);
  await assert.rejects(reconcileRewardPurchases(async () => (
    { reconciled: false, pending: true, prepared: { jobId: "job-1", signature: "sig",
      unsignedTransactionBase64: "order", lastValidBlockHeight: 123 } }
  ), "solana:reward-treasury", true, async () => {
    throw new Error("broadcast_unknown");
  }), /broadcast_unknown/);
});

test("a proven-expired reward order requires an explicit replacement callback", async () => {
  const orderRequired = { jobId: "job-1", entityId: "step-1",
    payload: { rewardAmountLamports: "1000000" }, replacesSwapSignature: "A".repeat(64) };
  await assert.rejects(reconcileRewardPurchases(async () => ({
    reconciled: false, pending: true, orderRequired,
  }), "solana:reward-treasury", true, async () => {}), /reward_replacement_payload_invalid/);
  const replaced = [];
  const recovery = await reconcileRewardPurchases(async () => ({
    reconciled: false, pending: true, orderRequired,
  }), "solana:reward-treasury", true, async () => {},
  async (stage) => replaced.push(stage));
  assert.deepEqual(replaced, [orderRequired]);
  assert.deepEqual(recovery, { reconciled: true, pending: true });
});
