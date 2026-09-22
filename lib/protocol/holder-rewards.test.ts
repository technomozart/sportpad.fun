import assert from "node:assert/strict";
import test from "node:test";

import {
  accrueHolderPosition,
  canonicalHolderSnapshot,
  canonicalRewardAllocation,
} from "./holder-rewards.ts";

test("a new position starts measuring at the first finalized observation", () => {
  assert.deepEqual(accrueHolderPosition({
    previous: null,
    nextBalanceAtomic: 25n,
    observedAt: 110,
    startsAt: 100,
    endsAt: 200,
  }), {
    tokenSecondsAtomic: 0n,
    endingBalanceAtomic: 25n,
    lastObservedAt: 110,
  });
});

test("a later observation accrues the previous balance for the exact interval", () => {
  assert.deepEqual(accrueHolderPosition({
    previous: { tokenSecondsAtomic: 75n, endingBalanceAtomic: 25n, lastObservedAt: 110 },
    nextBalanceAtomic: 10n,
    observedAt: 130,
    startsAt: 100,
    endsAt: 200,
  }), {
    tokenSecondsAtomic: 575n,
    endingBalanceAtomic: 10n,
    lastObservedAt: 130,
  });
});

test("accrual is capped at the epoch boundary and never moves backwards", () => {
  const previous = { tokenSecondsAtomic: 7n, endingBalanceAtomic: 3n, lastObservedAt: 190 };
  assert.deepEqual(accrueHolderPosition({ previous, nextBalanceAtomic: 0n, observedAt: 250, startsAt: 100, endsAt: 200 }), {
    tokenSecondsAtomic: 37n,
    endingBalanceAtomic: 0n,
    lastObservedAt: 200,
  });
  assert.deepEqual(accrueHolderPosition({ previous, nextBalanceAtomic: 9n, observedAt: 150, startsAt: 100, endsAt: 200 }), {
    tokenSecondsAtomic: 7n,
    endingBalanceAtomic: 9n,
    lastObservedAt: 190,
  });
});

test("snapshot and allocation evidence are order-independent", () => {
  assert.equal(
    canonicalHolderSnapshot([{ wallet: "b", amountAtomic: 2n }, { wallet: "a", amountAtomic: 1n }]),
    "a:1\nb:2",
  );
  assert.equal(
    canonicalRewardAllocation([{ wallet: "b", rewardAtomic: 0n }, { wallet: "a", rewardAtomic: 5n }]),
    "a:5",
  );
});
