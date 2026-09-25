import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDirectChzOftPeer,
  DIRECT_CHZ_OFT,
  validateDirectChzOftFee,
  validateDirectChzOftRequest,
} from "./chiliz-direct-oft.ts";

const valid = {
  amountAtomic: "100000000",
  payerSolanaWallet: "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4",
  destinationChilizWallet: "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21",
  solanaRpcUrl: "https://api.mainnet-beta.solana.com/",
};

test("direct CHZ quote accepts only bounded canonical public addresses", () => {
  const result = validateDirectChzOftRequest(valid);
  assert.equal(result.amountAtomic, "100000000");
  assert.equal(result.payerSolanaWallet, valid.payerSolanaWallet);
  assert.equal(result.destinationChilizWallet, valid.destinationChilizWallet);
  assert.throws(() => validateDirectChzOftRequest({ ...valid, amountAtomic: "0" }));
  assert.throws(() => validateDirectChzOftRequest({ ...valid, amountAtomic: "1000000001" }));
  assert.throws(() => validateDirectChzOftRequest({ ...valid, amountAtomic: "1.0" }));
  assert.throws(() => validateDirectChzOftRequest({ ...valid, payerSolanaWallet: "not a wallet" }));
  assert.throws(() => validateDirectChzOftRequest({ ...valid, destinationChilizWallet: "0x1234" }));
  assert.throws(() => validateDirectChzOftRequest({ ...valid, solanaRpcUrl: "http://api.mainnet-beta.solana.com" }));
  assert.throws(() => validateDirectChzOftRequest({ ...valid, solanaRpcUrl: "https://user:pass@example.com" }));
});

test("direct CHZ quote pins official Chiliz native adapter peer", () => {
  const peer = `0x${"0".repeat(24)}${DIRECT_CHZ_OFT.chilizNativeAdapter.slice(2)}`;
  assert.doesNotThrow(() => assertDirectChzOftPeer(peer));
  assert.throws(() => assertDirectChzOftPeer(`0x${"0".repeat(24)}${"1".repeat(40)}`));
});

test("direct CHZ quote rejects absent, excessive, or non-native messaging fees", () => {
  assert.equal(validateDirectChzOftFee(1_000_000n, 0n), "1000000");
  assert.throws(() => validateDirectChzOftFee(0n, 0n));
  assert.throws(() => validateDirectChzOftFee(50_000_001n, 0n));
  assert.throws(() => validateDirectChzOftFee(1_000_000n, 1n));
});

test("direct CHZ route is pinned to the official 8-decimal Solana CHZ mint", () => {
  assert.equal(DIRECT_CHZ_OFT.solanaMint, "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw");
  assert.equal(DIRECT_CHZ_OFT.solanaDecimals, 8);
  assert.equal(DIRECT_CHZ_OFT.chilizEid, 30409);
  assert.equal(DIRECT_CHZ_OFT.executionReady, false);
});
