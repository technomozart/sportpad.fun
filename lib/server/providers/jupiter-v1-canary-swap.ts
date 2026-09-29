import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import type { JupiterSwapPlan } from "./jupiter-swap.ts";

/**
 * Temporary, one-shot SOL -> official CHZ canary fallback. Jupiter's Metis
 * Swap API V1 is deprecated; this must not become the general reward route.
 * The resulting unsigned message still goes through the ordinary account,
 * simulation, embedded-minimum, signature, journal and receipt checks.
 * https://developers.jup.ag/docs/api-reference/swap/v1/quote
 * https://developers.jup.ag/docs/api-reference/swap/v1/swap
 */
const QUOTE_ENDPOINT = "https://api.jup.ag/swap/v1/quote";
const SWAP_ENDPOINT = "https://api.jup.ag/swap/v1/swap";
const CANARY_INPUT_LAMPORTS = "1000000";
const SLIPPAGE_BPS = 100;
const MAX_PRICE_IMPACT_RATIO = 0.05; // 5%.
const MAX_PRIORITY_FEE_LAMPORTS = 400_000;
const MAX_TRANSACTION_BYTES = 1_232;
// A fixed, currently decoded route family is safer than chasing newly added
// JUP6 enum tags across every DEX. The transaction verifier remains decisive.
const CANARY_DEXES = ["PancakeSwap", "Meteora DLMM"] as const;

function fail(code: string): never { throw new Error(`jupiter_v1_canary_${code}`); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function atomic(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) fail("atomic_invalid");
  return BigInt(value);
}
function canonicalBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > 4_096 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("transaction_encoding_invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 100 || bytes.length > MAX_TRANSACTION_BYTES ||
      bytes.toString("base64") !== value) fail("transaction_bytes_invalid");
  return bytes;
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}
async function json(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try { payload = await response.json(); } catch { fail("response_json_invalid"); }
  if (!response.ok || !record(payload) || payload.error != null) fail(`http_${response.status}`);
  return payload;
}

export async function prepareJupiterV1CanarySwap(input: {
  apiKey: string;
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  taker: string;
  fetcher?: typeof fetch;
}): Promise<JupiterSwapPlan> {
  const { apiKey, inputMint, outputMint, amountAtomic, taker, fetcher = fetch } = input;
  if (!apiKey || inputMint !== REPLENISHMENT_ASSETS.solMint ||
      outputMint !== REPLENISHMENT_ASSETS.solanaChzMint ||
      amountAtomic !== CANARY_INPUT_LAMPORTS) fail("scope_invalid");
  let payer: PublicKey;
  try { payer = new PublicKey(taker); } catch { return fail("taker_invalid"); }
  if (payer.toBase58() !== taker || !PublicKey.isOnCurve(payer.toBytes())) fail("taker_invalid");

  const quoteUrl = new URL(QUOTE_ENDPOINT);
  quoteUrl.searchParams.set("inputMint", inputMint);
  quoteUrl.searchParams.set("outputMint", outputMint);
  quoteUrl.searchParams.set("amount", amountAtomic);
  quoteUrl.searchParams.set("swapMode", "ExactIn");
  quoteUrl.searchParams.set("slippageBps", String(SLIPPAGE_BPS));
  quoteUrl.searchParams.set("instructionVersion", "V1");
  quoteUrl.searchParams.set("dexes", CANARY_DEXES.join(","));
  const quote = await json(await fetcher(quoteUrl, {
    headers: { Accept: "application/json", "x-api-key": apiKey },
    cache: "no-store", signal: AbortSignal.timeout(12_000),
  }));
  if (quote.inputMint !== inputMint || quote.outputMint !== outputMint ||
      quote.inAmount !== amountAtomic || quote.swapMode !== "ExactIn" ||
      quote.slippageBps !== SLIPPAGE_BPS ||
      quote.platformFee != null || quote.platformFeeBps != null && quote.platformFeeBps !== 0) {
    fail("quote_constraint_changed");
  }
  const outAmount = atomic(quote.outAmount);
  const quoteMinimum = atomic(quote.otherAmountThreshold);
  const embeddedMinimum = outAmount * BigInt(10_000 - SLIPPAGE_BPS) / 10_000n;
  // Metis V1's quoted threshold can round one atomic unit above the JUP6
  // instruction's integer-truncated minimum. Journal the exact embedded floor.
  if (embeddedMinimum <= 0n || quoteMinimum < embeddedMinimum ||
      quoteMinimum > embeddedMinimum + 1n || quoteMinimum > outAmount) {
    fail("quote_minimum_invalid");
  }
  const ratio = typeof quote.priceImpactPct === "string" ?
    Number(quote.priceImpactPct) : NaN;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > MAX_PRICE_IMPACT_RATIO) {
    fail("price_impact_exceeded");
  }
  if (!Array.isArray(quote.routePlan) || quote.routePlan.length === 0 ||
      quote.routePlan.length > 8 ||
      quote.routePlan.some((step) => {
        if (!record(step)) return true;
        const swapInfo = step.swapInfo;
        if (!record(swapInfo)) return true;
        return !CANARY_DEXES.some((dex) => dex === swapInfo.label);
      })) {
    fail("route_plan_invalid");
  }

  // Pass Jupiter's complete, unchanged quote back to its transaction builder.
  // Do not request a separate fee payer, platform fee, sponsored gas or dynamic
  // slippage. The priority fee cap is below the canary's total spend ceiling.
  const swap = await json(await fetcher(SWAP_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: taker,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: false,
      asLegacyTransaction: false,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: "high", maxLamports: MAX_PRIORITY_FEE_LAMPORTS,
        },
      },
    }),
    cache: "no-store", signal: AbortSignal.timeout(20_000),
  }));
  const bytes = canonicalBase64(swap.swapTransaction);
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bytes); }
  catch { return fail("transaction_unreadable"); }
  if (!Buffer.from(tx.serialize()).equals(bytes) || tx.version !== 0 ||
      tx.message.header.numRequiredSignatures !== 1 ||
      tx.message.header.numReadonlySignedAccounts !== 0 ||
      tx.message.staticAccountKeys[0]?.toBase58() !== taker ||
      tx.signatures.length !== 1 || tx.signatures[0].some((byte) => byte !== 0)) {
    fail("transaction_signer_invalid");
  }
  const lastValidBlockHeight = swap.lastValidBlockHeight;
  if (typeof lastValidBlockHeight !== "number" ||
      !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
    fail("blockheight_invalid");
  }
  const priorityFee = swap.prioritizationFeeLamports;
  if (priorityFee != null &&
      (typeof priorityFee !== "number" || !Number.isSafeInteger(priorityFee) ||
        priorityFee < 0 || priorityFee > MAX_PRIORITY_FEE_LAMPORTS)) {
    fail("priority_fee_exceeded");
  }
  const messageHash = await sha256Hex(tx.message.serialize());
  return {
    transactionBase64: swap.swapTransaction as string,
    transactionMessageHash: messageHash,
    // V1 has no requestId. This label binds the quote/transaction in the
    // one-shot journal; it is never sent to Jupiter for execution.
    requestId: `metis-v1-canary:${messageHash}`,
    lastValidBlockHeight,
    inputMint,
    outputMint,
    inputAmountAtomic: amountAtomic,
    outputAmountAtomic: outAmount.toString(),
    minimumOutputAtomic: embeddedMinimum.toString(),
    priceImpactPercent: ratio * 100,
    router: "metis",
  };
}
