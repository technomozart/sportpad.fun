import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ASSERT_ONE_ROW_CHANGED_SQL } from "../../protocol/automation-safety.ts";
import {
  ADVANCE_REWARD_BATCH_SETTLEMENTS_SQL,
  ADVANCE_REWARD_BATCH_TOTAL_SQL,
  ARM_REWARD_BATCH_SQL,
  ASSERT_REWARD_BATCH_SETTLEMENTS_ADVANCED_SQL,
  ASSERT_REWARD_BATCH_SOURCES_VERIFIED_SQL,
  COMPLETE_REWARD_BATCH_SQL,
  INSERT_REWARD_BATCH_INTENT_SQL,
  INSERT_REWARD_BATCH_SOURCE_SQL,
  INSERT_REWARD_BATCH_SQL,
  MARK_REWARD_BATCH_QUEUED_SQL,
  planRewardBatchSource,
  QUEUE_REWARD_BATCH_JOB_SQL,
  rewardBatchIntentKey,
  UPDATE_QUEUED_REWARD_BATCH_PAYLOAD_SQL,
  VERIFY_REWARD_BATCH_SOURCES_SQL,
} from "./reward-batch-sql.ts";

const batchId = "11111111-1111-4111-8111-111111111111";
const nativeMint = "So11111111111111111111111111111111111111112";
const launchId = "launch-a";
const mint = "FAN";
const treasury = "reward-treasury";
const signature = "swap-sig";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT,
      reward_mint TEXT, mainnet_reward_treasury TEXT, mainnet_mint TEXT,
      status TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      reward_amount_atomic TEXT, reward_spent_atomic TEXT DEFAULT '0',
      reward_swap_signature TEXT, buyback_swap_signature TEXT, burn_signature TEXT,
      state TEXT, updated_at TEXT);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY,
      settlement_paused INTEGER, rewards_paused INTEGER);
    CREATE TABLE reward_swap_batches (id TEXT PRIMARY KEY, launch_id TEXT,
      reward_mint TEXT, treasury TEXT, input_amount_atomic TEXT DEFAULT '0',
      state TEXT DEFAULT 'collecting', tx_signature TEXT,
      output_amount_atomic TEXT, verified_slot INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX open_batch_launch ON reward_swap_batches (launch_id)
      WHERE state IN ('collecting', 'queued');
    CREATE TABLE reward_swap_batch_sources (batch_id TEXT, settlement_id TEXT,
      offset_atomic TEXT, input_amount_atomic TEXT, total_atomic TEXT,
      state TEXT DEFAULT 'reserved', verified_signature TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(batch_id, settlement_id, offset_atomic));
    CREATE UNIQUE INDEX active_batch_source ON reward_swap_batch_sources(settlement_id)
      WHERE state = 'reserved';
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT,
      entity_type TEXT, entity_id TEXT, chain TEXT, payload_json TEXT,
      state TEXT, available_at INTEGER, error_code TEXT, tx_hash TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE transaction_intents (id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE, settlement_id TEXT, reward_batch_id TEXT,
      signer_role TEXT, signer_address TEXT, action TEXT, state TEXT,
      expected_programs_json TEXT, expected_mints_json TEXT,
      maximum_spend_lamports TEXT, provider_request_id TEXT,
      unsigned_transaction_base64 TEXT, transaction_message_hash TEXT,
      last_valid_block_height INTEGER, input_mint TEXT, output_mint TEXT,
      input_amount_atomic TEXT, minimum_output_atomic TEXT,
      tx_signature TEXT UNIQUE, expires_at TEXT);
    CREATE TABLE settlement_steps (settlement_id TEXT, stage TEXT, state TEXT);
    INSERT INTO launch_drafts VALUES ('launch-a','solana','FAN','reward-treasury',
      'COMMUNITY','mainnet_published');
    INSERT INTO fee_events VALUES ('fee-a','launch-a'),('fee-b','launch-a'),('fee-c','launch-a');
    INSERT INTO settlements (id,fee_event_id,reward_amount_atomic,state) VALUES
      ('settlement-a','fee-a','400000','reconciled'),
      ('settlement-b','fee-b','800000','reconciled'),
      ('settlement-c','fee-c','200000000','reconciled');
    INSERT INTO protocol_controls VALUES ('global',0,0);
  `);
  return db;
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

function one(db: DatabaseSync) { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); }

function createBatch(db: DatabaseSync) {
  assert.equal(db.prepare(INSERT_REWARD_BATCH_SQL).run(batchId, launchId, mint, treasury, null).changes, 1);
}

function append(db: DatabaseSync, settlementId: string) {
  const row = db.prepare("SELECT reward_amount_atomic, reward_spent_atomic FROM settlements WHERE id=?")
    .get(settlementId) as { reward_amount_atomic: string; reward_spent_atomic: string };
  const prior = (db.prepare("SELECT input_amount_atomic FROM reward_swap_batches WHERE id=?")
    .get(batchId) as { input_amount_atomic: string }).input_amount_atomic;
  const plan = planRewardBatchSource(row.reward_amount_atomic, row.reward_spent_atomic, prior);
  if (!plan) throw new Error("no room");
  const state = db.prepare("SELECT state FROM reward_swap_batches WHERE id=?")
    .get(batchId)?.state;
  atomic(db, [
    () => { db.prepare(INSERT_REWARD_BATCH_SOURCE_SQL).run(batchId, settlementId,
      plan.offsetAtomic, plan.inputAmountLamports, plan.totalAtomic, prior, null); },
    () => one(db),
    () => { db.prepare(ADVANCE_REWARD_BATCH_TOTAL_SQL).run(batchId, prior, plan.nextBatchAtomic); },
    () => one(db),
    ...(state === "queued" ? [
      () => { db.prepare(UPDATE_QUEUED_REWARD_BATCH_PAYLOAD_SQL)
        .run(batchId, prior, plan.nextBatchAtomic); },
      () => one(db),
    ] : []),
  ]);
  return plan;
}

function payload(amount: string) {
  return JSON.stringify({ batchId, launchId, rewardMint: mint,
    rewardSymbol: "FAN", rewardAmountLamports: amount });
}

function queue(db: DatabaseSync, amount: string) {
  atomic(db, [
    () => { db.prepare(QUEUE_REWARD_BATCH_JOB_SQL).run("job-a", batchId, payload(amount), 0); },
    () => one(db),
    () => { db.prepare(MARK_REWARD_BATCH_QUEUED_SQL).run(batchId); },
    () => one(db),
  ]);
}

test("plans exact maximal contributions and rejects malformed money", () => {
  assert.deepEqual(planRewardBatchSource("200000000", "0", "99999999"), {
    offsetAtomic: "0", totalAtomic: "200000000", inputAmountLamports: "1",
    nextBatchAtomic: "100000000", nextSpentAtomic: "1", settlementComplete: false,
  });
  assert.equal(planRewardBatchSource("1", "1", "0"), null);
  for (const values of [["0", "0", "0"], ["01", "0", "0"],
    ["1", "2", "0"], ["1", "0", "100000001"], ["9223372036854775808", "0", "0"]]) {
    assert.throws(() => planRewardBatchSource(...(values as [string,string,string])));
  }
  assert.equal(rewardBatchIntentKey(batchId), `automation:reward:batch:${batchId}`);
  assert.throws(() => rewardBatchIntentKey("bad"));
});

test("generated SQLite migration permits a shared finalized swap signature", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE launch_drafts (id TEXT PRIMARY KEY);
      CREATE TABLE settlements (id TEXT PRIMARY KEY, reward_swap_signature TEXT);
      CREATE UNIQUE INDEX idx_settlements_reward_swap_signature ON settlements(reward_swap_signature)
        WHERE reward_swap_signature IS NOT NULL;
      CREATE TABLE transaction_intents (id TEXT PRIMARY KEY);
    `);
    const migration = readFileSync(new URL("../../../drizzle/0020_yummy_black_widow.sql", import.meta.url), "utf8");
    db.exec(migration.replaceAll("--> statement-breakpoint", ""));
    db.exec(`INSERT INTO settlements VALUES ('a','same-swap'),('b','same-swap')`);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE reward_swap_signature='same-swap'")
      .get()?.n, 2);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});

