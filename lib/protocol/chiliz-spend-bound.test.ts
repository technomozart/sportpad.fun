import assert from "node:assert/strict";
import test from "node:test";

import { validateChilizPurchaseSpendQuote } from "./chiliz-spend-bound.ts";
import { REPLENISHMENT_ASSETS } from "./replenishment.ts";

const amountLamports = "10000000";
const timing = { requestedAtMs: 1_005_000, observedAtMs: 1_005_500, txBlockTimestampMs: 1_000_000 };
const quote = {
  inputMint: REPLENISHMENT_ASSETS.solMint,
  outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
  inAmount: amountLamports,
  outAmount: "6900000000", // 69 CHZ with the official mint's eight decimals.
  otherAmountThreshold: "6899000000",
  swapMode: "ExactIn", slippageBps: 0, feeBps: 10,
  priceImpact: -0.5, priceImpactPct: "-0.005",
  router: "metis", transaction: null, taker: null,
};

test("a fresh independent quote caps the native CHZ spend from the exact SOL reward share", () => {
  assert.equal(validateChilizPurchaseSpendQuote(quote, amountLamports, timing), 72_450_000_000_000_000_000n);
});

test("a different mint, amount, swap mode, or unexpected transaction cannot set a spend cap", () => {
  for (const changed of [
    { outputMint: REPLENISHMENT_ASSETS.solMint },
    { inAmount: "10000001" },
    { swapMode: "ExactOut" },
    { router: "unknown" },
    { transaction: "signed-base64" },
    { taker: "some-wallet" },
  ]) {
    assert.throws(() => validateChilizPurchaseSpendQuote({ ...quote, ...changed }, amountLamports, timing),
      /chiliz_spend_quote_route_mismatch/);
  }
});

test("a delayed, harmful, or malformed quote fails closed", () => {
  assert.throws(() => validateChilizPurchaseSpendQuote(quote, amountLamports,
    { ...timing, observedAtMs: 1_021_000 }), /chiliz_spend_quote_stale/);
  assert.throws(() => validateChilizPurchaseSpendQuote(quote, amountLamports,
    { ...timing, txBlockTimestampMs: 800_000 }), /chiliz_spend_quote_stale/);
  assert.throws(() => validateChilizPurchaseSpendQuote({ ...quote, priceImpact: -6 }, amountLamports, timing),
    /chiliz_spend_quote_price_impact_invalid/);
  assert.throws(() => validateChilizPurchaseSpendQuote({ ...quote, priceImpactPct: "-0.5" }, amountLamports, timing),
    /chiliz_spend_quote_price_impact_invalid/);
  assert.throws(() => validateChilizPurchaseSpendQuote({ ...quote, otherAmountThreshold: "100" }, amountLamports, timing),
    /chiliz_spend_quote_threshold_invalid/);
  assert.throws(() => validateChilizPurchaseSpendQuote({ ...quote, outAmount: "0" }, amountLamports, timing),
    /chiliz_spend_quote_output_invalid/);
  assert.throws(() => validateChilizPurchaseSpendQuote({ ...quote, slippageBps: 101 }, amountLamports, timing),
    /chiliz_spend_quote_fee_or_slippage_invalid/);
  assert.throws(() => validateChilizPurchaseSpendQuote(quote, "10000000001", timing),
    /chiliz_spend_reward_cap_exceeded/);
});

test("absolute CHZ cap remains in force even when a quote is favorable", () => {
  const nearlyAtCap = { ...quote, outAmount: "99000000000", otherAmountThreshold: "99000000000" };
  assert.equal(validateChilizPurchaseSpendQuote(nearlyAtCap, amountLamports, timing), 1_000n * 10n ** 18n);
  assert.throws(() => validateChilizPurchaseSpendQuote({ ...nearlyAtCap,
    outAmount: "100100000000", otherAmountThreshold: "100100000000" }, amountLamports, timing),
  /chiliz_spend_quote_output_cap_exceeded/);
});
