import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Keypair, SystemProgram, TransactionMessage,
  VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

import {
  ARM_PUMP_FEE_COLLECTION_POLICY_SQL,
  PAUSE_PUMP_FEE_COLLECTION_POLICY_SQL,
  INSERT_PAUSED_PUMP_FEE_COLLECTION_POLICY_SQL,
  INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL,
  SELECT_VERIFIED_PUMP_FEE_COLLECTION_SQL,
  MARK_PUMP_FEE_COLLECTION_BROADCAST_SQL,
  HOLD_PUMP_FEE_COLLECTION_SQL,
  FINALIZE_PUMP_FEE_COLLECTION_SQL,
  EXPIRE_PUMP_FEE_COLLECTION_SQL,
  createPreparedPumpFeeCollectionIntent,
  pumpFeeCollectionInsertBindings,
} from "./fee-collection-journal.ts";

const collector = Keypair.generate();
const creator = Keypair.generate();
const reward = Keypair.generate().publicKey.toBase58();
const buyback = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const launchId = "fee_launch_1";
const anchor = bs58.encode(Uint8Array.from({ length: 64 }, (_, index) => index + 1));
const nowMs = 1_800_000_000_000;

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(`CREATE TABLE launch_drafts (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, mainnet_verified_at TEXT,
    mainnet_mint TEXT, mainnet_reward_treasury TEXT,
    mainnet_buyback_treasury TEXT, mainnet_creator_wallet TEXT
  );`);
  db.exec(readFileSync(new URL("../../../drizzle/0026_pump_fee_collection_journal.sql",
    import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  db.prepare(`INSERT INTO launch_drafts
    (id, status, mainnet_verified_at, mainnet_mint,
      mainnet_reward_treasury, mainnet_buyback_treasury, mainnet_creator_wallet)
    VALUES (?1, 'mainnet_published', '2026-09-24', ?2, ?3, ?4, ?5)`)
    .run(launchId, mint, reward, buyback, creator.publicKey.toBase58());
  return db;
}

function signedTransaction(keypair = collector) {
  // Harmless self transfer proves signature parsing only. It must remain
  // unverified and unbroadcastable until a future exact Pump V2 verifier.
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: keypair.publicKey,
      toPubkey: keypair.publicKey, lamports: 1 })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
}

async function intent(id = "collection_1", keypair = collector) {
  return createPreparedPumpFeeCollectionIntent({
    id, launchId, mint, collectorSigner: collector.publicKey.toBase58(),
    rewardTreasury: reward, buybackTreasury: buyback,
    lastValidBlockHeight: 1234, historyAnchorSignature: anchor,
    signedTransactionBase64: signedTransaction(keypair),
  });
}

function insertPolicy(db: DatabaseSync) {
  assert.equal(db.prepare(INSERT_PAUSED_PUMP_FEE_COLLECTION_POLICY_SQL)
    .run(launchId, mint, collector.publicKey.toBase58(), reward, buyback).changes, 1);
}

test("signed bytes are validated, but their instruction effects remain unverified", async () => {
  const prepared = await intent();
  assert.equal(prepared.collectorSigner, collector.publicKey.toBase58());
  assert.equal(prepared.instructionEffectState, "unverified");
  assert.equal(prepared.signedTransactionSha256.length, 64);
  assert.equal(prepared.recentBlockhash.length >= 32, true);
  await assert.rejects(() => intent("wrong_signer", Keypair.generate()),
    /fee_collection_signature_invalid/);
  await assert.rejects(() => createPreparedPumpFeeCollectionIntent({
    id: "same_treasury", launchId, mint,
    collectorSigner: reward, rewardTreasury: reward, buybackTreasury: buyback,
    lastValidBlockHeight: 1234, historyAnchorSignature: anchor,
    signedTransactionBase64: signedTransaction(),
  }), /dedicated_signer_invalid/);
  const tampered = Buffer.from(prepared.signedTransactionBase64, "base64");
  tampered[80] ^= 1;
  await assert.rejects(() => createPreparedPumpFeeCollectionIntent({
    id: "tampered", launchId, mint,
    collectorSigner: collector.publicKey.toBase58(),
    rewardTreasury: reward, buybackTreasury: buyback,
    lastValidBlockHeight: 1234, historyAnchorSignature: anchor,
    signedTransactionBase64: tampered.toString("base64"),
  }), /fee_collection_signature_invalid/);
});

test("policy is unseeded and paused, dedicated signer and one unresolved intent are enforced", async () => {
  const db = fixture();
  try {
    const prepared = await intent();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pump_fee_collection_policies")
      .get()?.n, 0);
    assert.throws(() => db.prepare(INSERT_PAUSED_PUMP_FEE_COLLECTION_POLICY_SQL)
      .run(launchId, mint, reward, reward, buyback),
    /CHECK constraint failed|policy_ineligible/);
    insertPolicy(db);
    assert.throws(() => db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(prepared)), /intent_ineligible/);
    assert.equal(db.prepare(ARM_PUMP_FEE_COLLECTION_POLICY_SQL).run(launchId).changes, 1);
    assert.equal(db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(prepared)).changes, 1);
    assert.equal(db.prepare(SELECT_VERIFIED_PUMP_FEE_COLLECTION_SQL)
      .get(prepared.id), undefined);
    assert.equal(db.prepare(MARK_PUMP_FEE_COLLECTION_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs, 1200).changes, 0);
    const second = await intent("collection_2");
    assert.throws(() => db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(second)), /UNIQUE constraint failed/);
    assert.throws(() => db.exec("UPDATE pump_fee_collection_intents SET reward_treasury='redirected'"),
      /intent_immutable/);
    assert.throws(() => db.exec("DELETE FROM pump_fee_collection_intents"), /intent_no_delete/);
    assert.throws(() => db.exec("UPDATE pump_fee_collection_policies SET collector_signer='redirected'"),
      /policy_identity_immutable/);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});

