import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { inspectBuybackOrder, inspectBuybackSettlement, inspectBuybackBurnReceipt } from "./buyback-safety.mjs";

const METIS = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const signer = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const outputAta = getAssociatedTokenAddressSync(mint, signer);
const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, signer);

function tokenAccount(mintKey, owner, amount = 0n) {
  const data = Buffer.alloc(165);
  mintKey.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return { owner: TOKEN_PROGRAM_ID, data, lamports: 2_039_280, executable: false, rentEpoch: 0 };
}

function rpc(overrides = {}) {
  return {
    async getMultipleAccountsInfo(keys) {
      return keys.map((key) => {
        if (key.equals(signer)) return { owner: SystemProgram.programId, data: Buffer.alloc(0), lamports: 1_000_000_000 };
        if (key.equals(outputAta)) return tokenAccount(mint, signer);
        if (key.equals(wrappedSolAta)) return tokenAccount(NATIVE_MINT, signer);
        return overrides[key.toBase58()] ?? null;
      });
    },
    async getFeeForMessage() { return { value: 10_000 }; },
    async getAddressLookupTable() { return { value: null }; },
    async simulateTransaction(_transaction, config) {
      assert.deepEqual(config.accounts.addresses, [signer.toBase58(), outputAta.toBase58()]);
      const output = tokenAccount(mint, signer, 995_000n);
      return { value: { err: null, accounts: [
        { owner: SystemProgram.programId.toBase58(), lamports: 949_990_000, data: ["", "base64"] },
        { owner: TOKEN_PROGRAM_ID.toBase58(), lamports: output.lamports,
          data: [output.data.toString("base64"), "base64"] },
      ] } };
    },
  };
}

function order(extraInstructions = [], options = {}) {
  const route = new TransactionInstruction({
    programId: METIS,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: outputAta, isSigner: false, isWritable: true },
      { pubkey: wrappedSolAta, isSigner: false, isWritable: true },
      ...(options.extraRouteKeys ?? []),
    ],
    data: Buffer.from([1, 2, 3]),
  });
  const message = new TransactionMessage({
    payerKey: options.payer ?? signer,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      SystemProgram.transfer({ fromPubkey: signer, toPubkey: wrappedSolAta, lamports: 50_000_000 }),
      createSyncNativeInstruction(wrappedSolAta),
      route,
      ...extraInstructions,
    ],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  return {
    router: "metis", inputMint: NATIVE_MINT.toBase58(), outputMint: mint.toBase58(),
    taker: signer.toBase58(), inAmount: "50000000", outAmount: "1000000",
    priceImpact: "0.1", requestId: "test-request",
    transaction: Buffer.from(transaction.serialize()).toString("base64"),
  };
}

function inspect(quote, connection = rpc()) {
  return inspectBuybackOrder({
    connection, quote, signer, mint, tokenProgram: TOKEN_PROGRAM_ID, amountLamports: "50000000",
  });
}

test("accepts a bounded Metis swap into the signer's SPORTPAD ATA", async () => {
  const result = await inspect(order());
  assert.equal(result.minOutput, 990_000n);
  assert.equal(result.maxDebit, 50_500_000n);
});

test("rejects a quote with a different output or an excessive trade amount", async () => {
  const wrongMint = { ...order(), outputMint: Keypair.generate().publicKey.toBase58() };
  await assert.rejects(inspect(wrongMint), /buyback_quote_mismatch/);
  await assert.rejects(inspectBuybackOrder({ connection: rpc(), quote: order(), signer, mint,
    tokenProgram: TOKEN_PROGRAM_ID, amountLamports: "500000000" }), /buyback_trade_cap_exceeded/);
});

test("rejects a malicious extra SOL transfer", async () => {
  const attacker = Keypair.generate().publicKey;
  const malicious = SystemProgram.transfer({ fromPubkey: signer, toPubkey: attacker, lamports: 1 });
  await assert.rejects(inspect(order([malicious])), /buyback_unexpected_sol_transfer/);
});

test("rejects aggregate wrapped-SOL transfers above the quoted input", async () => {
  const extra = SystemProgram.transfer({ fromPubkey: signer, toPubkey: wrappedSolAta, lamports: 1 });
  await assert.rejects(inspect(order([extra])), /buyback_sol_transfer_exceeded/);
});

test("rejects an unapproved top-level program", async () => {
  const ix = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([1]) });
  await assert.rejects(inspect(order([ix])), /buyback_unapproved_program/);
});

