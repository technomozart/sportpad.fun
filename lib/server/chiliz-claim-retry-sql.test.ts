import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ASSERT_ONE_ROW_CHANGED_SQL, QUEUE_CLAIM_JOB_SQL } from "../protocol/automation-safety.ts";
import { INSERT_CHILIZ_CLAIM_RETRY_JOB_SQL,
  INSERT_PAUSED_CHILIZ_CLAIM_RETRY_POLICY_SQL } from "./chiliz-claim-retry-sql.ts";

const oneChz = 1_000_000_000_000_000_000n;
const spent = 300_000_000_000_000n;
const remaining = (oneChz - spent).toString();
const txHash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;

function migration(db: DatabaseSync, number: string) {
  db.exec(readFileSync(new URL(`../../drizzle/${number}`, import.meta.url), "utf8")
    .replaceAll("--> statement-breakpoint", ""));
}

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE automation_jobs (
      id TEXT PRIMARY KEY, job_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, chain TEXT NOT NULL, payload_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', attempt INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT, error_code TEXT, available_at INTEGER NOT NULL,
      leased_until INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_automation_job_entity_type
      ON automation_jobs(entity_id, job_type);
    CREATE TABLE reward_claims (
      id TEXT PRIMARY KEY, state TEXT NOT NULL, claim_signature TEXT,
      destination_chain TEXT NOT NULL
    );
    INSERT INTO reward_claims VALUES ('claim_1','queued',NULL,'chiliz');
    INSERT INTO automation_jobs
      (id, job_type, entity_type, entity_id, chain, payload_json, state,
       attempt, tx_hash, error_code, available_at)
    VALUES ('original', 'chiliz_claim_unwrap', 'reward_claim', 'claim_1',
      'chiliz', '{"claimId":"claim_1","amountAtomic":"500","reconciliationReceipt":{"state":"finalized_reverted"}}',
      'failed', 1, '${txHash}', 'chiliz_finalized_reverted', 0);
  `);
  migration(db, "0023_green_ulik.sql");
  db.exec(`
    INSERT INTO chiliz_intent_policy
      (key, authorized_job_id, reserved_intent_id, max_total_spend_wei, state)
    VALUES ('claim_canary', 'original', 'old_intent', '${oneChz}', 'reserved');
    INSERT INTO chiliz_signed_intents
      (id, job_id, attempt, chain_id, treasury_address, nonce, kind,
       fan_token_contract, tx_hash, raw_transaction, intent_json,
       maximum_principal_wei, maximum_network_fee_wei, maximum_total_spend_wei,
       state, receipt_status, receipt_block_hash, receipt_block_number,
       canonical_receipt_block_hash, finalized_block_number, network_fee_wei,
       principal_spent_wei, total_spent_wei, evidence_json)
    VALUES ('old_intent', 'original', 1, 88888,
      '0x1111111111111111111111111111111111111111', 7, 'claim',
      '0x2222222222222222222222222222222222222222', '${txHash}',
      '0x02', '{}', '0', '${oneChz}', '${oneChz}',
      'finalized_reverted', 'reverted', '${blockHash}', 100,
      '${blockHash}', 101, '${spent}', '0', '${spent}',
      '{"canonical":true}');
  `);
  migration(db, "0025_chiliz_claim_retry.sql");
  return db;
}

function prepareRetry(db: DatabaseSync, cap = remaining) {
  db.exec("BEGIN IMMEDIATE");
  try {
    assert.equal(db.prepare(INSERT_CHILIZ_CLAIM_RETRY_JOB_SQL)
      .run("retry", "original", 1_800_000_000_000).changes, 1);
    db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
    assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_CLAIM_RETRY_POLICY_SQL)
      .run("retry", cap).changes, 1);
    db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

test("0025 keeps original job and claim owed, with one new paused retry and cumulative cap", () => {
  const db = fixture();
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chiliz_claim_retry_policy").get()?.n, 0);
    prepareRetry(db);
    const original = db.prepare(`SELECT state,tx_hash,error_code,payload_json
      FROM automation_jobs WHERE id='original'`).get();
    assert.deepEqual({ ...original }, { state: "failed", tx_hash: txHash,
      error_code: "chiliz_finalized_reverted",
      payload_json: '{"claimId":"claim_1","amountAtomic":"500","reconciliationReceipt":{"state":"finalized_reverted"}}' });
    const retry = db.prepare(`SELECT job_type,entity_id,retry_of_job_id,state,attempt,
      payload_json FROM automation_jobs WHERE id='retry'`).get();
    assert.deepEqual({ ...retry }, { job_type: "chiliz_claim_retry", entity_id: "claim_1",
      retry_of_job_id: "original", state: "queued", attempt: 0,
      payload_json: '{"claimId":"claim_1","amountAtomic":"500"}' });
    assert.equal(db.prepare("SELECT state FROM reward_claims WHERE id='claim_1'").get()?.state, "queued");
    assert.deepEqual({ ...db.prepare(`SELECT state,predecessor_intent_id,
      predecessor_spent_wei,max_retry_spend_wei FROM chiliz_claim_retry_policy`).get() },
    { state: "paused", predecessor_intent_id: "old_intent",
      predecessor_spent_wei: spent.toString(), max_retry_spend_wei: remaining });
    assert.throws(() => db.prepare(INSERT_CHILIZ_CLAIM_RETRY_JOB_SQL)
      .run("retry_2", "original", 0), /UNIQUE constraint failed/);
    assert.throws(() => db.prepare(`INSERT INTO automation_jobs
      (id,job_type,entity_type,entity_id,chain,payload_json,state,available_at)
      VALUES ('duplicate','chiliz_claim_unwrap','reward_claim','claim_1','chiliz','{}','queued',0)`)
      .run(), /UNIQUE constraint failed/);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const indexes = db.prepare("PRAGMA index_list('automation_jobs')").all()
      .map((row) => row.name);
    assert.ok(indexes.includes("idx_automation_job_entity_type"));
    assert.ok(indexes.includes("idx_automation_jobs_retry_of_job"));
    // The existing queue's exact ON CONFLICT target still compiles.
    db.prepare(QUEUE_CLAIM_JOB_SQL);
  } finally { db.close(); }
});

test("invalid predecessor or claim evidence cannot create a retry", () => {
  const mutations = [
    "UPDATE automation_jobs SET state='reconciliation_required' WHERE id='original'",
    "UPDATE automation_jobs SET error_code='unknown' WHERE id='original'",
    "UPDATE chiliz_signed_intents SET state='broadcast_attempted' WHERE id='old_intent'",
    "UPDATE chiliz_signed_intents SET canonical_receipt_block_hash='different' WHERE id='old_intent'",
    "UPDATE chiliz_signed_intents SET principal_spent_wei='1' WHERE id='old_intent'",
    "UPDATE reward_claims SET state='confirmed' WHERE id='claim_1'",
    "UPDATE reward_claims SET claim_signature='paid' WHERE id='claim_1'",
  ];
  for (const mutation of mutations) {
    const db = fixture();
    try {
      db.exec(mutation);
      assert.equal(db.prepare(INSERT_CHILIZ_CLAIM_RETRY_JOB_SQL)
        .run("retry", "original", 0).changes, 0, mutation);
      assert.throws(() => db.prepare(`INSERT INTO automation_jobs
        (id,job_type,entity_type,entity_id,chain,payload_json,state,available_at,retry_of_job_id)
        VALUES ('retry','chiliz_claim_retry','reward_claim','claim_1','chiliz','{}','queued',0,'original')`)
        .run(), /chiliz_claim_retry_job_ineligible/, mutation);
    } finally { db.close(); }
  }
});

test("policy insertion is atomic and immutable, including its finalized receipt proof", () => {
  const db = fixture();
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      assert.equal(db.prepare(INSERT_CHILIZ_CLAIM_RETRY_JOB_SQL)
        .run("retry", "original", 0).changes, 1);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_CLAIM_RETRY_POLICY_SQL)
        .run("retry", (oneChz - spent + 1n).toString()).changes, 0);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      assert.fail("over-budget policy must roll back the new job");
    } catch { db.exec("ROLLBACK"); }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_jobs WHERE id='retry'").get()?.n, 0);
    prepareRetry(db);
    assert.throws(() => db.exec(`UPDATE chiliz_signed_intents
      SET evidence_json='{"canonical":false}' WHERE id='old_intent'`),
    /chiliz_claim_retry_predecessor_intent_immutable/);
    assert.throws(() => db.exec("UPDATE automation_jobs SET tx_hash='different' WHERE id='original'"),
      /chiliz_claim_retry_predecessor_job_immutable/);
    assert.throws(() => db.exec("UPDATE chiliz_claim_retry_policy SET max_retry_spend_wei='1'"),
      /chiliz_claim_retry_policy_immutable/);
    assert.throws(() => db.exec("DELETE FROM chiliz_claim_retry_policy"),
      /chiliz_claim_retry_policy_no_delete/);
    assert.throws(() => db.exec("DELETE FROM automation_jobs WHERE id='original'"),
      /chiliz_claim_retry_job_no_delete/);
  } finally { db.close(); }
});

test("signed retry intent is blocked while paused and cannot exceed remaining spend", () => {
  const db = fixture();
  try {
    prepareRetry(db);
    const insert = (max: string, id: string) => db.prepare(`
      INSERT INTO chiliz_signed_intents
        (id,job_id,attempt,chain_id,treasury_address,nonce,kind,
         fan_token_contract,tx_hash,raw_transaction,intent_json,
         maximum_principal_wei,maximum_network_fee_wei,maximum_total_spend_wei)
      VALUES (?1,'retry',1,88888,'0x1111111111111111111111111111111111111111',
        8,'claim','0x2222222222222222222222222222222222222222',
        '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        '0x02','{}','0',?2,?2)`)
      .run(id, max).changes;
    assert.throws(() => insert("1", "new_intent"), /chiliz_claim_retry_intent_unauthorized/);
    db.exec("UPDATE chiliz_claim_retry_policy SET state='armed' WHERE job_id='retry'");
    db.exec("UPDATE automation_jobs SET state='broadcasting',attempt=1 WHERE id='retry'");
    assert.throws(() => insert((BigInt(remaining) + 1n).toString(), "new_intent"),
      /chiliz_claim_retry_intent_unauthorized/);
    assert.equal(insert(remaining, "new_intent"), 1);
    assert.deepEqual({ ...db.prepare(`SELECT state,reserved_intent_id
      FROM chiliz_claim_retry_policy WHERE job_id='retry'`).get() },
    { state: "reserved", reserved_intent_id: "new_intent" });
    assert.throws(() => db.exec("UPDATE chiliz_claim_retry_policy SET reserved_intent_id=NULL"),
      /chiliz_claim_retry_policy_reservation/);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});