test("dust from separate finalized fee settlements forms one mutable queued batch", () => {
  const db = fixture();
  try {
    createBatch(db);
    assert.equal(append(db, "settlement-a").nextBatchAtomic, "400000");
    assert.throws(() => queue(db, "400000"));
    assert.equal(db.prepare("SELECT state FROM reward_swap_batches").get()?.state, "collecting");
    assert.equal(append(db, "settlement-b").nextBatchAtomic, "1200000");
    queue(db, "1200000");
    assert.equal(db.prepare("SELECT json_extract(payload_json,'$.rewardAmountLamports') AS amount FROM automation_jobs")
      .get()?.amount, "1200000");
    assert.equal(append(db, "settlement-c").nextBatchAtomic, "100000000");
    assert.equal(db.prepare("SELECT json_extract(payload_json,'$.rewardAmountLamports') AS amount FROM automation_jobs")
      .get()?.amount, "100000000");
    assert.equal(db.prepare("SELECT input_amount_atomic FROM reward_swap_batch_sources WHERE settlement_id='settlement-c'")
      .get()?.input_amount_atomic, "98800000");
  } finally { db.close(); }
});

test("reservation rejects duplicate, conflicting manual execution and source changes", () => {
  const db = fixture();
  try {
    createBatch(db);
    append(db, "settlement-a");
    assert.equal(db.prepare(INSERT_REWARD_BATCH_SOURCE_SQL)
      .run(batchId, "settlement-a", "0", "400000", "400000", "400000", null).changes, 0);
    db.exec(`INSERT INTO transaction_intents
      (id,idempotency_key,settlement_id,action,state)
      VALUES ('manual','manual','settlement-b','reward_swap','planned')`);
    assert.throws(() => append(db, "settlement-b"));
    db.exec("UPDATE transaction_intents SET state='failed' WHERE id='manual'");
    db.exec("UPDATE settlements SET reward_spent_atomic='1' WHERE id='settlement-b'");
    assert.equal(db.prepare(INSERT_REWARD_BATCH_SOURCE_SQL)
      .run(batchId, "settlement-b", "0", "800000", "800000", "400000", null).changes, 0);
    db.exec("UPDATE settlements SET reward_spent_atomic='0' WHERE id='settlement-b'");
    db.exec("UPDATE protocol_controls SET rewards_paused=1");
    assert.throws(() => append(db, "settlement-b"));
  } finally { db.close(); }
});

