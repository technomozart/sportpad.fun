import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";

import { executeJupiterSwap, prepareJupiterSwap } from "./jupiter-swap.ts";

function key(byte: number) {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
}

function orderFixture(overrides: Record<string, unknown> = {}) {
  const taker = key(1);
  const message = new TransactionMessage({
    payerKey: taker,
    recentBlockhash: key(9).toBase58(),
    instructions: [],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  return {
    inputMint: key(2).toBase58(),
    outputMint: key(3).toBase58(),
    inAmount: "1000000",
    outAmount: "2400000",
    otherAmountThreshold: "2376000",
    priceImpact: 0.12,
    swapMode: "ExactIn",
    slippageBps: 100,
    gasless: false,
    signatureFeePayer: taker.toBase58(),
    taker: taker.toBase58(),
    transaction: Buffer.from(transaction.serialize()).toString("base64"),
    requestId: "request-1",
    lastValidBlockHeight: 12345,
    router: "metis",
    ...overrides,
  };
}

test("accepts an exact unsigned Jupiter order", async () => {
  const fixture = orderFixture();
  const plan = await prepareJupiterSwap({
    apiKey: "test-key",
    inputMint: fixture.inputMint,
    outputMint: fixture.outputMint,
    amountAtomic: fixture.inAmount,
    taker: fixture.taker,
    fetcher: async () => Response.json(fixture),
  });
  assert.equal(plan.inputAmountAtomic, "1000000");
  assert.equal(plan.minimumOutputAtomic, "2376000");
  assert.equal(plan.transactionMessageHash.length, 64);
});

test("accepts the verified OKX router used by a live Fan Token route", async () => {
  const fixture = orderFixture({ router: "okx" });
  const plan = await prepareJupiterSwap({
    apiKey: "test-key",
    inputMint: fixture.inputMint,
    outputMint: fixture.outputMint,
    amountAtomic: fixture.inAmount,
    taker: fixture.taker,
    fetcher: async () => Response.json(fixture),
  });
  assert.equal(plan.router, "okx");
  await assert.rejects(() => prepareJupiterSwap({
    apiKey: "test-key",
    inputMint: fixture.inputMint,
    outputMint: fixture.outputMint,
    amountAtomic: fixture.inAmount,
    taker: fixture.taker,
    fetcher: async () => Response.json(orderFixture({ router: "unapproved" })),
  }), /routing policy/);
});

test("reports an unfunded Jupiter order before the fee-payer policy check", async () => {
  const fixture = orderFixture({ error: "Insufficient funds", signatureFeePayer: null });
  await assert.rejects(() => prepareJupiterSwap({
    apiKey: "test-key",
    inputMint: fixture.inputMint,
    outputMint: fixture.outputMint,
    amountAtomic: fixture.inAmount,
    taker: fixture.taker,
    fetcher: async () => Response.json(fixture),
  }), /insufficient SOL/);
});

test("rejects changed amounts, payers, and excessive price impact", async () => {
  const fixture = orderFixture();
  await assert.rejects(() => prepareJupiterSwap({
    apiKey: "test-key",
    inputMint: fixture.inputMint,
    outputMint: fixture.outputMint,
    amountAtomic: "999999",
    taker: fixture.taker,
    fetcher: async () => Response.json(fixture),
  }), /changed an exact swap constraint/);
  await assert.rejects(() => prepareJupiterSwap({
    apiKey: "test-key",
    inputMint: fixture.inputMint,
    outputMint: fixture.outputMint,
    amountAtomic: fixture.inAmount,
    taker: key(8).toBase58(),
    fetcher: async () => Response.json(fixture),
  }), /changed an exact swap constraint/);
  await assert.rejects(() => prepareJupiterSwap({
    apiKey: "test-key",
    inputMint: fixture.inputMint,
    outputMint: fixture.outputMint,
    amountAtomic: fixture.inAmount,
    taker: fixture.taker,
    fetcher: async () => Response.json(orderFixture({ priceImpact: 9 })),
  }), /price impact/);
});

test("accepts only a successful Jupiter execution response", async () => {
  const result = await executeJupiterSwap({
    apiKey: "test-key",
    signedTransactionBase64: "signed",
    requestId: "request-1",
    lastValidBlockHeight: 12345,
    fetcher: async () => Response.json({ status: "Success", signature: key(4).toBase58(), slot: 99, totalOutputAmount: "55" }),
  });
  assert.equal(result.outputAmountAtomic, "55");
  await assert.rejects(() => executeJupiterSwap({
    apiKey: "test-key",
    signedTransactionBase64: "signed",
    requestId: "request-1",
    lastValidBlockHeight: 12345,
    fetcher: async () => Response.json({ status: "Failed" }, { status: 422 }),
  }), /execution failed/);
});
