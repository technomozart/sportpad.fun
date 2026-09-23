import assert from "node:assert/strict";
import test from "node:test";

import { finalizedHolderBaselineWindow } from "./holder-epoch-baseline.ts";

test("an on-time finalized opening snapshot keeps the planned epoch window", () => {
  assert.deepEqual(finalizedHolderBaselineWindow({
    startsAt: 100, endsAt: 200, firstFinalizedAt: 95, hasCheckpoint: false,
  }), { startsAt: 100, endsAt: 200, shiftSeconds: 0 });
});

test("a late first finalized snapshot moves both boundaries and keeps the full duration", () => {
  assert.deepEqual(finalizedHolderBaselineWindow({
    startsAt: 100, endsAt: 200, firstFinalizedAt: 245, hasCheckpoint: false,
  }), { startsAt: 245, endsAt: 345, shiftSeconds: 145 });
});

test("subsequent finalized snapshots never move an established epoch window", () => {
  assert.deepEqual(finalizedHolderBaselineWindow({
    startsAt: 100, endsAt: 200, firstFinalizedAt: 250, hasCheckpoint: true,
  }), { startsAt: 100, endsAt: 200, shiftSeconds: 0 });
});

test("invalid or overflowing epoch boundaries fail closed", () => {
  assert.throws(() => finalizedHolderBaselineWindow({
    startsAt: 200, endsAt: 100, firstFinalizedAt: 250, hasCheckpoint: false,
  }), /Invalid/);
  assert.throws(() => finalizedHolderBaselineWindow({
    startsAt: 1, endsAt: Number.MAX_SAFE_INTEGER, firstFinalizedAt: 2, hasCheckpoint: false,
  }), /out of range/);
});