test("arbitrary JSON cannot attest effects, reveal raw bytes, or mark broadcast", async () => {
  const db = fixture();
  try {
    const prepared = await intent();
    insertPolicy(db);
    db.prepare(ARM_PUMP_FEE_COLLECTION_POLICY_SQL).run(launchId);
    db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(prepared));
    const selfReported = JSON.stringify({ exactInstructionsVerified: true,
      simulationSucceeded: true, sourceSignature: prepared.sourceSignature,
      signedTransactionSha256: prepared.signedTransactionSha256,
      mint, collectorSigner: collector.publicKey.toBase58(),
      rewardTreasury: reward, buybackTreasury: buyback,
      rewardBps: 8000, buybackBps: 2000, verifiedSlot: 1000 });
    assert.throws(() => db.prepare(`UPDATE pump_fee_collection_intents
      SET instruction_effect_state = 'verified', instruction_evidence_json = ?1
      WHERE id = ?2`).run(selfReported, prepared.id), /effect_unverified/);
    const forged = await intent("forged");
    assert.throws(() => db.prepare(`INSERT INTO pump_fee_collection_intents
      (id, launch_id, mint, collector_signer, reward_treasury,
        buyback_treasury, recent_blockhash, last_valid_block_height,
        history_anchor_signature, signed_transaction_base64,
        signed_transaction_sha256, source_signature,
        instruction_effect_state, instruction_evidence_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
        'verified', ?13)`)
      .run(...pumpFeeCollectionInsertBindings(forged),
        selfReported), /intent_ineligible/);
    assert.equal(db.prepare(SELECT_VERIFIED_PUMP_FEE_COLLECTION_SQL)
      .get(prepared.id), undefined);
    assert.equal(db.prepare(MARK_PUMP_FEE_COLLECTION_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs, 1200).changes, 0);
    assert.equal(db.prepare(PAUSE_PUMP_FEE_COLLECTION_POLICY_SQL)
      .run(launchId).changes, 1);
    assert.equal(db.prepare(SELECT_VERIFIED_PUMP_FEE_COLLECTION_SQL)
      .get(prepared.id), undefined);
    assert.equal(db.prepare(MARK_PUMP_FEE_COLLECTION_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs, 1200).changes, 0);
    assert.equal(db.prepare(HOLD_PUMP_FEE_COLLECTION_SQL)
      .run(prepared.id, prepared.sourceSignature).changes, 0);
    assert.throws(() => db.exec("UPDATE pump_fee_collection_intents SET state='broadcast_attempted'"),
      /state_shape/);
  } finally { db.close(); }
});

test("one unresolved intent blocks recurrence until explicit expired absence proof", async () => {
  const db = fixture();
  try {
    insertPolicy(db);
    db.prepare(ARM_PUMP_FEE_COLLECTION_POLICY_SQL).run(launchId);
    const first = await intent();
    db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(first));
    const second = await intent("collection_2");
    assert.throws(() => db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(second)), /UNIQUE constraint failed/);
    assert.equal(db.prepare(FINALIZE_PUMP_FEE_COLLECTION_SQL)
      .run(first.id, first.sourceSignature, 1001, "{}").changes, 0);
    const expiry = JSON.stringify({ finalized: true, blockhashValid: false,
      transactionAbsent: true, finalizedHistoryCoversAnchor: true,
      sourceSignature: first.sourceSignature, historyAnchorSignature: anchor,
      recentBlockhash: first.recentBlockhash,
      lastValidBlockHeight: 1234, observedBlockHeight: 1235 });
    assert.equal(db.prepare(EXPIRE_PUMP_FEE_COLLECTION_SQL)
      .run(first.id, first.sourceSignature, 1234, expiry).changes, 0);
    assert.equal(db.prepare(EXPIRE_PUMP_FEE_COLLECTION_SQL)
      .run(first.id, first.sourceSignature, 1235,
        `${expiry.slice(0, -1)},"transactionAbsent":false}`).changes, 0);
    assert.equal(db.prepare(EXPIRE_PUMP_FEE_COLLECTION_SQL)
      .run(first.id, first.sourceSignature, 1235, expiry).changes, 1);
    assert.equal(db.prepare(EXPIRE_PUMP_FEE_COLLECTION_SQL)
      .run(first.id, first.sourceSignature, 1236, expiry).changes, 0);
    assert.equal(db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(second)).changes, 1);
    const third = await intent("collection_3");
    assert.throws(() => db.prepare(INSERT_PREPARED_PUMP_FEE_COLLECTION_SQL)
      .run(...pumpFeeCollectionInsertBindings(third)), /UNIQUE constraint failed/);
    assert.throws(() => db.exec("UPDATE pump_fee_collection_intents SET state='held' WHERE id='collection_2'"),
      /state_transition|state_shape/);
    assert.throws(() => db.exec("UPDATE pump_fee_collection_intents SET state='finalized' WHERE id='collection_2'"),
      /state_transition|state_shape/);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});

test("all additive migrations replay to the fee journal with healthy constraints", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const migrationDir = new URL("../../../drizzle/", import.meta.url);
    const migrations = readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    assert.equal(migrations.at(-1), "0026_pump_fee_collection_journal.sql");
    for (const name of migrations) {
      db.exec(readFileSync(new URL(name, migrationDir), "utf8")
        .replaceAll("--> statement-breakpoint", ""));
    }
    assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pump_fee_collection_policies")
      .get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pump_fee_collection_intents")
      .get()?.n, 0);
  } finally { db.close(); }
});