test("rejects a second signer", async () => {
  const other = Keypair.generate().publicKey;
  const ix = new TransactionInstruction({ programId: METIS,
    keys: [{ pubkey: other, isSigner: true, isWritable: false }], data: Buffer.from([1]) });
  await assert.rejects(inspect(order([ix])), /buyback_unexpected_signer/);
});

test("rejects an unexpected signer-owned writable token account", async () => {
  const other = Keypair.generate().publicKey;
  const quote = order([], { extraRouteKeys: [{ pubkey: other, isSigner: false, isWritable: true }] });
  await assert.rejects(inspect(quote, rpc({ [other.toBase58()]: tokenAccount(mint, signer) })),
    /buyback_unexpected_signer_token_account/);
});

test("rejects excessive transaction fees", async () => {
  const connection = rpc();
  connection.getFeeForMessage = async () => ({ value: 600_000 });
  await assert.rejects(inspect(order(), connection), /buyback_fee_unavailable_or_exceeded/);
});

test("rejects an unapproved writable account owner", async () => {
  const other = Keypair.generate().publicKey;
  const quote = order([], { extraRouteKeys: [{ pubkey: other, isSigner: false, isWritable: true }] });
  const account = { owner: Keypair.generate().publicKey, data: Buffer.alloc(16), lamports: 1 };
  await assert.rejects(inspect(quote, rpc({ [other.toBase58()]: account })),
    /buyback_unapproved_writable_owner/);
});

test("rejects a pre-sign simulation with too much SOL debit", async () => {
  const connection = rpc();
  const simulate = connection.simulateTransaction;
  connection.simulateTransaction = async (transaction, config) => {
    const result = await simulate(transaction, config);
    result.value.accounts[0].lamports = 900_000_000;
    return result;
  };
  await assert.rejects(inspect(order(), connection), /buyback_simulated_sol_debit_exceeded/);
});

test("rejects a simulation that omits requested post-state accounts", async () => {
  const connection = rpc();
  connection.simulateTransaction = async () => ({ value: { err: null, accounts: null } });
  await assert.rejects(inspect(order(), connection), /buyback_simulation_unavailable_or_failed/);
});

test("accepts only a confirmed matching settlement within the SOL cap", async () => {
  const inspection = await inspect(order());
  let outputIndex = -1;
  for (let i = 0; i < inspection.accountKeys.length; i += 1) {
    if (inspection.accountKeys.get(i).equals(outputAta)) outputIndex = i;
  }
  const row = (amount) => ({ accountIndex: outputIndex, mint: mint.toBase58(), owner: signer.toBase58(),
    uiTokenAmount: { amount: String(amount) } });
  const receipt = { meta: { err: null, preBalances: [1_000_000_000], postBalances: [949_990_000],
    preTokenBalances: [row(0)], postTokenBalances: [row(995_000)] } };
  assert.deepEqual(inspectBuybackSettlement(receipt, inspection), { purchased: 995_000n, debit: 50_010_000n });
  receipt.meta.postBalances[0] = 900_000_000;
  assert.throws(() => inspectBuybackSettlement(receipt, inspection), /buyback_actual_sol_debit_exceeded/);
  receipt.meta.postBalances[0] = 949_990_000;
  receipt.meta.postTokenBalances = [row(1)];
  assert.throws(() => inspectBuybackSettlement(receipt, inspection), /buyback_actual_output_below_minimum/);
});

test("verifies the exact token-account delta in the signed burn receipt", () => {
  const signature = "burn-signature";
  const row = (amount) => ({ accountIndex: 1, mint: mint.toBase58(), owner: signer.toBase58(),
    uiTokenAmount: { amount: String(amount) } });
  const receipt = { transaction: { signatures: [signature], message: { accountKeys: [signer, outputAta, mint] } },
    meta: { err: null, preTokenBalances: [row(995_000)], postTokenBalances: [row(0)] } };
  const expected = { signature, outputAta, mint, signer, amount: 995_000n };
  assert.deepEqual(inspectBuybackBurnReceipt(receipt, expected), { burned: 995_000n });
  receipt.meta.postTokenBalances = [row(1)];
  assert.throws(() => inspectBuybackBurnReceipt(receipt, expected), /buyback_burn_delta_mismatch/);
  receipt.meta.postTokenBalances = [row(0)];
  receipt.transaction.signatures[0] = "another-signature";
  assert.throws(() => inspectBuybackBurnReceipt(receipt, expected), /buyback_burn_not_confirmed/);
});
