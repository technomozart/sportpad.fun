import test from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram, Keypair, PublicKey, SystemProgram,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
  type SignatureStatus, type TokenBalance, type VersionedTransactionResponse,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import type { UnsignedSolToChzPlan } from "./jupiter-sol-chz-plan.ts";
import type { SignedSolanaPlan } from "./chiliz-solana-signing.ts";
import {
  verifyFinalizedSolToChzSwapReceipt, type ExpectedSolChzSwapReceipt,
  type SolChzReceiptRpc,
} from "./jupiter-sol-chz-receipt.ts";

const treasuryKey = Keypair.fromSeed(new Uint8Array(32).fill(61)); // test-only seed.
const treasury = treasuryKey.publicKey;
const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const outputAta = getAssociatedTokenAddressSync(mint, treasury, false, TOKEN_PROGRAM_ID);
const wrappedAta = getAssociatedTokenAddressSync(NATIVE_MINT, treasury, false, TOKEN_PROGRAM_ID);
const metis = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(62)).publicKey.toBase58();

function tokenRow(index: number, owner: PublicKey, rowMint: PublicKey, amount: string): TokenBalance {
  return {
    accountIndex: index, mint: rowMint.toBase58(), owner: owner.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    uiTokenAmount: { amount, decimals: 8, uiAmount: null, uiAmountString: amount },
  };
}

async function fixture(extraInstruction?: TransactionInstruction,
  extraMetisKeys: Array<{pubkey: PublicKey; isSigner: boolean; isWritable: boolean}> = []) {
  const ix = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    SystemProgram.transfer({ fromPubkey: treasury, toPubkey: wrappedAta, lamports: 10_000_000 }),
    new TransactionInstruction({ programId: metis, keys: [
      { pubkey: treasury, isSigner: true, isWritable: true },
      { pubkey: wrappedAta, isSigner: false, isWritable: true },
      { pubkey: outputAta, isSigner: false, isWritable: true },
      ...extraMetisKeys,
    ], data: Buffer.from([1, 2, 3]) }),
    ...(extraInstruction ? [extraInstruction] : []),
  ];
  const unsigned = new VersionedTransaction(new TransactionMessage({
    payerKey: treasury, recentBlockhash: blockhash, instructions: ix,
  }).compileToV0Message());
  const unsignedBase64 = Buffer.from(unsigned.serialize()).toString("base64");
  const messageBytes = new Uint8Array(unsigned.message.serialize());
  const signatureBytes = ed25519.sign(messageBytes, treasuryKey.secretKey.slice(0, 32));
  unsigned.addSignature(treasury, signatureBytes);
  const signedBytes = Buffer.from(unsigned.serialize());
  const sourceSignature = bs58.encode(signatureBytes);
  const messageHash = Buffer.from(await crypto.subtle.digest("SHA-256", messageBytes)).toString("hex");
  const signedHash = Buffer.from(await crypto.subtle.digest("SHA-256",
    new Uint8Array(signedBytes))).toString("hex");
  const plan: UnsignedSolToChzPlan = {
    transactionBase64: unsignedBase64,
    transactionMessageHash: messageHash,
    requestId: "journaled-jupiter-order",
    lastValidBlockHeight: 200,
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    inputAmountAtomic: "10000000",
    outputAmountAtomic: "6000000",
    minimumOutputAtomic: "4000000",
    priceImpactPercent: 0.1,
    router: "metis",
    sourceWallet: treasury.toBase58(),
    outputTokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    outputAta: outputAta.toBase58(),
    wrappedSolAta: wrappedAta.toBase58(),
    lookupTableAddresses: [],
    topLevelPrograms: ix.map((item) => item.programId.toBase58()),
    accountSlot: 100,
    simulationSlot: 101,
    simulationUnitsConsumed: 300_000,
    simulatedSolBeforeLamports: "100000000",
    simulatedSolAfterLamports: "89900000",
    simulatedSolDebitLamports: "10100000",
    simulatedOverheadLamports: "100000",
    simulatedChzBeforeAtomic: "100",
    simulatedChzAfterAtomic: "5000100",
    simulatedChzCreditAtomic: "5000000",
    recentBlockhash: blockhash,
    executionReady: false,
  };
  const signedPlan: SignedSolanaPlan<UnsignedSolToChzPlan> = {
    plan,
    signedTransactionBase64: signedBytes.toString("base64"),
    signedTransactionSha256: signedHash,
    transactionMessageHash: messageHash,
    sourceSignature,
    executionReady: false,
  };
  const expected: ExpectedSolChzSwapReceipt = {
    rewardTreasury: treasury.toBase58(), reservedInputLamports: "10000000",
    maximumSolDebitLamports: "15500000", minimumChzCreditAtomic: "4000000",
    providerRequestId: plan.requestId, transactionMessageHash: messageHash,
    signedTransactionSha256: signedHash, sourceSignature,
  };
  const keys = unsigned.message.staticAccountKeys;
  const outputIndex = keys.findIndex((key) => key.equals(outputAta));
  const wrappedIndex = keys.findIndex((key) => key.equals(wrappedAta));
  const preBalances = keys.map((_, index) => index === 0 ? 100_000_000 : index === outputIndex ? 1_000_000 : 0);
  const postBalances = keys.map((_, index) => index === 0 ? 89_900_000 : index === outputIndex ? 1_000_000 : 0);
  assert(wrappedIndex >= 0);
  const status = { slot: 123, confirmations: null, err: null,
    confirmationStatus: "finalized" } as SignatureStatus;
  const receipt = {
    slot: 123, version: 0,
    transaction: { message: unsigned.message, signatures: [sourceSignature] },
    meta: {
      err: null, fee: 5_000, preBalances, postBalances,
      loadedAddresses: { writable: [], readonly: [] },
      preTokenBalances: [tokenRow(outputIndex, treasury, mint, "100")],
      postTokenBalances: [tokenRow(outputIndex, treasury, mint, "5000100")],
    },
  } as unknown as VersionedTransactionResponse;
  return { signedPlan, expected, status, receipt, outputIndex, wrappedIndex };
}

