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
