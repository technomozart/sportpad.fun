import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ARCHIVE_PROVEN_ABSENT_CLAIM_INTENT_SQL,
  COMPLETE_AUTOMATIC_CLAIM_INTENT_SQL, INSERT_AUTOMATIC_CLAIM_INTENT_SQL,
  REQUEUE_PROVEN_ABSENT_CLAIM_JOB_SQL,
  REQUEUE_UNPREPARED_CLAIM_JOB_SQL } from "./claim-intent-sql.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (
      id TEXT PRIMARY KEY, job_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, chain TEXT NOT NULL, state TEXT NOT NULL,
      error_code TEXT, tx_hash TEXT, leased_until INTEGER, available_at INTEGER,
      attempt INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE reward_claims (
      id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL, state TEXT NOT NULL,
      claim_signature TEXT, destination_chain TEXT, destination_address TEXT,
      amount_atomic TEXT NOT NULL
    );
    CREATE TABLE reward_epochs (id TEXT PRIMARY KEY, launch_id TEXT NOT NULL);
    CREATE TABLE launch_drafts (
      id TEXT PRIMARY KEY, reward_chain TEXT NOT NULL, reward_mint TEXT NOT NULL,
      mainnet_reward_treasury TEXT, status TEXT NOT NULL
    );
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY, rewards_paused INTEGER NOT NULL);
    CREATE TABLE transaction_intents (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
      claim_id TEXT, signer_role TEXT NOT NULL, signer_address TEXT,
      action TEXT NOT NULL, state TEXT NOT NULL,
      expected_programs_json TEXT NOT NULL, expected_mints_json TEXT NOT NULL,
      maximum_spend_lamports TEXT NOT NULL, provider_request_id TEXT,
      unsigned_transaction_base64 TEXT, transaction_message_hash TEXT,
      last_valid_block_height INTEGER, input_mint TEXT, input_amount_atomic TEXT,
      tx_signature TEXT UNIQUE, expires_at TEXT NOT NULL,
      claim_history_anchor_signature TEXT, error_code TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    INSERT INTO automation_jobs
      (id, job_type, entity_type, entity_id, chain, state, error_code, available_at)
      VALUES ('job-1', 'solana_claim_payout', 'reward_claim', 'claim-1', 'solana',
        'broadcasting', 'broadcasting:solana:treasury', 0);
    INSERT INTO reward_claims VALUES
      ('claim-1', 'epoch-1', 'queued', NULL, 'solana', 'recipient', '123');
    INSERT INTO reward_epochs VALUES ('epoch-1', 'launch-1');
    INSERT INTO launch_drafts VALUES
      ('launch-1', 'solana', 'mint', 'treasury', 'mainnet_published');
    INSERT INTO protocol_controls VALUES ('global', 0);
  `);
  return db;
}

function fields(intentId = "intent-1", signature = "signature-1") {
  return [
    intentId, "automation:claim:payout:job-1:1", "claim-1", "treasury",
    '["token-program"]', '["mint"]', "blockhash", "signed-base64",
    "a".repeat(64), 200, "mint", "123", signature,
    "2026-09-23T12:00:00.000Z", "job-1", "broadcasting:solana:treasury", "recipient",
    "anchor-signature",
  ];
}

test("persists and confirms exactly one prepared claim transfer", () => {
  const db = database();
  try {
    assert.equal(db.prepare(INSERT_AUTOMATIC_CLAIM_INTENT_SQL).run(...fields()).changes, 1);
    assert.equal(db.prepare(COMPLETE_AUTOMATIC_CLAIM_INTENT_SQL)
      .run("automation:claim:payout:job-1:1", "claim-1", "wrong-signature").changes, 0);
    assert.equal(db.prepare(COMPLETE_AUTOMATIC_CLAIM_INTENT_SQL)
      .run("automation:claim:payout:job-1:1", "claim-1", "signature-1").changes, 1);
    assert.equal(db.prepare("SELECT state FROM transaction_intents").get()?.state, "confirmed");
  } finally { db.close(); }
});

test("wrong fence, changed claim, pause, or launch state cannot prepare", () => {
  const mutations = [
    "UPDATE automation_jobs SET error_code = 'broadcasting:other'",
    "UPDATE automation_jobs SET state = 'leased'",
    "UPDATE reward_claims SET amount_atomic = '124'",
    "UPDATE reward_claims SET destination_address = 'other'",
    "UPDATE reward_claims SET state = 'claimed'",
    "UPDATE protocol_controls SET rewards_paused = 1",
    "UPDATE launch_drafts SET status = 'draft'",
    "UPDATE launch_drafts SET mainnet_reward_treasury = 'other'",
  ];
  for (const mutation of mutations) {
    const db = database();
    try {
      db.exec(mutation);
      assert.equal(db.prepare(INSERT_AUTOMATIC_CLAIM_INTENT_SQL).run(...fields()).changes, 0, mutation);
    } finally { db.close(); }
  }
});

test("a second signed transfer cannot replace the persisted claim intent", () => {
  const db = database();
  try {
    db.prepare(INSERT_AUTOMATIC_CLAIM_INTENT_SQL).run(...fields());
    assert.throws(() => db.prepare(INSERT_AUTOMATIC_CLAIM_INTENT_SQL)
      .run(...fields("intent-2", "signature-2")), /UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT tx_signature FROM transaction_intents").get()?.tx_signature, "signature-1");
  } finally { db.close(); }
});

test("only stale, signed-intent-free armed claims can requeue", () => {
  const db = database();
  try {
    db.exec("UPDATE automation_jobs SET updated_at = datetime('now', '-10 minutes')");
    assert.equal(db.prepare(REQUEUE_UNPREPARED_CLAIM_JOB_SQL)
      .run(Date.now(), "job-1", "broadcasting:solana:other").changes, 0);
    db.prepare(INSERT_AUTOMATIC_CLAIM_INTENT_SQL).run(...fields());
    assert.equal(db.prepare(REQUEUE_UNPREPARED_CLAIM_JOB_SQL)
      .run(Date.now(), "job-1", "broadcasting:solana:treasury").changes, 0);
    db.exec("DELETE FROM transaction_intents");
    assert.equal(db.prepare(REQUEUE_UNPREPARED_CLAIM_JOB_SQL)
      .run(Date.now(), "job-1", "broadcasting:solana:treasury").changes, 1);
  } finally { db.close(); }
});

test("only an exact expired signed claim can archive and requeue", () => {
  const db = database();
  try {
    db.prepare(INSERT_AUTOMATIC_CLAIM_INTENT_SQL).run(...fields());
    const archive = db.prepare(ARCHIVE_PROVEN_ABSENT_CLAIM_INTENT_SQL);
    assert.equal(archive.run("automation:claim:payout:job-1:1", "claim-1", "signature-1",
      "wrong-anchor", "job-1", 1, "broadcasting:solana:treasury").changes, 0);
    assert.equal(archive.run("automation:claim:payout:job-1:1", "claim-1", "signature-1",
      "anchor-signature", "job-1", 2, "broadcasting:solana:treasury").changes, 0);
    assert.equal(db.prepare(REQUEUE_PROVEN_ABSENT_CLAIM_JOB_SQL)
      .run(Date.now(), "job-1", 1, "broadcasting:solana:treasury", "signature-1",
        "automation:claim:payout:job-1:1").changes, 0);
    assert.equal(archive.run("automation:claim:payout:job-1:1", "claim-1", "signature-1",
      "anchor-signature", "job-1", 1, "broadcasting:solana:treasury").changes, 1);
    assert.equal(db.prepare(REQUEUE_PROVEN_ABSENT_CLAIM_JOB_SQL)
      .run(Date.now(), "job-1", 1, "broadcasting:solana:treasury", "signature-1",
        "automation:claim:payout:job-1:1").changes, 1);
    assert.equal(db.prepare("SELECT state FROM automation_jobs").get()?.state, "queued");
    assert.equal(db.prepare("SELECT state FROM transaction_intents").get()?.state,
      "expired_unlanded");
    db.exec(`UPDATE automation_jobs SET state = 'broadcasting', attempt = 2,
      error_code = 'broadcasting:solana:treasury',
      updated_at = datetime('now', '-10 minutes')`);
    assert.equal(db.prepare(REQUEUE_UNPREPARED_CLAIM_JOB_SQL)
      .run(Date.now(), "job-1", "broadcasting:solana:treasury").changes, 1,
    "an archived attempt must not trap a later unprepared attempt");
  } finally { db.close(); }
});
