import assert from "node:assert/strict";
import test from "node:test";

import {
  CHILIZ_REWARD_OPTIONS,
  getRewardOption,
  parseRewardOptionId,
  REWARD_OPTIONS,
  SOLANA_REWARD_OPTIONS,
} from "./reward-options.ts";

test("the live reward catalog contains 78 Chiliz assets and only two Solana assets", () => {
  assert.equal(CHILIZ_REWARD_OPTIONS.length, 78);
  assert.deepEqual(SOLANA_REWARD_OPTIONS.map((asset) => asset.symbol).sort(), ["AFC", "ARG"]);
  assert.equal(REWARD_OPTIONS.length, 80);
  assert.equal(new Set(REWARD_OPTIONS.map((asset) => asset.id)).size, 80);
});

test("reward options resolve by chain and never cross-resolve the same symbol", () => {
  assert.equal(getRewardOption("chiliz", "afc")?.venue, "Kayen");
  assert.equal(getRewardOption("solana", "AFC")?.venue, "Jupiter");
  assert.equal(parseRewardOptionId("chiliz:BAR")?.chain, "chiliz");
  assert.equal(parseRewardOptionId("solana:BAR"), null);
});
