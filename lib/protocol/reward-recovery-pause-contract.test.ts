import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = readFileSync(path.join(process.cwd(), "app", "api", "internal", "workers",
  "automation", "route.ts"), "utf8");

test("pausing reward purchases still permits finalized receipt reconciliation", () => {
  const functionStart = route.indexOf("async function reconcilePreparedSolanaPurchase(");
  const branchStart = route.indexOf("if (!receipt || !status || status.confirmationStatus", functionStart);
  const pauseGate = route.indexOf("if (!mayBroadcast)", branchStart);
  const replayStart = route.indexOf("const idempotencyKey = row.entity_type", branchStart);
  const finalizedCredit = route.indexOf("const output = observedSolanaRewardPurchaseOutput", branchStart);
  assert.ok(functionStart >= 0 && branchStart > functionStart);
  assert.ok(pauseGate > branchStart && pauseGate < replayStart);
  assert.ok(finalizedCredit > replayStart);
  assert.match(route.slice(pauseGate, replayStart), /return \{ reconciled: false \}/);
  assert.doesNotMatch(route.slice(replayStart, finalizedCredit), /if \(!mayBroadcast\)/);
});

test("paused recovery neither requeues nor replaces a reward order", () => {
  const actionStart = route.indexOf('if (input.action === "reconcile")');
  const actionEnd = route.indexOf('if (input.action === "reconcile_claim")', actionStart);
  const action = route.slice(actionStart, actionEnd);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  assert.match(action, /const mayBroadcast = laneAllowsJob\("solana_reward_purchase", controls\)/);
  assert.match(action, /const requeued = mayBroadcast \?/);
  assert.match(action, /for \(const stale of mayBroadcast \? staleBatches\.results : \[\]\)/);
  assert.match(action, /reconcilePreparedSolanaPurchase\(env\.DB, input\.workerId,\s+mayBroadcast\)/);
});

test("pausing buybacks holds new swaps and burns but settles finalized receipts", () => {
  const functionStart = route.indexOf("async function reconcilePreparedBuyback(");
  const functionEnd = route.indexOf("async function reconcilePreparedSolanaPurchase(", functionStart);
  const recovery = route.slice(functionStart, functionEnd);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  assert.equal(recovery.match(/if \(!mayBroadcast\)/g)?.length, 3);
  assert.ok(recovery.indexOf("if (!mayBroadcast)") < recovery.indexOf("swapPrepared:"));
  assert.ok(recovery.lastIndexOf("if (!mayBroadcast)") < recovery.indexOf("burnPrepared:"));
  assert.ok(recovery.indexOf("await completeJob(database, row, workerId, row.burn_signature") <
    recovery.lastIndexOf("if (!mayBroadcast)"));

  const actionStart = route.indexOf('if (input.action === "reconcile_buyback")');
  const actionEnd = route.indexOf('if (input.action === "lease")', actionStart);
  const action = route.slice(actionStart, actionEnd);
  assert.match(action, /const mayBroadcast = laneAllowsJob\("sportpad_buyback_burn", controls\)/);
  assert.match(action, /const requeued = mayBroadcast \?/);
  assert.match(action, /reconcilePreparedBuyback\(env\.DB, input\.workerId, mayBroadcast\)/);
});
