import { REPLENISHMENT_ASSETS } from "./replenishment.ts";

const MAX_SOL_LAMPORTS = 10_000_000_000n;
const MAX_CHZ_WEI = 1_000n * 10n ** 18n;
const MIN_CHZ_WEI = 10n ** 16n;
const QUOTE_TIMEOUT_MS = 15_000;
const MAX_RECEIPT_QUOTE_GAP_MS = 120_000;
const ALLOWED_ROUTERS = new Set(["metis", "okx", "dflow", "jupiterz"]);

function fail(code: string): never { throw new Error(code); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("chiliz_spend_quote_invalid");
  return value as Record<string, unknown>;
}
function atomic(value: unknown, code: string) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) fail(code);
  return BigInt(value);
}

export function validateChilizPurchaseSpendQuote(quotePayload: unknown, rewardAmountLamports: string,
  timing: { requestedAtMs: number; observedAtMs: number; txBlockTimestampMs: number }) {
  const lamports = atomic(rewardAmountLamports, "chiliz_spend_reward_amount_invalid");
  if (lamports > MAX_SOL_LAMPORTS) fail("chiliz_spend_reward_cap_exceeded");
  const { requestedAtMs, observedAtMs, txBlockTimestampMs } = timing;
  if (![requestedAtMs, observedAtMs, txBlockTimestampMs].every(Number.isSafeInteger) ||
    observedAtMs < requestedAtMs || observedAtMs - requestedAtMs > QUOTE_TIMEOUT_MS ||
    observedAtMs < txBlockTimestampMs - 30_000 ||
    observedAtMs - txBlockTimestampMs > MAX_RECEIPT_QUOTE_GAP_MS) {
    fail("chiliz_spend_quote_stale");
  }

  const quote = record(quotePayload);
  if (quote.inputMint !== REPLENISHMENT_ASSETS.solMint ||
    quote.outputMint !== REPLENISHMENT_ASSETS.solanaChzMint ||
    quote.inAmount !== rewardAmountLamports || quote.swapMode !== "ExactIn" ||
    !ALLOWED_ROUTERS.has(String(quote.router)) || quote.transaction !== null ||
    (quote.taker !== null && quote.taker !== undefined)) {
    fail("chiliz_spend_quote_route_mismatch");
  }
  if (!Number.isSafeInteger(quote.slippageBps) || Number(quote.slippageBps) < 0 ||
    Number(quote.slippageBps) > 100 || !Number.isSafeInteger(quote.feeBps) ||
    Number(quote.feeBps) < 0 || Number(quote.feeBps) > 100) {
    fail("chiliz_spend_quote_fee_or_slippage_invalid");
  }
  const impactPercent = Number(quote.priceImpact);
  const impactFraction = Number(quote.priceImpactPct);
  if (typeof quote.priceImpact !== "number" ||
    typeof quote.priceImpactPct !== "string" ||
    !/^-?[0-9]+(?:\.[0-9]+)?$/.test(quote.priceImpactPct) ||
    !Number.isFinite(impactPercent) || !Number.isFinite(impactFraction) ||
    Math.abs(impactPercent) > 5 || Math.abs(impactFraction) > 0.05 ||
    Math.abs(impactPercent - impactFraction * 100) > 0.001) {
    fail("chiliz_spend_quote_price_impact_invalid");
  }
  const outputAtomic = atomic(quote.outAmount, "chiliz_spend_quote_output_invalid");
  const threshold = atomic(quote.otherAmountThreshold, "chiliz_spend_quote_threshold_invalid");
  if (threshold > outputAtomic || threshold * 100n < outputAtomic * 99n) {
    fail("chiliz_spend_quote_threshold_invalid");
  }

  // The official Solana CHZ mint has eight decimals and Chiliz native CHZ has
  // eighteen. The caller must independently check the mint's on-chain decimals.
  const quotedWei = outputAtomic * 10n ** BigInt(
    REPLENISHMENT_ASSETS.nativeChilizChzDecimals - REPLENISHMENT_ASSETS.solanaChzDecimals);
  if (quotedWei < MIN_CHZ_WEI || quotedWei > MAX_CHZ_WEI) fail("chiliz_spend_quote_output_cap_exceeded");
  const ceilingWei = quotedWei * 105n / 100n;
  return ceilingWei > MAX_CHZ_WEI ? MAX_CHZ_WEI : ceilingWei;
}
