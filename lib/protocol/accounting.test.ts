import assert from "node:assert/strict";
import test from "node:test";

import { allocateEpochRewards, feeEventId, splitCreatorFee } from "./accounting.ts";

test("fee split is exact and assigns integer dust to buyback", () => {
  assert.deepEqual(splitCreatorFee(101n), { rewardAtomic: 80n, buybackAtomic: 21n });
  const split = splitCreatorFee(9_007_199_254_740_993n);
  assert.equal(split.rewardAtomic + split.buybackAtomic, 9_007_199_254_740_993n);
});

test("epoch allocation is proportional and conserves funded inventory", () => {
  const result = allocateEpochRewards(100n, [
    { wallet: "alice", tokenSeconds: 3n },
    { wallet: "bob", tokenSeconds: 1n },
  ]);
  assert.deepEqual(result.allocations.map((entry) => entry.rewardAtomic), [75n, 25n]);
  assert.equal(result.dustAtomic, 0n);
});

test("epoch allocation carries rounding dust forward", () => {
  const result = allocateEpochRewards(10n, [
    { wallet: "alice", tokenSeconds: 1n },
    { wallet: "bob", tokenSeconds: 1n },
    { wallet: "carol", tokenSeconds: 1n },
  ]);
  assert.equal(result.allocations.reduce((sum, entry) => sum + entry.rewardAtomic, 0n), 9n);
  assert.equal(result.dustAtomic, 1n);
});

test("fee event IDs are deterministic for replay-safe ingestion", () => {
  assert.equal(feeEventId("5ig", 2), "5ig:2");
  assert.equal(feeEventId(" 5ig ", 2), "5ig:2");
});
