import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "buffer";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { REPLENISHMENT_ASSETS } from "./replenishment.ts";
import { inspectSolanaChzFundingOrder } from "./replenishment-swap-inspection.ts";
import type { JupiterSwapPlan } from "../server/providers/jupiter-swap.ts";

const signer = new PublicKey(Uint8Array.from({ length: 32 }, () => 1));
const other = new PublicKey(Uint8Array.from({ length: 32 }, () => 2));
const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const outputAta = getAssociatedTokenAddressSync(mint, signer, false, TOKEN_PROGRAM_ID);
const metis = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

function routeInstruction() {
  return new TransactionInstruction({
    programId: metis,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: outputAta, isSigner: false, isWritable: true },
    ],
    data: Buffer.alloc(0),
  });
}

function plan(instructions: TransactionInstruction[] = [routeInstruction()], overrides: Partial<JupiterSwapPlan> = {}) {
  const message = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: other.toBase58(),
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  return {
    transactionBase64: Buffer.from(transaction.serialize()).toString("base64"),
    transactionMessageHash: "a".repeat(64),
    requestId: "request-1",
    lastValidBlockHeight: 12345,
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    inputAmountAtomic: "1000000",
    outputAmountAtomic: "10000000",
    minimumOutputAtomic: "9900000",
    priceImpactPercent: 0.1,
    router: "metis",
    ...overrides,
  } satisfies JupiterSwapPlan;
}

test("static inspection explicitly withholds execution readiness and fee provenance", () => {
  const report = inspectSolanaChzFundingOrder(plan(), signer.toBase58());
  assert.equal(report.executionReady, false);
  assert.equal(report.maximumInputLamports, "100000000");
  assert.equal(report.officialChzMint, REPLENISHMENT_ASSETS.solanaChzMint);
  assert.equal(report.instructionCount, 1);
  assert.deepEqual(report.lookupTableAddresses, []);
  assert.ok(report.blockers.some((blocker) => blocker.includes("reconciled 80% fee")));
  assert.ok(report.blockers.some((blocker) => blocker.includes("simulated")));
});

test("rejects an over-cap or wrong-mint SOL to CHZ order", () => {
  assert.throws(() => inspectSolanaChzFundingOrder(
    plan(undefined, { inputAmountAtomic: "100000001" }), signer.toBase58()), /input_cap_exceeded/);
  assert.throws(() => inspectSolanaChzFundingOrder(
    plan(undefined, { outputMint: other.toBase58() }), signer.toBase58()), /route_mismatch/);
  assert.throws(() => inspectSolanaChzFundingOrder(
    plan(undefined, { router: "okx" }), signer.toBase58()), /route_mismatch/);
});

test("rejects extra SOL transfers and arbitrary top-level programs", () => {
  const diverted = SystemProgram.transfer({ fromPubkey: signer, toPubkey: other, lamports: 1 });
  assert.throws(() => inspectSolanaChzFundingOrder(
    plan([diverted, routeInstruction()]), signer.toBase58()), /unexpected_sol_transfer/);
  const arbitrary = new TransactionInstruction({ programId: other, keys: [], data: Buffer.alloc(0) });
  assert.throws(() => inspectSolanaChzFundingOrder(
    plan([arbitrary, routeInstruction()]), signer.toBase58()), /unapproved_program/);
});

test("rejects a transaction for another signer or with a second signer", () => {
  assert.throws(() => inspectSolanaChzFundingOrder(plan(), other.toBase58()), /unexpected_signer/);
  const extraSigner = new TransactionInstruction({
    programId: metis,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: other, isSigner: true, isWritable: false },
      { pubkey: outputAta, isSigner: false, isWritable: true },
    ],
    data: Buffer.alloc(0),
  });
  assert.throws(() => inspectSolanaChzFundingOrder(
    plan([extraSigner]), signer.toBase58()), /unexpected_signer/);
});

test("unresolved address lookup accounts remain explicit blockers", () => {
  const table = new AddressLookupTableAccount({
    key: new PublicKey(Uint8Array.from({ length: 32 }, () => 3)),
    state: {
      deactivationSlot: 18_446_744_073_709_551_615n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [outputAta],
    },
  });
  const message = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: other.toBase58(),
    instructions: [routeInstruction()],
  }).compileToV0Message([table]);
  assert.equal(message.addressTableLookups.length, 1);
  const transaction = new VersionedTransaction(message);
  const report = inspectSolanaChzFundingOrder(plan(undefined, {
    transactionBase64: Buffer.from(transaction.serialize()).toString("base64"),
  }), signer.toBase58());
  assert.equal(report.executionReady, false);
  assert.equal(report.lookupTableAddresses.length, 1);
  assert.ok(report.blockers.some((blocker) => blocker.includes("not been resolved")));
});
