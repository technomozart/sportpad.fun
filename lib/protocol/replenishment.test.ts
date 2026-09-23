import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REPLENISHMENT_ASSETS,
  automaticReplenishmentNextAction,
  layerZeroQuoteRequest,
  validateLayerZeroDiscovery,
  validateLayerZeroQuote,
  validatePublicWallets,
} from "./replenishment.ts";

const solanaWallet = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const chilizWallet = `0x${"a".repeat(40)}`;
const chains = { chains: [
  { chainKey: "solana", chainType: "SOLANA", chainId: 1 },
  { chainKey: "chiliz", chainType: "EVM", chainId: 88_888 },
] };
const tokens = { tokens: [{
  isSupported: true,
  chainKey: "solana",
  address: REPLENISHMENT_ASSETS.solanaChzMint,
  decimals: 8,
  symbol: "CHZ",
}], pagination: {} };
const destinations = { tokens: [{
  isSupported: true,
  chainKey: "chiliz",
  address: REPLENISHMENT_ASSETS.nativeChilizChz,
  decimals: 18,
  symbol: "CHZ",
}], pagination: {} };

test("discovery accepts only the exact CHZ mainnet route", () => {
  assert.equal(validateLayerZeroDiscovery(chains, tokens, destinations).sourceMint, REPLENISHMENT_ASSETS.solanaChzMint);
  assert.throws(() => validateLayerZeroDiscovery(chains, tokens, { ...destinations, tokens: [] }), /exact Solana CHZ/);
  assert.throws(() => validateLayerZeroDiscovery(chains, tokens, { ...destinations, pagination: { nextToken: "more" } }), /paginated/);
  assert.throws(() => validateLayerZeroDiscovery(chains, { ...tokens, tokens: [{ ...tokens.tokens[0], decimals: 9 }] }, destinations), /exact Solana CHZ/);
  assert.throws(() => validateLayerZeroDiscovery({ chains: [{ ...chains.chains[0] }, { ...chains.chains[1], chainId: 1 }] }, tokens, destinations), /expected Solana and Chiliz/);
});

test("bridge request locks source, destination, wallets and exact source amount", () => {
  assert.deepEqual(validatePublicWallets(solanaWallet, chilizWallet), { solanaWallet, chilizWallet });
  const request = layerZeroQuoteRequest("123456789", solanaWallet, chilizWallet);
  assert.equal(request.srcTokenAddress, REPLENISHMENT_ASSETS.solanaChzMint);
  assert.equal(request.dstTokenAddress, REPLENISHMENT_ASSETS.nativeChilizChz);
  assert.equal(request.amount, "123456789");
  assert.equal(request.options.amountType, "EXACT_SRC_AMOUNT");
  assert.throws(() => layerZeroQuoteRequest("0", solanaWallet, chilizWallet), /positive atomic/);
  assert.throws(() => validatePublicWallets(solanaWallet, "0xwrong"), /valid public Chiliz/);
});

test("bridge quote rejects amount, minimum, fee, route and expiry changes", () => {
  const now = Date.UTC(2026, 8, 23, 12);
  const quote = {
    id: "quote_test_1",
    srcAmount: "100000000",
    dstAmount: "990000000000000000",
    dstAmountMin: "980000000000000000",
    feePercent: "1.0",
    expiresAt: new Date(now + 90_000).toISOString(),
    routeSteps: [{ type: "OFT_V2", srcChainKey: "solana" }],
  };
  assert.equal(validateLayerZeroQuote({ quotes: [quote] }, "100000000", now).quoteId, quote.id);
  const rejects = [
    { srcAmount: "100000001" },
    { dstAmountMin: "999999999999999999" },
    { feePercent: "2.1" },
    { feePercent: null },
    { dstAmountMin: "940000000000000000" },
    { dstAmount: "1010000000000000000", dstAmountMin: "1001000000000000000" },
    { expiresAt: new Date(now + 10_000).toISOString() },
    { routeSteps: [{ type: "AORI", srcChainKey: "solana" }] },
    { routeSteps: [{ type: "OFT_V2", srcChainKey: "solana" }, { type: "OFT_V2", srcChainKey: "base" }] },
  ];
  for (const mutation of rejects) {
    assert.throws(() => validateLayerZeroQuote({ quotes: [{ ...quote, ...mutation }] }, "100000000", now));
  }
  assert.throws(() => validateLayerZeroQuote({ quotes: [] }, "100000000", now), /no executable/);
});

test("ambiguous broadcast states never authorize automatic replay", () => {
  assert.equal(automaticReplenishmentNextAction("planned"), "quote_only");
  assert.equal(automaticReplenishmentNextAction("swap_broadcast_unknown"), "manual_reconcile_no_retry");
  assert.equal(automaticReplenishmentNextAction("bridge_broadcast_unknown"), "manual_reconcile_no_retry");
  assert.equal(automaticReplenishmentNextAction("manual_review"), "manual_reconcile_no_retry");
});

test("dry-run CLI rejects any execution flag before network access", () => {
  const script = new URL("../../scripts/replenish-chiliz.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(script), "--execute"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid or duplicate option: --execute/);
  assert.doesNotMatch(result.stdout, /routeDirectory/);
});