function rpc(status: SignatureStatus, receipt: VersionedTransactionResponse): SolChzReceiptRpc {
  return {
    async getSignatureStatuses() { return { context: { slot: 124 }, value: [status] }; },
    async getTransaction() { return receipt; },
  } as unknown as SolChzReceiptRpc;
}

test("credits only exact finalized signed SOL debit and official CHZ ATA increase", async () => {
  const f = await fixture();
  const result = await verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc(f.status, f.receipt), signedPlan: f.signedPlan, expected: f.expected,
  });
  assert.equal(result.finalizedSlot, 123);
  assert.equal(result.actualSolDebitLamports, "10100000");
  assert.equal(result.actualChzCreditAtomic, "5000000");
  assert.equal(result.outputAta, outputAta.toBase58());
});

test("rejects wrong signed message, signature and nonfinalized result", async () => {
  const f = await fixture();
  await assert.rejects(verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc(f.status, f.receipt), signedPlan: f.signedPlan,
    expected: { ...f.expected, transactionMessageHash: "f".repeat(64) },
  }), /plan_not_bound_to_trusted_journal/);
  await assert.rejects(verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc({ ...f.status, confirmationStatus: "confirmed" }, f.receipt),
    signedPlan: f.signedPlan, expected: f.expected,
  }), /not_exact_finalized_transaction/);
  const changedReceipt = { ...f.receipt, transaction: {
    ...f.receipt.transaction, signatures: [bs58.encode(new Uint8Array(64).fill(7))],
  } } as VersionedTransactionResponse;
  await assert.rejects(verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc(f.status, changedReceipt), signedPlan: f.signedPlan, expected: f.expected,
  }), /not_exact_finalized_transaction/);
});

test("rejects excess treasury SOL debit or too little CHZ", async () => {
  const f = await fixture();
  const highDebit = { ...f.receipt, meta: { ...f.receipt.meta!,
    postBalances: f.receipt.meta!.postBalances.map((value, index) => index === 0 ? 80_000_000 : value),
  } } as VersionedTransactionResponse;
  await assert.rejects(verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc(f.status, highDebit), signedPlan: f.signedPlan, expected: f.expected,
  }), /treasury_sol_debit_out_of_bounds/);
  const lowOutput = { ...f.receipt, meta: { ...f.receipt.meta!,
    postTokenBalances: [tokenRow(f.outputIndex, treasury, mint, "101")],
  } } as VersionedTransactionResponse;
  await assert.rejects(verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc(f.status, lowOutput), signedPlan: f.signedPlan, expected: f.expected,
  }), /chz_credit_below_minimum/);
});

test("rejects an unexpected CHZ recipient or writable SOL output", async () => {
  const outsider = Keypair.fromSeed(new Uint8Array(32).fill(63)).publicKey;
  const otherAta = getAssociatedTokenAddressSync(mint, outsider, false, TOKEN_PROGRAM_ID);
  const f = await fixture(undefined, [{ pubkey: otherAta, isSigner: false, isWritable: true }]);
  const extraIndex = f.receipt.transaction.message.staticAccountKeys.findIndex(
    (key) => key.equals(otherAta));
  const withExtraOutput = { ...f.receipt, meta: { ...f.receipt.meta!,
    preTokenBalances: [...f.receipt.meta!.preTokenBalances!, tokenRow(extraIndex, outsider, mint, "0")],
    postTokenBalances: [...f.receipt.meta!.postTokenBalances!, tokenRow(extraIndex, outsider, mint, "100")],
  } } as VersionedTransactionResponse;
  await assert.rejects(verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc(f.status, withExtraOutput), signedPlan: f.signedPlan, expected: f.expected,
  }), /unexpected_other_chz_output/);
  const g = await fixture(undefined, [{ pubkey: outsider, isSigner: false, isWritable: true }]);
  const outsiderIndex = g.receipt.transaction.message.staticAccountKeys.findIndex(
    (key) => key.equals(outsider));
  const otherSolOutput = { ...g.receipt, meta: { ...g.receipt.meta!,
    postBalances: g.receipt.meta!.postBalances.map((value, index) =>
      index === outsiderIndex ? value + 100 : value),
  } } as VersionedTransactionResponse;
  await assert.rejects(verifyFinalizedSolToChzSwapReceipt({
    rpc: rpc(g.status, otherSolOutput), signedPlan: g.signedPlan, expected: g.expected,
  }), /unexpected_non_token_lamport_output/);
});