test("a leased or armed job freezes batch amount and source membership", () => {
  const db = fixture();
  try {
    createBatch(db); append(db, "settlement-a"); append(db, "settlement-b");
    queue(db, "1200000");
    db.exec("UPDATE automation_jobs SET state='leased' WHERE id='job-a'");
    assert.throws(() => append(db, "settlement-c"));
    db.exec("UPDATE automation_jobs SET state='broadcasting', error_code='broadcasting:worker' WHERE id='job-a'");
    assert.equal(db.prepare(ARM_REWARD_BATCH_SQL).run(batchId,"1200000","job-a","broadcasting:worker").changes, 1);
    assert.equal(db.prepare("SELECT state FROM reward_swap_batches").get()?.state, "broadcasting");
    assert.throws(() => append(db, "settlement-c"));
    assert.equal(db.prepare(ARM_REWARD_BATCH_SQL).run(batchId,"1200000","job-a","broadcasting:worker").changes, 0);
  } finally { db.close(); }
});

test("one persisted intent and finalized batch receipt advance all exact sources once", () => {
  const db = fixture();
  try {
    createBatch(db); append(db, "settlement-a"); append(db, "settlement-b");
    queue(db, "1200000");
    db.exec("UPDATE automation_jobs SET state='broadcasting', error_code='broadcasting:worker' WHERE id='job-a'");
    assert.equal(db.prepare(ARM_REWARD_BATCH_SQL)
      .run(batchId,"1200000","job-a","broadcasting:worker").changes, 1);
    const fields = [
      "intent", rewardBatchIntentKey(batchId), "settlement-a", treasury,
      '["jupiter_v2_metis_pinned"]', `["${nativeMint}","${mint}"]`,
      "1200000", "request", "unsigned", "a".repeat(64), 200,
      nativeMint, mint, "1200000", "1234", signature, "2026-09-23T12:00:00.000Z",
      "job-a", "broadcasting:worker", batchId, null,
    ];
    assert.equal(db.prepare(INSERT_REWARD_BATCH_INTENT_SQL).run(...fields).changes, 1);
    assert.equal(db.prepare("SELECT reward_batch_id,settlement_id FROM transaction_intents")
      .get()?.reward_batch_id, batchId);
    assert.throws(() => db.prepare(INSERT_REWARD_BATCH_INTENT_SQL).run(...fields));
    db.exec(`UPDATE automation_jobs SET state='complete',tx_hash='${signature}' WHERE id='job-a'`);
    atomic(db, [
      () => { db.prepare(COMPLETE_REWARD_BATCH_SQL)
        .run(batchId, signature, "1234", 123, "1200000", mint, "job-a", rewardBatchIntentKey(batchId)); },
      () => one(db),
      () => { db.prepare(VERIFY_REWARD_BATCH_SOURCES_SQL).run(batchId, signature); },
      () => { db.prepare(ASSERT_REWARD_BATCH_SOURCES_VERIFIED_SQL).get(batchId, signature); },
      () => { db.prepare(ADVANCE_REWARD_BATCH_SETTLEMENTS_SQL).run(batchId, signature); },
      () => { db.prepare(ASSERT_REWARD_BATCH_SETTLEMENTS_ADVANCED_SQL).get(batchId, signature); },
    ]);
    assert.deepEqual(db.prepare("SELECT reward_spent_atomic,reward_swap_signature FROM settlements ORDER BY id LIMIT 2")
      .all().map((row) => [row.reward_spent_atomic,row.reward_swap_signature]), [
      ["400000",signature], ["800000",signature],
    ]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reward_swap_batch_sources WHERE state='verified'")
      .get()?.n, 2);
    assert.throws(() => atomic(db, [
      () => { db.prepare(COMPLETE_REWARD_BATCH_SQL)
        .run(batchId, signature, "1234", 123, "1200000", mint, "job-a", rewardBatchIntentKey(batchId)); },
      () => one(db),
    ]));
  } finally { db.close(); }
});

