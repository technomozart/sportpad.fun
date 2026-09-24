import assert from "node:assert/strict";
import test from "node:test";

import { AUTOMATED_PUMP_FEE_COLLECTION_VERIFIED } from "./fee-collection-gate.ts";

test("indexing Pump fee distributions does not enable unattended collection", () => {
  assert.equal(AUTOMATED_PUMP_FEE_COLLECTION_VERIFIED, false);
});
