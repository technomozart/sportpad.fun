import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicDevnetReceipt,
  type PublishableDevnetDraft,
  type VerifiedDevnetSubmission,
} from "./public-devnet-launch.ts";

const draft: PublishableDevnetDraft = {
  status: "devnet_published",
  name: "Supporters United",
  symbol: "SUP",
  rewardMint: "frozen-reward-token-address",
  creatorWallet: "creator-wallet",
  devnetMetadataUri: "ipfs://metadata",
  devnetMint: "mint-address",
  devnetCreateSignature: "create-signature",
  devnetFeeSignature: "fee-signature",
  devnetRewardWallet: "reward-wallet",
  devnetBurnWallet: "burn-wallet",
  devnetVerifiedAt: "2026-09-18T10:00:00.000Z",
  devnetPublishedAt: "2026-09-18T10:05:00.000Z",
};

function submission(kind: "create" | "fee"): VerifiedDevnetSubmission {
  return {
    kind,
    status: "verified",
    mint: draft.devnetMint!,
    creatorWallet: draft.creatorWallet!,
    metadataUri: draft.devnetMetadataUri!,
    rewardWallet: draft.devnetRewardWallet!,
    burnWallet: draft.devnetBurnWallet!,
    tokenName: draft.name,
    tokenSymbol: draft.symbol,
    signature: kind === "create" ? draft.devnetCreateSignature! : draft.devnetFeeSignature!,
    verifiedSlot: kind === "create" ? 101 : 102,
  };
}

test("returns a public receipt only for an explicitly published verified devnet launch", () => {
  const receipt = buildPublicDevnetReceipt(draft, [submission("create"), submission("fee")]);
  assert.deepEqual(receipt, {
    network: "solana:devnet",
    rewardTokenAddress: "frozen-reward-token-address",
    mint: "mint-address",
    createSignature: "create-signature",
    createSlot: 101,
    feeSignature: "fee-signature",
    feeSlot: 102,
    rewardWallet: "reward-wallet",
    burnWallet: "burn-wallet",
    metadataUri: "ipfs://metadata",
    verifiedAt: "2026-09-18T10:00:00.000Z",
    publishedAt: "2026-09-18T10:05:00.000Z",
  });
  assert.equal("creatorWallet" in receipt!, false);
  assert.equal("ownerUserId" in receipt!, false);
});

test("does not publish a private verified draft", () => {
  assert.equal(
    buildPublicDevnetReceipt({ ...draft, status: "devnet_verified", devnetPublishedAt: null }, [submission("create"), submission("fee")]),
    null,
  );
});

test("rejects missing, unverified, or mismatched onchain evidence", () => {
  assert.equal(buildPublicDevnetReceipt({ ...draft, rewardMint: null }, [submission("create"), submission("fee")]), null);
  assert.equal(buildPublicDevnetReceipt(draft, [submission("create")]), null);
  assert.equal(
    buildPublicDevnetReceipt(draft, [submission("create"), { ...submission("fee"), status: "recorded" }]),
    null,
  );
  assert.equal(
    buildPublicDevnetReceipt(draft, [submission("create"), { ...submission("fee"), rewardWallet: "other-wallet" }]),
    null,
  );
});
