import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Buffer } from "buffer";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, type Account } from "@solana/spl-token";
import {
  Keypair, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction, type Connection, type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";

import { feeEventId } from "../protocol/accounting.ts";
import { REPLENISHMENT_ASSETS } from "../protocol/replenishment.ts";
import type { JupiterSwapPlan } from "./providers/jupiter-swap.ts";
import { reserveChilizFeeShare } from "./chiliz-fee-reservations.ts";
import {
  FINALIZE_CHILIZ_SOL_CHZ_SWAP_SQL,
  finalizedChilizSolChzSwapBindings,
  EXPIRE_UNBROADCAST_CHILIZ_SOL_CHZ_SWAP_SQL,
  INSERT_PREPARED_CHILIZ_SOL_CHZ_SWAP_SQL,
  inspectPreparedSwapExpiry,
  inspectFinalizedChilizSolChzSwap,
  MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL,
  nextChilizSolChzSwapChunk,
  prepareChilizSolChzSwapIntent,
  preparedChilizSolChzSwapBindings,
  type PersistedChilizSolChzSwap,
} from "./chiliz-sol-chz-swap-journal.ts";

const signer = Keypair.generate();
const wallet = signer.publicKey.toBase58();
const sourceSignature = "1".repeat(64);
const eventId = feeEventId(sourceSignature, 0);
const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const ata = getAssociatedTokenAddressSync(mint, signer.publicKey, false, TOKEN_PROGRAM_ID);
const metis = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const inputLamports = "1000000";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT,
      reward_bps INTEGER, buyback_bps INTEGER, status TEXT,
      mainnet_verified_at TEXT, mainnet_mint TEXT,
      mainnet_reward_treasury TEXT, mainnet_fee_slot INTEGER);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT,
      source_signature TEXT, instruction_index INTEGER, source_slot INTEGER,
      gross_amount_atomic TEXT, state TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      reward_amount_atomic TEXT, buyback_amount_atomic TEXT,
      reward_spent_atomic TEXT, reward_swap_signature TEXT, state TEXT);
    CREATE TABLE reward_swap_batch_sources (settlement_id TEXT);
    CREATE TABLE settlement_steps (settlement_id TEXT, stage TEXT, state TEXT);
    CREATE TABLE transaction_intents (settlement_id TEXT, action TEXT);
    CREATE TABLE automation_jobs (entity_type TEXT, entity_id TEXT, job_type TEXT);
    INSERT INTO launch_drafts VALUES
      ('launch-chiliz', 'chiliz', 8000, 2000, 'mainnet_published',
        '2026-09-25', 'COMMUNITY_MINT', '${wallet}', 99);
    INSERT INTO fee_events VALUES
      ('${eventId}', 'launch-chiliz', '${sourceSignature}', 0, 100, '1250000', 'reconciled');
    INSERT INTO settlements VALUES
      ('settlement:${eventId}', '${eventId}', '${inputLamports}', '250000', '0', NULL, 'reconciled');
  `);
  for (const path of ["../../drizzle/0027_glossy_agent_zero.sql",
    "../../drizzle/0028_confused_epoch.sql"]) {
    const migration = readFileSync(new URL(path, import.meta.url), "utf8");
    db.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return db;
}

function d1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const statement = database.prepare(sql);
          const bindings = args as (string | number | bigint | null | Uint8Array)[];
          return {
            async run() { return { meta: { changes: statement.run(...bindings).changes } }; },
            async first<T>() { return (statement.get(...bindings) ?? null) as T | null; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function order(amount = inputLamports, requestId = "request-intent-1") {
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [new TransactionInstruction({
      programId: metis,
      keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true }],
      data: Buffer.alloc(0),
    })],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const unsignedTransactionBase64 = Buffer.from(transaction.serialize()).toString("base64");
  transaction.sign([signer]);
  const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString("base64");
  const plan: JupiterSwapPlan = {
    transactionBase64: unsignedTransactionBase64,
    transactionMessageHash: createHash("sha256").update(message.serialize()).digest("hex"),
    requestId,
    lastValidBlockHeight: 12345,
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    inputAmountAtomic: amount,
    outputAmountAtomic: "10000000",
    minimumOutputAtomic: "9900000",
    priceImpactPercent: 0.1,
    router: "metis",
  };
  return { transaction, plan, signedTransactionBase64 };
}

function readAccount(_connection: Connection, address: PublicKey) {
  return Promise.resolve({ address, owner: signer.publicKey, mint, amount: 0n,
    isInitialized: true, isFrozen: false, delegate: null,
    closeAuthority: null } as Account);
}

async function prepared(db: DatabaseSync) {
  const reserved = await reserveChilizFeeShare(d1(db), {
    feeEventId: eventId, launchId: "launch-chiliz", rewardTreasury: wallet,
  });
  const chunk = await nextChilizSolChzSwapChunk(d1(db), reserved.reservation);
  assert.ok(chunk);
  const quote = order(chunk.inputLamports, `request-intent-${chunk.sequence + 1}-${chunk.attempt}`);
  const intent = await prepareChilizSolChzSwapIntent({
    reservation: reserved.reservation,
    chunk,
    plan: quote.plan,
    signedTransactionBase64: quote.signedTransactionBase64,
    tokenProgram: TOKEN_PROGRAM_ID,
    connection: {} as Connection,
    readAccount,
  });
  db.prepare(INSERT_PREPARED_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(...preparedChilizSolChzSwapBindings(intent));
  return { intent, transaction: quote.transaction };
}

function receipt(intent: PersistedChilizSolChzSwap, transaction: VersionedTransaction,
  options: { failed?: boolean; wrongSignature?: boolean; output?: bigint } = {}) {
  const outputIndex = transaction.message.staticAccountKeys.findIndex((key) => key.equals(ata));
  assert.ok(outputIndex >= 0);
  const beforeSol = 500_000_000;
  const afterSol = beforeSol - (options.failed ? 5_000 : Number(intent.inputAmountLamports) + 5_000);
  const beforeChz = 100n;
  const afterChz = beforeChz + (options.output ?? (options.failed ? 0n : 10_000_000n));
  const entry = (amount: bigint) => ({ accountIndex: outputIndex,
    mint: intent.outputMint, owner: intent.sourceWallet,
    uiTokenAmount: { amount: amount.toString(), decimals: 8, uiAmount: Number(amount) / 1e8,
      uiAmountString: (Number(amount) / 1e8).toString() },
  });
  const error = options.failed ? { InstructionError: [0, "Custom"] } : null;
  const chainReceipt = {
    slot: 200,
    transaction: { signatures: [options.wrongSignature ? "different" : intent.sourceSignature],
      message: transaction.message },
    meta: { err: error, loadedAddresses: { writable: [], readonly: [] },
      preBalances: [beforeSol], postBalances: [afterSol],
      preTokenBalances: [entry(beforeChz)], postTokenBalances: [entry(afterChz)] },
  } as unknown as VersionedTransactionResponse;
  const status = { slot: 200, confirmationStatus: "finalized", err: error,
    confirmations: null } as SignatureStatus;
  return { chainReceipt, status };
}

test("persists one signed, cryptographically bound swap intent before any broadcast", async () => {
  const db = fixture();
  const { intent } = await prepared(db);
  assert.equal(intent.inputAmountLamports, inputLamports);
  assert.equal(intent.outputAta, ata.toBase58());
  assert.equal((db.prepare("SELECT state FROM chiliz_sol_chz_swap_journal").get() as { state: string }).state,
    "prepared");
  assert.throws(() => db.prepare(INSERT_PREPARED_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(...preparedChilizSolChzSwapBindings(intent)),
  /chiliz_sol_chz_swap_unbound_intent|UNIQUE constraint failed/);
  assert.throws(() => db.prepare("UPDATE chiliz_sol_chz_swap_journal SET source_signature='changed'").run(),
    /chiliz_sol_chz_swap_invalid_transition/);
  assert.throws(() => db.prepare("UPDATE chiliz_sol_chz_swap_journal SET state='finalized_success'").run(),
    /chiliz_sol_chz_swap_invalid_transition/);
  db.close();
});

test("requires a pre-existing finalized treasury CHZ ATA and the exact signed order", async () => {
  const db = fixture();
  const { reservation } = await reserveChilizFeeShare(d1(db), {
    feeEventId: eventId, launchId: "launch-chiliz", rewardTreasury: wallet,
  });
  const quote = order();
  const chunk = await nextChilizSolChzSwapChunk(d1(db), reservation);
  assert.ok(chunk);
  const base = { reservation, plan: quote.plan,
    chunk,
    signedTransactionBase64: quote.signedTransactionBase64,
    tokenProgram: TOKEN_PROGRAM_ID, connection: {} as Connection };
  await assert.rejects(() => prepareChilizSolChzSwapIntent({ ...base,
    readAccount: async () => { throw new Error("missing"); } }), /output_ata_not_preprovisioned/);
  await assert.rejects(() => prepareChilizSolChzSwapIntent({ ...base,
    plan: { ...quote.plan, inputAmountAtomic: "999999" }, readAccount }), /reservation_order_mismatch/);
  await assert.rejects(() => prepareChilizSolChzSwapIntent({ ...base,
    signedTransactionBase64: order().signedTransactionBase64, readAccount }), /signed_message_mismatch/);
  db.close();
});

test("marks broadcast ambiguity one way, then records exact finalized success deltas", async () => {
  const db = fixture();
  const { intent, transaction } = await prepared(db);
  assert.equal(db.prepare(MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL)
    .run(intent.id, intent.sourceSignature, 1000, 12344).changes, 1);
  assert.equal(db.prepare(MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL)
    .run(intent.id, intent.sourceSignature, 1001, 12344).changes, 0);
  const { chainReceipt, status } = receipt({ ...intent, state: "broadcast_unknown" }, transaction);
  const proof = await inspectFinalizedChilizSolChzSwap({
    intent: { ...intent, state: "broadcast_unknown" }, receipt: chainReceipt, status,
  });
  assert.equal(proof.outputAmountAtomic, "10000000");
  assert.equal(db.prepare(FINALIZE_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(...finalizedChilizSolChzSwapBindings({ ...intent, state: "broadcast_unknown" }, proof)).changes, 1);
  assert.equal((db.prepare("SELECT state FROM chiliz_sol_chz_swap_journal").get() as { state: string }).state,
    "finalized_success");
  assert.throws(() => db.prepare("UPDATE chiliz_sol_chz_swap_journal SET state='prepared'").run(),
    /chiliz_sol_chz_swap_invalid_transition/);
  db.close();
});

test("a finalized failed attempt permits one exact replacement, not an overlapping chunk", async () => {
  const db = fixture();
  const { intent, transaction } = await prepared(db);
  db.prepare(MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL)
    .run(intent.id, intent.sourceSignature, 1000, 12344);
  const { chainReceipt, status } = receipt({ ...intent, state: "broadcast_unknown" }, transaction,
    { failed: true });
  const proof = await inspectFinalizedChilizSolChzSwap({
    intent: { ...intent, state: "broadcast_unknown" }, receipt: chainReceipt, status,
  });
  assert.equal(proof.state, "finalized_failure");
  assert.equal(proof.outputAmountAtomic, "0");
  assert.equal(db.prepare(FINALIZE_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(...finalizedChilizSolChzSwapBindings({ ...intent, state: "broadcast_unknown" }, proof)).changes, 1);
  const retry = await prepared(db);
  assert.equal(retry.intent.chunkSequence, 0);
  assert.equal(retry.intent.attemptSequence, 1);
  assert.equal(retry.intent.chunkOffsetLamports, "0");
  assert.equal(retry.intent.inputAmountLamports, intent.inputAmountLamports);
  assert.throws(() => db.exec("DELETE FROM chiliz_sol_chz_swap_journal"),
    /chiliz_sol_chz_swap_immutable/);
  db.close();
});

test("an unbroadcast expired order can be retired with finalized height, then retried", async () => {
  const db = fixture();
  const { intent } = await prepared(db);
  await assert.rejects(() => inspectPreparedSwapExpiry({
    intent: { ...intent, state: "prepared" }, connection: {} as Connection,
    readFinalizedBlockHeight: async () => 12345,
  }), /expiry_not_finalized/);
  const height = await inspectPreparedSwapExpiry({
    intent: { ...intent, state: "prepared" }, connection: {} as Connection,
    readFinalizedBlockHeight: async () => 12346,
  });
  assert.equal(db.prepare(EXPIRE_UNBROADCAST_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(intent.id, intent.sourceSignature, height).changes, 1);
  assert.equal(db.prepare(MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL)
    .run(intent.id, intent.sourceSignature, 1000, 12344).changes, 0);
  const retry = await prepared(db);
  assert.equal(retry.intent.attemptSequence, 1);
  assert.equal(retry.intent.chunkSequence, 0);
  assert.equal(db.prepare(EXPIRE_UNBROADCAST_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(retry.intent.id, retry.intent.sourceSignature, 12345).changes, 0);
  db.close();
});

test("three expired attempts exhaust the retry budget without spending reserved SOL", async () => {
  const db = fixture();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { intent } = await prepared(db);
    assert.equal(intent.attemptSequence, attempt);
    assert.equal(db.prepare(EXPIRE_UNBROADCAST_CHILIZ_SOL_CHZ_SWAP_SQL)
      .run(intent.id, intent.sourceSignature, 12346).changes, 1);
  }
  const { reservation } = await reserveChilizFeeShare(d1(db), {
    feeEventId: eventId, launchId: "launch-chiliz", rewardTreasury: wallet,
  });
  await assert.rejects(() => nextChilizSolChzSwapChunk(d1(db), reservation),
    /retry_budget_exhausted/);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM chiliz_sol_chz_swap_journal
    WHERE state='finalized_success'`).get() as { n: number }).n, 0);
  db.close();
});