test("a stale settlement rolls back the whole batch credit", () => {
  const db = fixture();
  try {
    createBatch(db); append(db, "settlement-a"); append(db, "settlement-b");
    queue(db, "1200000");
    db.exec("UPDATE reward_swap_batches SET state='broadcasting' WHERE id='" + batchId + "'");
    db.exec(`UPDATE automation_jobs SET state='complete',tx_hash='${signature}' WHERE id='job-a'`);
    db.prepare(`INSERT INTO transaction_intents
      (id,idempotency_key,reward_batch_id,action,tx_signature,input_amount_atomic,output_mint)
      VALUES ('intent',?,?, 'solana_reward_purchase_automation',?,?,?)`).run(
      rewardBatchIntentKey(batchId), batchId, signature, "1200000", mint);
    db.exec("UPDATE settlements SET reward_spent_atomic='1' WHERE id='settlement-b'");
    assert.throws(() => atomic(db, [
      () => { db.prepare(COMPLETE_REWARD_BATCH_SQL).run(batchId,signature,"1234",123,"1200000",mint,
        "job-a",rewardBatchIntentKey(batchId)); },
      () => one(db),
      () => { db.prepare(VERIFY_REWARD_BATCH_SOURCES_SQL).run(batchId,signature); },
      () => { db.prepare(ASSERT_REWARD_BATCH_SOURCES_VERIFIED_SQL).get(batchId,signature); },
    ]));
    assert.equal(db.prepare("SELECT state FROM reward_swap_batches").get()?.state, "broadcasting");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reward_swap_batch_sources WHERE state='verified'")
      .get()?.n, 0);
  } finally { db.close(); }
});
