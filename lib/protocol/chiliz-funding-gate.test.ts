import assert from "node:assert/strict";
import test from "node:test";

import { CHILIZ_FEE_FUNDING_VERIFIED } from "./chiliz-funding-gate.ts";

test("Chiliz purchases stay locked until each 80% fee is converted and reconciled", () => {
  assert.equal(CHILIZ_FEE_FUNDING_VERIFIED, false);
});
