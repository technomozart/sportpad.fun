import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import {
  buildUntrustedChzBridgeSteps,
  quoteExactChzBridge,
  validateBuiltChzBridgeSteps,
} from "./layerzero-value-transfer.ts";

const solanaWallet = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const chilizWallet = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const now = Date.UTC(2026, 8, 24, 10);
const apiKey = "test_key_that_must_never_appear_in_an_error";
const quotePayload = {
  quotes: [{
    id: "quote_123456",
    srcAmount: "100000000",
    dstAmount: "990000000000000000",
    dstAmountMin: "980000000000000000",
    feePercent: "1",
    expiresAt: new Date(now + 90_000).toISOString(),
    routeSteps: [{ type: "OFT_V2", srcChainKey: "solana" }],
  }],
};
const chains = { chains: [
  { chainKey: "solana", chainType: "SOLANA", chainId: 1 },
  { chainKey: "chiliz", chainType: "EVM", chainId: 88_888 },
] };
const tokens = { tokens: [{
  isSupported: true, chainKey: "solana", address: REPLENISHMENT_ASSETS.solanaChzMint,
  decimals: 8, symbol: "CHZ",
}], pagination: {} };
const destinations = { tokens: [{
  isSupported: true, chainKey: "chiliz", address: REPLENISHMENT_ASSETS.nativeChilizChz,
  decimals: 18, symbol: "CHZ",
}], pagination: {} };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function mockQuoteFetch(calls: Array<{ url: string; init: RequestInit }>, response: unknown = quotePayload): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/chains")) return json(chains);
    if (url.includes("transferrableFromChainKey=")) return json(destinations);
    if (url.endsWith("/tokens")) return json(tokens);
    if (url.endsWith("/quotes")) return json(response);
    throw new Error("Unexpected URL");
  }) as typeof fetch;
}

function unsignedStep(signer = solanaWallet) {
  const blockhash = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
  const message = new TransactionMessage({
    payerKey: new PublicKey(solanaWallet),
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return {
    type: "TRANSACTION", chainKey: "solana", chainType: "SOLANA", signerAddress: signer,
    transaction: { encoded: { encoding: "base64", data: Buffer.from(tx.serialize()).toString("base64") } },
  };
}

test("request rechecks exact directory and sends only bounded Solana CHZ to native Chiliz CHZ quote", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const quote = await quoteExactChzBridge({
    apiKey, amountAtomic: "100000000", sourceSolanaWallet: solanaWallet,
    destinationChilizWallet: chilizWallet, fetchImpl: mockQuoteFetch(calls), nowMs: now,
  });
  assert.equal(quote.quoteId, "quote_123456");
  assert.equal(quote.executionReady, false);
  assert.equal(calls.length, 4);
  assert.match(calls[2].url, new RegExp(REPLENISHMENT_ASSETS.solanaChzMint));
  const request = JSON.parse(String(calls[3].init.body));
  assert.deepEqual(request, {
    srcChainKey: "solana", dstChainKey: "chiliz",
    srcTokenAddress: REPLENISHMENT_ASSETS.solanaChzMint,
    dstTokenAddress: REPLENISHMENT_ASSETS.nativeChilizChz,
    srcWalletAddress: solanaWallet, dstWalletAddress: chilizWallet,
    amount: "100000000",
    options: { amountType: "EXACT_SRC_AMOUNT", feeTolerance: { type: "PERCENT", amount: 1 } },
  });
  assert.equal((calls[3].init.headers as Record<string, string>)["x-api-key"], apiKey);
  assert.equal((calls[0].init.headers as Record<string, string>)["x-api-key"], undefined);
});

test("quote client fails closed on amount cap, changed destination, and provider errors without leaking the key", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const input = { apiKey, sourceSolanaWallet: solanaWallet, destinationChilizWallet: chilizWallet,
    fetchImpl: mockQuoteFetch(calls), nowMs: now };
  await assert.rejects(quoteExactChzBridge({ ...input, amountAtomic: "1000000001" }), /ten CHZ/);
  assert.equal(calls.length, 0);
  await assert.rejects(quoteExactChzBridge({
    ...input, amountAtomic: "100000000",
    fetchImpl: mockQuoteFetch([], { quotes: [{ ...quotePayload.quotes[0], dstWalletAddress: "0x" + "a".repeat(40) }] }),
  }), /changed dstWalletAddress/);
  await assert.rejects(quoteExactChzBridge({
    ...input, amountAtomic: "100000000",
    fetchImpl: mockQuoteFetch([], { quotes: [quotePayload.quotes[0],
      { ...quotePayload.quotes[0], dstWalletAddress: "0x" + "a".repeat(40) }] }),
  }), /duplicate quote IDs/);
  await assert.rejects(quoteExactChzBridge({
    ...input, amountAtomic: "100000000",
    fetchImpl: (async (url: RequestInfo | URL) => String(url).endsWith("/quotes")
      ? json({ error: apiKey }, 401)
      : mockQuoteFetch([])(url)) as typeof fetch,
  }), (error: Error) => error.message.includes("HTTP 401") && !error.message.includes(apiKey));
});

