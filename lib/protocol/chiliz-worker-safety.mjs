const CHZ_WEI = 1_000_000_000_000_000_000n;
const MAX_SOL_LAMPORTS = 10_000_000_000n;
const MAX_CHZ_SPEND_WEI = 1_000n * CHZ_WEI;
const MIN_CHZ_SPEND_WEI = CHZ_WEI / 100n;
const MIN_V2_OUTPUT_ATOMIC = 1_000_000_000_000n;
const MAX_QUOTE_AGE_MS = 15_000;

export function positiveAtomic(value, code) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw new Error(code);
  return BigInt(value);
}

export function assertOfficialV2Asset(payload, assets) {
  if (typeof payload?.rewardSymbol !== "string" || typeof payload.fanTokenContract !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(payload.fanTokenContract)) throw new Error("chiliz_asset_invalid");
  const asset = assets.find((candidate) => candidate.symbol === payload.rewardSymbol.toUpperCase());
  if (!asset || asset.routeStatus !== "current_verified" ||
    asset.currentV2Contract.toLowerCase() !== payload.fanTokenContract.toLowerCase()) {
    throw new Error("chiliz_v2_asset_unverified");
  }
  return asset;
}

export function chzSpendFromSolanaQuote(quote, amountLamports, quotedAt, now, solMint, chzMint) {
  const input = positiveAtomic(amountLamports, "chiliz_quote_input_invalid");
  if (input > MAX_SOL_LAMPORTS) throw new Error("chiliz_quote_input_cap_exceeded");
  if (now < quotedAt || now - quotedAt > MAX_QUOTE_AGE_MS) throw new Error("chiliz_quote_stale");
  if (quote?.inputMint !== solMint || quote.outputMint !== chzMint || quote.inAmount !== amountLamports) {
    throw new Error("chiliz_quote_mismatch");
  }
  const output = positiveAtomic(quote.outAmount, "chiliz_quote_output_invalid");
  const impact = Number(quote.priceImpact);
  if (quote.priceImpact == null || !Number.isFinite(impact) || Math.abs(impact) > 5) {
    throw new Error("chiliz_quote_price_impact");
  }
  // Solana CHZ has 8 decimals; native Chiliz CHZ has 18. This conversion is
  // a sizing estimate only. It does not transfer CHZ between chains.
  const spend = output * 10_000_000_000n;
  if (spend < MIN_CHZ_SPEND_WEI || spend > MAX_CHZ_SPEND_WEI) {
    throw new Error("chiliz_spend_out_of_bounds");
  }
  return spend;
}

export function validateKayenQuote(spend, probeInput, probeAmounts, fullAmounts, quotedAt, now) {
  if (now < quotedAt || now - quotedAt > MAX_QUOTE_AGE_MS) throw new Error("kayen_quote_stale");
  if (!Array.isArray(probeAmounts) || probeAmounts.length !== 2 ||
    !Array.isArray(fullAmounts) || fullAmounts.length !== 2 ||
    probeAmounts[0] !== probeInput || fullAmounts[0] !== spend) throw new Error("kayen_quote_mismatch");
  const probeOutput = probeAmounts[1];
  const output = fullAmounts[1];
  if (typeof probeOutput !== "bigint" || typeof output !== "bigint" ||
    probeOutput <= 0n || output < MIN_V2_OUTPUT_ATOMIC) throw new Error("kayen_output_too_small");
  // Do not trade into a pool whose exact-size output is over 5% below a
  // one-tenth-size probe scaled linearly. A positive dust quote is insufficient.
  if (output * probeInput * 10_000n < probeOutput * spend * 9_500n) {
    throw new Error("kayen_depth_insufficient");
  }
  const minimum = output * 9_900n / 10_000n;
  if (minimum < MIN_V2_OUTPUT_ATOMIC) throw new Error("kayen_output_too_small");
  return minimum;
}

export function assertFreshQuote(quotedAt, now) {
  if (now < quotedAt || now - quotedAt > MAX_QUOTE_AGE_MS) throw new Error("kayen_quote_stale");
}
