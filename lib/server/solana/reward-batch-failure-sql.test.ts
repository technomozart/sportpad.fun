import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ASSERT_ONE_ROW_CHANGED_SQL } from "../../protocol/automation-safety.ts";
import { ARCHIVE_FINALIZED_FAILED_REWARD_BATCH_INTENT_SQL,
  REARM_PROVEN_FAILED_REWARD_BATCH_JOB_SQL } from "./reward-batch-failure-sql.ts";

const key = "automation:reward:batch:batch-1";
const signature = "failed-signature";
const archiveArgs = [key, signature, "message-hash", "treasury", "job-1", "batch-1",
  "broadcasting:solana:treasury", "5000", "501"] as const;

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT,
      reward_mint TEXT, mainnet_reward_treasury TEXT, status TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, reward_spent_atomic TEXT,
      reward_amount_atomic TEXT, reward_swap_signature TEXT, state TEXT);
    CREATE TABLE reward_swap_batches (id TEXT PRIMARY KEY, launch_id TEXT,
      reward_mint TEXT, treasury TEXT, input_amount_atomic TEXT,
      state TEXT, tx_signature TEXT);
    CREATE TABLE reward_swap_batch_sources (batch_id TEXT, settlement_id TEXT,
      offset_atomic TEXT, input_amount_atomic TEXT, total_atomic TEXT,
      state TEXT, verified_signature TEXT, created_at TEXT);
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT,
      entity_type TEXT, entity_id TEXT, state TEXT, error_code TEXT,
      tx_hash TEXT, payload_json TEXT, available_at INTEGER, updated_at TEXT);
    CREATE TABLE transaction_intents (id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE, settlement_id TEXT, reward_batch_id TEXT,
      signer_role TEXT, signer_address TEXT, action TEXT, state TEXT,
      error_code TEXT, tx_signature TEXT UNIQUE, transaction_message_hash TEXT,
      input_amount_atomic TEXT, output_mint TEXT, updated_at TEXT);
    CREATE UNIQUE INDEX one_batch_intent ON transaction_intents(reward_batch_id)
      WHERE reward_batch_id IS NOT NULL;
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY,
      settlement_paused INTEGER, rewards_paused INTEGER);
  `);
  const migration = readFileSync(new URL("../../../drizzle/0022_stale_toad_men.sql", import.meta.url), "utf8");
  db.exec(migration.replaceAll("--> statement-breakpoint", ""));
  db.exec(`
    INSERT INTO launch_drafts VALUES
      ('launch-1','solana','FAN','treasury','mainnet_published');
    INSERT INTO settlements VALUES ('settlement-1','0','50000000',NULL,'reconciled');
    INSERT INTO reward_swap_batches VALUES
      ('batch-1','launch-1','FAN','treasury','50000000','broadcasting',NULL);
    INSERT INTO reward_swap_batch_sources VALUES
      ('batch-1','settlement-1','0','50000000','50000000','reserved',NULL,'2026-01-01');
    INSERT INTO automation_jobs VALUES
      ('job-1','solana_reward_purchase','reward_swap_batch','batch-1',
        'broadcasting','broadcasting:solana:treasury',NULL,
        '{"batchId":"batch-1","rewardMint":"FAN","rewardAmountLamports":"50000000"}',0,NULL);
    INSERT INTO transaction_intents VALUES
      ('intent-1','automation:reward:batch:batch-1','settlement-1','batch-1',
        'reward_treasury','treasury','solana_reward_purchase_automation',
        'prepared',NULL,'failed-signature','message-hash','50000000','FAN',NULL);
    INSERT INTO protocol_controls VALUES ('global',0,0);
  `);
  return db;
}

function archive(db: DatabaseSync) {
  return db.prepare(ARCHIVE_FINALIZED_FAILED_REWARD_BATCH_INTENT_SQL).run(...archiveArgs).changes;
}

function rearm(db: DatabaseSync, priorState = "reconciliation_required", priorError = "worker_failed") {
  return db.prepare(REARM_PROVEN_FAILED_REWARD_BATCH_JOB_SQL).run(
    "job-1", "broadcasting:solana:treasury", 1_000, priorState, priorError,
    "batch-1", key, signature).changes;
}

function atomic(db: DatabaseSync, writes: (() => void)[]) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const write of writes) write();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("finalized failed batch intent and replacement commit atomically without releasing sources", () => {
  const db = fixture();
  try {
    atomic(db, [
      () => { assert.equal(archive(db), 1); db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
      () => { assert.equal(db.prepare(`INSERT INTO transaction_intents
        (id,idempotency_key,settlement_id,reward_batch_id,signer_role,signer_address,
          action,state,tx_signature,transaction_message_hash,input_amount_atomic,output_mint)
        VALUES ('intent-2',?1,'settlement-1','batch-1','reward_treasury','treasury',
          'solana_reward_purchase_automation','prepared','retry-signature','retry-hash',
          '50000000','FAN')`).run(key).changes, 1); },
    ]);
    assert.deepEqual(db.prepare(`SELECT id,idempotency_key,reward_batch_id,state,error_code
      FROM transaction_intents ORDER BY id`).all().map((row) => ({ ...row })), [
      { id: "intent-1", idempotency_key: `${key}:failed:${signature}`,
        reward_batch_id: null, state: "failed", error_code: "finalized_failed_fee_5000_slot_501" },
      { id: "intent-2", idempotency_key: key, reward_batch_id: "batch-1",
        state: "prepared", error_code: null },
    ]);
    assert.deepEqual({ ...db.prepare(`SELECT state,tx_signature FROM reward_swap_batches`).get() },
      { state: "broadcasting", tx_signature: null });
    assert.deepEqual({ ...db.prepare(`SELECT state,verified_signature FROM reward_swap_batch_sources`).get() },
      { state: "reserved", verified_signature: null });
    assert.equal(archive(db), 0, "a second finalized failure is not automatically retried");
  } finally { db.close(); }
});

test("a failed replacement insert rolls back the old intent archive", () => {
  const db = fixture();
  try {
    assert.throws(() => atomic(db, [
      () => { assert.equal(archive(db), 1); db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
      () => { db.prepare(`INSERT INTO transaction_intents (id,idempotency_key,tx_signature)
        VALUES ('intent-2',?1,?2)`).run(key, signature); },
    ]), /UNIQUE constraint failed/);
    assert.deepEqual({ ...db.prepare(`SELECT idempotency_key,reward_batch_id,state FROM transaction_intents`).get() },
      { idempotency_key: key, reward_batch_id: "batch-1", state: "prepared" });
  } finally { db.close(); }
});

test("paused controls, a one-spend canary, changed source, or unbounded fee cannot archive", () => {
  const mutations = [
    "UPDATE protocol_controls SET rewards_paused = 1",
    `INSERT INTO solana_reward_purchase_canary
      (key,launch_id,settlement_id,max_input_lamports,reserved_input_lamports,reward_batch_id,state)
      VALUES ('initial','launch-1','settlement-1',50000000,50000000,'batch-1','armed')`,
    "UPDATE reward_swap_batch_sources SET state = 'verified'",
    "UPDATE settlements SET reward_spent_atomic = '1'",
    "UPDATE automation_jobs SET tx_hash = 'failed-signature'",
    `INSERT INTO transaction_intents (id,idempotency_key) VALUES
      ('prior','automation:reward:batch:batch-1:failed:older')`,
  ];
  for (const mutation of mutations) {
    const db = fixture();
    try { db.exec(mutation); assert.equal(archive(db), 0, mutation); }
    finally { db.close(); }
  }
  const db = fixture();
  try {
    assert.equal(db.prepare(ARCHIVE_FINALIZED_FAILED_REWARD_BATCH_INTENT_SQL).run(
      ...archiveArgs.slice(0, 7), "500001", "501").changes, 0);
  } finally { db.close(); }
});

test("a proven failure rearms only the same held job with unchanged sources and unpaused controls", () => {
  const db = fixture();
  try {
    db.exec("UPDATE automation_jobs SET state='reconciliation_required',error_code='worker_failed'");
    assert.equal(rearm(db), 1);
    assert.deepEqual({ ...db.prepare(`SELECT state,error_code,available_at FROM automation_jobs`).get() },
      { state: "broadcasting", error_code: "broadcasting:solana:treasury", available_at: 1_000 });
  } finally { db.close(); }
  for (const mutation of [
    "UPDATE protocol_controls SET settlement_paused = 1",
    "UPDATE settlements SET reward_spent_atomic = '1'",
    `INSERT INTO solana_reward_purchase_canary
      (key,launch_id,settlement_id,max_input_lamports,reserved_input_lamports,reward_batch_id,state)
      VALUES ('initial','launch-1','settlement-1',50000000,50000000,'batch-1','armed')`,
    `INSERT INTO transaction_intents (id,idempotency_key) VALUES
      ('prior','automation:reward:batch:batch-1:failed:older')`,
  ]) {
    const held = fixture();
    try {
      held.exec("UPDATE automation_jobs SET state='reconciliation_required',error_code='worker_failed'");
      held.exec(mutation);
      assert.equal(rearm(held), 0, mutation);
    } finally { held.close(); }
  }
});
