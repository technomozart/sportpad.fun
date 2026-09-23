import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFreshQuote,
  assertOfficialV2Asset,
  chzSpendFromSolanaQuote,
  positiveAtomic,
  validateKayenQuote,
} from "./chiliz-worker-safety.mjs";

const SOL = "So11111111111111111111111111111111111111112";
const CHZ = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const V2 = "0x1589247a200c703F249E8e02D5aC51030B8D10D5";

test("only a verified current V2 contract is eligible", () => {
  const payload = { rewardSymbol: "BAR", fanTokenContract: V2 };
  const assets = [{ symbol: "BAR", currentV2Contract: V2, routeStatus: "legacy_unverified" }];
  assert.throws(() => assertOfficialV2Asset(payload, assets), /chiliz_v2_asset_unverified/);
  assets[0].routeStatus = "current_verified";
  assert.equal(assertOfficialV2Asset(payload, assets), assets[0]);
  assert.throws(() => assertOfficialV2Asset({ ...payload, fanTokenContract: "0x0000000000000000000000000000000000000000" }, assets), /unverified/);
});

test("Solana CHZ quote requires exact route, bounded spend, and freshness", () => {
  const now = 1_000_000;
  const quote = { inputMint: SOL, outputMint: CHZ, inAmount: "1000000000", outAmount: "10000000000", priceImpact: "0.01" };
  assert.equal(chzSpendFromSolanaQuote(quote, "1000000000", now, now, SOL, CHZ), 100n * 10n ** 18n);
  assert.throws(() => chzSpendFromSolanaQuote(quote, "1000000000", now - 15_001, now, SOL, CHZ), /stale/);
  assert.throws(() => chzSpendFromSolanaQuote({ ...quote, outputMint: SOL }, "1000000000", now, now, SOL, CHZ), /mismatch/);
  assert.throws(() => chzSpendFromSolanaQuote({ ...quote, outAmount: "100000000001" }, "1000000000", now, now, SOL, CHZ), /out_of_bounds/);
  assert.throws(() => chzSpendFromSolanaQuote({ ...quote, priceImpact: "6" }, "1000000000", now, now, SOL, CHZ), /price_impact/);
  assert.throws(() => chzSpendFromSolanaQuote(quote, "11000000000", now, now, SOL, CHZ), /cap_exceeded/);
});

test("exact-size Kayen quote rejects dust, shallow depth, and stale responses", () => {
  const spend = 100n * 10n ** 18n;
  const probe = spend / 10n;
  const probeAmounts = [probe, 10n * 10n ** 18n];
  assert.equal(validateKayenQuote(spend, probe, probeAmounts, [spend, 99n * 10n ** 18n], 1_000, 1_000), 98_010_000_000_000_000_000n);
  assert.throws(() => validateKayenQuote(spend, probe, probeAmounts, [spend, 80n * 10n ** 18n], 1_000, 1_000), /depth_insufficient/);
  assert.throws(() => validateKayenQuote(spend, probe, probeAmounts, [spend, 99n * 10n ** 18n], 1_000, 16_001), /stale/);
  assert.throws(() => validateKayenQuote(spend, probe, [probe, 1n], [spend, 1n], 1_000, 1_000), /output_too_small/);
  assert.throws(() => validateKayenQuote(spend, probe, probeAmounts, [spend - 1n, 99n * 10n ** 18n], 1_000, 1_000), /mismatch/);
  assert.throws(() => assertFreshQuote(1_000, 16_001), /stale/);
  assert.throws(() => positiveAtomic("1e18", "invalid_atomic"), /invalid_atomic/);
});
