import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import { prepareJupiterV1CanarySwap } from "./jupiter-v1-canary-swap.ts";

const treasuryKeypair = Keypair.fromSeed(new Uint8Array(32).fill(91));
const treasury = treasuryKeypair.publicKey;
const otherKeypair = Keypair.fromSeed(new Uint8Array(32).fill(92));
const other = otherKeypair.publicKey;
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(93)).publicKey.toBase58();
const outAmount = 733_868_458n;
const embeddedFloor = outAmount * 9_900n / 10_000n;

function unsigned(payer = treasury, preSign = false): string {
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: payer, recentBlockhash: blockhash, instructions: [],
  }).compileToV0Message());
  if (preSign) transaction.sign([payer.equals(treasury) ? treasuryKeypair : otherKeypair]);
  return Buffer.from(transaction.serialize()).toString("base64");
}

function fixture(quoteOverrides: Record<string, unknown> = {},
  swapOverrides: Record<string, unknown> = {}) {
  const quote = {
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    inAmount: "1000000", outAmount: outAmount.toString(),
    otherAmountThreshold: (embeddedFloor + 1n).toString(),
    swapMode: "ExactIn", slippageBps: 100,
    priceImpactPct: "0.0001", platformFee: null,
    routePlan: [{ swapInfo: { ammKey: other.toBase58(), label: "PancakeSwap" }, percent: 100 }],
    ...quoteOverrides,
  };
  const swap = {
    swapTransaction: unsigned(),
    lastValidBlockHeight: 12345,
    prioritizationFeeLamports: 9000,
    ...swapOverrides,
  };
  const seen: { url: URL; options: RequestInit | undefined }[] = [];
  const fetcher = (async (url: string | URL, options?: RequestInit) => {
    seen.push({ url: new URL(String(url)), options });
    return Response.json(seen.length === 1 ? quote : swap);
  }) as typeof fetch;
  return { quote, swap, seen, fetcher };
}

function request(fetcher: typeof fetch) {
  return prepareJupiterV1CanarySwap({
    apiKey: "test-key",
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    amountAtomic: "1000000",
    taker: treasury.toBase58(),
    fetcher,
  });
}

test("V1 canary requests exact quote and swap; returns an unsigned message-bound plan", async () => {
  const { quote, seen, fetcher } = fixture();
  const plan = await request(fetcher);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url.pathname, "/swap/v1/quote");
  assert.equal(seen[0].url.searchParams.get("inputMint"), REPLENISHMENT_ASSETS.solMint);
  assert.equal(seen[0].url.searchParams.get("outputMint"), REPLENISHMENT_ASSETS.solanaChzMint);
  assert.equal(seen[0].url.searchParams.get("amount"), "1000000");
  assert.equal(seen[0].url.searchParams.get("instructionVersion"), "V1");
  assert.equal(seen[0].url.searchParams.get("dexes"), "PancakeSwap,Meteora DLMM");
  assert.equal(seen[0].url.searchParams.get("slippageBps"), "100");
  assert.equal(seen[0].options?.method, undefined);
  assert.equal(seen[1].url.pathname, "/swap/v1/swap");
  assert.equal(seen[1].options?.method, "POST");
  const body = JSON.parse(String(seen[1].options?.body));
  assert.deepEqual(body.quoteResponse, quote);
  assert.equal(body.userPublicKey, treasury.toBase58());
  assert.equal(body.dynamicComputeUnitLimit, true);
  assert.equal(body.dynamicSlippage, false);
  assert.equal(body.payer, undefined);
  assert.equal(body.feeAccount, undefined);
  assert.equal(body.prioritizationFeeLamports.priorityLevelWithMaxLamports.maxLamports, 400000);
  assert.equal(plan.router, "metis");
  assert.equal(plan.inputAmountAtomic, "1000000");
  assert.equal(plan.outputAmountAtomic, outAmount.toString());
  // Quote rounded up one atomic unit; the JUP6 embedded minimum truncates.
  assert.equal(plan.minimumOutputAtomic, embeddedFloor.toString());
  assert.equal(plan.priceImpactPercent, 0.01);
  assert.equal(plan.requestId, `metis-v1-canary:${plan.transactionMessageHash}`);
  assert.equal(plan.transactionMessageHash.length, 64);
});

test("V1 canary rejects changed quote constraints and any platform fee before /swap", async () => {
  for (const override of [
    { inAmount: "2000000" }, { outputMint: other.toBase58() },
    { swapMode: "ExactOut" }, { slippageBps: 101 },
    { platformFee: { amount: "1", feeBps: 10 } },
    { platformFeeBps: 10 },
  ]) {
    const { seen, fetcher } = fixture(override);
    await assert.rejects(request(fetcher), /quote_constraint_changed/);
    assert.equal(seen.length, 1);
  }
});

test("V1 canary accepts only the exact one-unit threshold rounding difference", async () => {
  for (const value of [(embeddedFloor - 1n).toString(),
    (embeddedFloor + 2n).toString()]) {
    const { seen, fetcher } = fixture({ otherAmountThreshold: value });
    await assert.rejects(request(fetcher), /quote_minimum_invalid/);
    assert.equal(seen.length, 1);
  }
  const { fetcher } = fixture({ otherAmountThreshold: embeddedFloor.toString() });
  assert.equal((await request(fetcher)).minimumOutputAtomic, embeddedFloor.toString());
});

test("V1 canary rejects any DEX outside its temporary decoded allowlist", async () => {
  const { seen, fetcher } = fixture({
    routePlan: [{ swapInfo: { label: "Deriverse" }, percent: 100 }],
  });
  await assert.rejects(request(fetcher), /route_plan_invalid/);
  assert.equal(seen.length, 1);
});

test("V1 canary rejects excessive price impact and wrong input scope", async () => {
  const { seen, fetcher } = fixture({ priceImpactPct: "0.050001" });
  await assert.rejects(request(fetcher), /price_impact_exceeded/);
  assert.equal(seen.length, 1);
  await assert.rejects(prepareJupiterV1CanarySwap({
    apiKey: "test-key", inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    amountAtomic: "2000000", taker: treasury.toBase58(), fetcher,
  }), /scope_invalid/);
  assert.equal(seen.length, 1);
});

test("V1 canary rejects changed signer, a pre-signed message, and invalid expiry", async () => {
  for (const swapOverride of [
    { swapTransaction: unsigned(other) },
    { swapTransaction: unsigned(treasury, true) },
    { lastValidBlockHeight: 0 },
  ]) {
    const { fetcher } = fixture({}, swapOverride);
    await assert.rejects(request(fetcher), /transaction_signer_invalid|blockheight_invalid/);
  }
});

test("V1 canary rejects a swap response whose advertised priority fee exceeds cap", async () => {
  const { fetcher } = fixture({}, { prioritizationFeeLamports: 400001 });
  await assert.rejects(request(fetcher), /priority_fee_exceeded/);
});
