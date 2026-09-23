import assert from "node:assert/strict";
import test from "node:test";

import { CHILIZ_REWARD_ASSETS, CHILIZ_V2_MIGRATION_SOURCE, getChilizRewardAsset } from "./chiliz-reward-assets.ts";

test("every legacy Kayen entry has a distinct current Chiliz V2 identity but no verified route", () => {
  assert.equal(CHILIZ_REWARD_ASSETS.length, 78);
  assert.equal(new Set(CHILIZ_REWARD_ASSETS.map((asset) => asset.symbol)).size, 78);
  assert.equal(new Set(CHILIZ_REWARD_ASSETS.map((asset) => asset.currentV2Contract.toLowerCase())).size, 78);
  for (const asset of CHILIZ_REWARD_ASSETS) {
    assert.match(asset.contract, /^0x[0-9a-fA-F]{40}$/);
    assert.match(asset.wrappedContract, /^0x[0-9a-fA-F]{40}$/);
    assert.match(asset.currentV2Contract, /^0x[0-9a-fA-F]{40}$/);
    assert.notEqual(asset.contract.toLowerCase(), asset.currentV2Contract.toLowerCase());
    assert.equal(asset.routeStatus, "legacy_unverified");
  }
  assert.match(CHILIZ_V2_MIGRATION_SOURCE, /^https:\/\/docs\.chiliz\.com\//);
});

test("BAR and PSG no longer identify their legacy 0-decimal contracts as current rewards", () => {
  assert.equal(getChilizRewardAsset("bar")?.contract, "0xFD3C73b3B09D418841dd6Aff341b2d6e3abA433b");
  assert.equal(getChilizRewardAsset("bar")?.currentV2Contract, "0x1589248b4B61ed472cc21CA1F2114d93ab6910D5");
  assert.equal(getChilizRewardAsset("psg")?.currentV2Contract, "0xFe1d4A935df7A4A52F835f6104C97AF9D72217f2");
});
