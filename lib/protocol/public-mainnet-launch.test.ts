import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicMainnetReceipt } from "./public-mainnet-launch.ts";

const draft = {
  status: "mainnet_published",
  rewardMint: "82DNsTK61ZrgCHP6pfP32Eubcsp9h38d64E6X9ETEBBe",
  mainnetMetadataUri: "https://ipfs.example/metadata.json",
  mainnetMint: "BPFLoaderUpgradeab1e11111111111111111111111",
  mainnetCreateSignature: "2".repeat(64),
  mainnetCreateSlot: 123,
  mainnetFeeSignature: "3".repeat(64),
  mainnetFeeSlot: 124,
  mainnetRewardTreasury: "Vote111111111111111111111111111111111111111",
  mainnetBuybackTreasury: "Stake11111111111111111111111111111111111111",
  mainnetVerifiedAt: "2026-09-22T00:00:00.000Z",
};

test("publishes only a complete verified mainnet receipt", () => {
  const receipt = buildPublicMainnetReceipt(draft);
  assert.equal(receipt?.network, "solana:mainnet");
  assert.equal(receipt?.createSlot, 123);
  assert.equal(receipt?.feeSlot, 124);
});

test("rejects incomplete or non-public mainnet evidence", () => {
  assert.equal(buildPublicMainnetReceipt({ ...draft, status: "content_approved" }), null);
  assert.equal(buildPublicMainnetReceipt({ ...draft, mainnetFeeSignature: null }), null);
  assert.equal(buildPublicMainnetReceipt({ ...draft, mainnetCreateSlot: null }), null);
});