test("Solana build call binds the chosen quote ID and returns only non-executable inspection metadata", async () => {
  const quote = await quoteExactChzBridge({
    apiKey, amountAtomic: "100000000", sourceSolanaWallet: solanaWallet,
    destinationChilizWallet: chilizWallet, fetchImpl: mockQuoteFetch([]), nowMs: now,
  });
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const steps = await buildUntrustedChzBridgeSteps({
    apiKey, quote, nowMs: now,
    fetchImpl: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return json({ userSteps: [unsignedStep()] });
    }) as typeof fetch,
  });
  assert.equal(calls[0].url, "https://transfer.layerzero-api.com/v1/build-user-steps");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { quoteId: quote.quoteId });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].executionReady, false);
  assert.equal(steps[0].instructionEffectsVerified, false);
  assert.equal(steps[0].blockhashFreshnessVerified, false);
  assert.equal(steps[0].signerAddress, solanaWallet);
  assert.equal(steps[0].messageSha256.length, 64);
  assert.equal("encodedTransactionBase64" in steps[0], false);
});

test("built steps reject wrong signer, wrong chain, duplicate messages, malformed base64 and expired quote", async () => {
  const quote = await quoteExactChzBridge({
    apiKey, amountAtomic: "100000000", sourceSolanaWallet: solanaWallet,
    destinationChilizWallet: chilizWallet, fetchImpl: mockQuoteFetch([]), nowMs: now,
  });
  const valid = unsignedStep();
  await assert.rejects(validateBuiltChzBridgeSteps({ userSteps: [unsignedStep("11111111111111111111111111111111")] }, quote, now), /unapproved chain, signer/);
  await assert.rejects(validateBuiltChzBridgeSteps({ userSteps: [{ ...valid, chainKey: "ethereum" }] }, quote, now), /unapproved chain, signer/);
  await assert.rejects(validateBuiltChzBridgeSteps({ userSteps: [valid, valid] }, quote, now), /duplicate/);
  await assert.rejects(validateBuiltChzBridgeSteps({ userSteps: [{ ...valid, transaction: { encoded: { encoding: "base64", data: "not-base64" } } }] }, quote, now), /invalid Solana transaction encoding/);
  await assert.rejects(validateBuiltChzBridgeSteps({ userSteps: [valid] }, quote, now + 80_000), /expired/);
  const signed = unsignedStep();
  const tx = VersionedTransaction.deserialize(Buffer.from(signed.transaction.encoded.data, "base64"));
  tx.signatures[0][0] = 1;
  signed.transaction.encoded.data = Buffer.from(tx.serialize()).toString("base64");
  await assert.rejects(validateBuiltChzBridgeSteps({ userSteps: [signed] }, quote, now), /unapproved signer/);
});
