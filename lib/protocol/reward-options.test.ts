import assert from "node:assert/strict";
import test from "node:test";

import {
  CHILIZ_REWARD_OPTIONS,
  getRewardOption,
  parseRewardOptionId,
  REWARD_OPTIONS,
  SOLANA_REWARD_OPTIONS,
} from "./reward-options.ts";

test("the catalog records 78 migrated Chiliz identities but enables no legacy payout route", () => {
  assert.equal(CHILIZ_REWARD_OPTIONS.length, 78);
  assert.deepEqual(SOLANA_REWARD_OPTIONS.map((asset) => asset.symbol).sort(), ["AFC", "ARG"]);
  assert.equal(REWARD_OPTIONS.length, 80);
  assert.equal(new Set(REWARD_OPTIONS.map((asset) => asset.id)).size, 80);
  assert.ok(CHILIZ_REWARD_OPTIONS.every((asset) => asset.routeStatus === "legacy_unverified"));
  assert.ok(CHILIZ_REWARD_OPTIONS.every((asset) => asset.wrappedTokenAddress === null));
  assert.ok(CHILIZ_REWARD_OPTIONS.every((asset) => asset.legacyTokenAddress?.toLowerCase() !== asset.tokenAddress.toLowerCase()));
  assert.equal(getRewardOption("chiliz", "BAR")?.tokenAddress, "0x1589248b4B61ed472cc21CA1F2114d93ab6910D5");
  assert.equal(getRewardOption("chiliz", "PSG")?.tokenAddress, "0xFe1d4A935df7A4A52F835f6104C97AF9D72217f2");
});

test("reward options resolve by chain and never cross-resolve the same symbol", () => {
  assert.equal(getRewardOption("chiliz", "afc")?.venue, "Kayen");
  assert.equal(getRewardOption("solana", "AFC")?.venue, "Jupiter");
  assert.equal(parseRewardOptionId("chiliz:BAR")?.chain, "chiliz");
  assert.equal(parseRewardOptionId("solana:BAR"), null);
});