test("an ambiguous broadcast cannot be expired or replaced without an exact final receipt", async () => {
  const db = fixture();
  const { intent } = await prepared(db);
  db.prepare(MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL)
    .run(intent.id, intent.sourceSignature, 1000, 12344);
  assert.equal(db.prepare(EXPIRE_UNBROADCAST_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(intent.id, intent.sourceSignature, 12346).changes, 0);
  const { reservation } = await reserveChilizFeeShare(d1(db), {
    feeEventId: eventId, launchId: "launch-chiliz", rewardTreasury: wallet,
  });
  await assert.rejects(() => nextChilizSolChzSwapChunk(d1(db), reservation),
    /prior_chunk_unresolved/);
  db.close();
});

test("rejects wrong signature, nonfinality, output under minimum, and forged finalization fields", async () => {
  const db = fixture();
  const { intent, transaction } = await prepared(db);
  db.prepare(MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL)
    .run(intent.id, intent.sourceSignature, 1000, 12344);
  const pending = { ...intent, state: "broadcast_unknown" } as const;
  const wrong = receipt(pending, transaction, { wrongSignature: true });
  await assert.rejects(() => inspectFinalizedChilizSolChzSwap({ intent: pending,
    receipt: wrong.chainReceipt, status: wrong.status }), /finality_or_identity_unverified/);
  await assert.rejects(() => inspectFinalizedChilizSolChzSwap({ intent: pending,
    receipt: { ...wrong.chainReceipt,
      transaction: { ...wrong.chainReceipt.transaction, signatures: [intent.sourceSignature] } },
    status: { ...wrong.status, confirmationStatus: "confirmed" } }),
  /finality_or_identity_unverified/);
  const low = receipt(pending, transaction, { output: 1n });
  await assert.rejects(() => inspectFinalizedChilizSolChzSwap({ intent: pending,
    receipt: low.chainReceipt, status: low.status }), /finalized_balance_delta_mismatch/);
  const valid = receipt(pending, transaction);
  const proof = await inspectFinalizedChilizSolChzSwap({ intent: pending,
    receipt: valid.chainReceipt, status: valid.status });
  assert.throws(() => db.prepare(FINALIZE_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(...finalizedChilizSolChzSwapBindings(pending, { ...proof,
      outputAmountAtomic: "1" })), /chiliz_sol_chz_swap_invalid_transition/);
  db.close();
});

test("splits a large 80% fee share into sequential capped chunks with exact conservation", async () => {
  const db = fixture();
  db.exec(`UPDATE fee_events SET gross_amount_atomic='312500000';
    UPDATE settlements SET reward_amount_atomic='250000000', buyback_amount_atomic='62500000'`);
  const recorded: { sequence: number; offset: string; input: string }[] = [];
  for (let index = 0; index < 3; index += 1) {
    const { intent, transaction } = await prepared(db);
    recorded.push({ sequence: intent.chunkSequence,
      offset: intent.chunkOffsetLamports, input: intent.inputAmountLamports });
    const reservation = await reserveChilizFeeShare(d1(db), {
      feeEventId: eventId, launchId: "launch-chiliz", rewardTreasury: wallet,
    });
    await assert.rejects(() => nextChilizSolChzSwapChunk(d1(db), reservation.reservation),
      /prior_chunk_unresolved/);
    db.prepare(MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL)
      .run(intent.id, intent.sourceSignature, 1000 + index, 12344);
    const { chainReceipt, status } = receipt({ ...intent, state: "broadcast_unknown" }, transaction);
    const proof = await inspectFinalizedChilizSolChzSwap({
      intent: { ...intent, state: "broadcast_unknown" }, receipt: chainReceipt, status,
    });
    db.prepare(FINALIZE_CHILIZ_SOL_CHZ_SWAP_SQL)
      .run(...finalizedChilizSolChzSwapBindings({ ...intent, state: "broadcast_unknown" }, proof));
  }
  assert.deepEqual(recorded, [
    { sequence: 0, offset: "0", input: "100000000" },
    { sequence: 1, offset: "100000000", input: "100000000" },
    { sequence: 2, offset: "200000000", input: "50000000" },
  ]);
  const reservation = await reserveChilizFeeShare(d1(db), {
    feeEventId: eventId, launchId: "launch-chiliz", rewardTreasury: wallet,
  });
  assert.equal(await nextChilizSolChzSwapChunk(d1(db), reservation.reservation), null);
  assert.equal((db.prepare(`SELECT SUM(CAST(input_amount_lamports AS INTEGER)) AS total
    FROM chiliz_sol_chz_swap_journal`).get() as { total: number }).total, 250_000_000);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_sol_chz_swap_journal").get() as { n: number }).n, 3);
  db.close();
});

test("database rejects an overlapping or out-of-order next chunk", async () => {
  const db = fixture();
  db.exec(`UPDATE fee_events SET gross_amount_atomic='312500000';
    UPDATE settlements SET reward_amount_atomic='250000000', buyback_amount_atomic='62500000'`);
  const { intent } = await prepared(db);
  const copied = { ...intent, id: `chiliz:sol-chz:${intent.reservationId}:1:0`,
    chunkSequence: 1, chunkOffsetLamports: "100000000", providerRequestId: "request-other",
    sourceSignature: "2".repeat(64),
    signedTransactionSha256: "b".repeat(64) };
  assert.throws(() => db.prepare(INSERT_PREPARED_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(...preparedChilizSolChzSwapBindings(copied)), /chiliz_sol_chz_swap_unbound_intent/);
  const duplicate = { ...copied, id: intent.id, chunkSequence: 0,
    chunkOffsetLamports: "0", providerRequestId: "request-concurrent" };
  assert.throws(() => db.prepare(INSERT_PREPARED_CHILIZ_SOL_CHZ_SWAP_SQL)
    .run(...preparedChilizSolChzSwapBindings(duplicate)),
  /chiliz_sol_chz_swap_unbound_intent|UNIQUE constraint failed/);
  db.close();
});
