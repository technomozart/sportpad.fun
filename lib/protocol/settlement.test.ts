import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSettlementTransition,
  createSettlementPlan,
  deriveExecutionReadiness,
  parseAtomicAmount,
} from "./settlement.ts";

test("settlement plan conserves every atomic unit and is replay stable", () => {
  const first = createSettlementPlan({ feeEventId: "signature:0", grossAmountAtomic: "101" });
  const replay = createSettlementPlan({ feeEventId: " signature:0 ", grossAmountAtomic: "101" });
  assert.equal(BigInt(first.rewardAmountAtomic) + BigInt(first.buybackAmountAtomic), 101n);
  assert.equal(first.rewardAmountAtomic, "80");
  assert.equal(first.buybackAmountAtomic, "21");
  assert.equal(first.idempotencyKey, replay.idempotencyKey);
});

test("atomic amount parser rejects fractions, signs, and unsafe formats", () => {
  assert.equal(parseAtomicAmount("900719925474099300000"), 900719925474099300000n);
  for (const value of ["-1", "+1", "1.1", "01", "", "1e3"]) {
    assert.throws(() => parseAtomicAmount(value));
  }
});

test("settlement state machine accepts only explicit forward transitions", () => {
  assert.doesNotThrow(() => assertSettlementTransition("observed", "reconciled"));
  assert.doesNotThrow(() => assertSettlementTransition("burn_submitted", "complete"));
  assert.throws(() => assertSettlementTransition("observed", "complete"));
  assert.throws(() => assertSettlementTransition("complete", "observed"));
});

test("execution readiness fails closed without approvals, signers, and worker auth", () => {
  const readiness = deriveExecutionReadiness({
    globalEnabled: false,
    settlementEnabled: false,
    rewardsEnabled: false,
    buybackEnabled: false,
    claimsEnabled: false,
    workerTokenConfigured: false,
    feeCollectorSignerConfigured: false,
    rewardVaultSignerConfigured: false,
    buybackSignerConfigured: false,
    sportpadMintConfigured: false,
    settlementPaused: true,
    rewardsPaused: true,
    buybackPaused: true,
  });
  assert.equal(readiness.settlement.ready, false);
  assert.equal(readiness.rewards.ready, false);
  assert.equal(readiness.buyback.ready, false);
  assert.equal(readiness.claims.ready, false);
  assert.ok(readiness.buyback.missing.includes("SPORTPAD mint"));
});

test("every lane becomes ready only when all of its controls are satisfied", () => {
  const readiness = deriveExecutionReadiness({
    globalEnabled: true,
    settlementEnabled: true,
    rewardsEnabled: true,
    buybackEnabled: true,
    claimsEnabled: true,
    workerTokenConfigured: true,
    feeCollectorSignerConfigured: true,
    rewardVaultSignerConfigured: true,
    buybackSignerConfigured: true,
    sportpadMintConfigured: true,
    settlementPaused: false,
    rewardsPaused: false,
    buybackPaused: false,
  });
  assert.equal(readiness.settlement.ready, true);
  assert.equal(readiness.rewards.ready, true);
  assert.equal(readiness.buyback.ready, true);
  assert.equal(readiness.claims.ready, true);
});
