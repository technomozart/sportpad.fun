import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ASSERT_ONE_ROW_CHANGED_SQL } from "../../protocol/automation-safety.ts";
import {
  ARM_REWARD_CANARY_SQL,
  ASSERT_REWARD_CANARY_RESERVATION_SQL,
  INSERT_PAUSED_REWARD_CANARY_SQL,
  PAUSE_REWARD_CANARY_SQL,
  parseCanaryInputLamports,
  RESERVE_REWARD_CANARY_BUDGET_SQL,
} from "./reward-canary-budget-sql.ts";

const launch = "launch-a";
const settlement = "settlement-a";
const batch = "batch-a";
const amount = "1000000";

function fixture(filename = ":memory:") {
  const db = new DatabaseSync(filename, { timeout: 50 });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT, status TEXT,
      mainnet_mint TEXT, reward_mint TEXT, mainnet_reward_treasury TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT, state TEXT,
      reward_swap_signature TEXT, reward_spent_atomic TEXT, reward_amount_atomic TEXT);
    CREATE TABLE reward_swap_batches (id TEXT PRIMARY KEY, launch_id TEXT, state TEXT,
      input_amount_atomic TEXT, reward_mint TEXT, treasury TEXT);
    CREATE TABLE reward_swap_batch_sources (batch_id TEXT, settlement_id TEXT,
      state TEXT, offset_atomic TEXT, input_amount_atomic TEXT, total_atomic TEXT);
    CREATE TABLE transaction_intents (id TEXT PRIMARY KEY, reward_batch_id TEXT UNIQUE);
  `);
  const migration = readFileSync(new URL("../../../drizzle/0022_stale_toad_men.sql", import.meta.url), "utf8");
  db.exec(migration.replaceAll("--> statement-breakpoint", ""));
  db.exec(`
    INSERT INTO launch_drafts VALUES
      ('launch-a','solana','mainnet_published','COIN','FAN','TREASURY'),
      ('launch-b','solana','mainnet_published','COIN-B','FAN','TREASURY');
    INSERT INTO fee_events VALUES ('fee-a','launch-a'),('fee-b','launch-b');
    INSERT INTO settlements VALUES
      ('settlement-a','fee-a','reconciled',NULL,'0','1000000'),
      ('settlement-b','fee-b','reconciled',NULL,'0','1000000');
    INSERT INTO reward_swap_batches VALUES
      ('batch-a','launch-a','broadcasting','1000000','FAN','TREASURY'),
      ('batch-b','launch-b','broadcasting','1000000','FAN','TREASURY');
    INSERT INTO reward_swap_batch_sources VALUES
      ('batch-a','settlement-a','reserved','0','1000000','1000000'),
      ('batch-b','settlement-b','reserved','0','1000000','1000000');
  `);
  return db;
}

function prepare(db: DatabaseSync, cap = 1_000_000) {
  assert.equal(db.prepare(INSERT_PAUSED_REWARD_CANARY_SQL).run(launch, settlement, cap).changes, 1);
  assert.equal(db.prepare("SELECT state FROM solana_reward_purchase_canary").get()?.state, "paused");
  assert.equal(db.prepare(ARM_REWARD_CANARY_SQL).run(launch, settlement).changes, 1);
}

function reserve(db: DatabaseSync, chosenBatch = batch, chosenAmount = amount) {
  return db.prepare(RESERVE_REWARD_CANARY_BUDGET_SQL)
    .run(launch, settlement, chosenBatch, chosenAmount).changes;
}

test("canary amount accepts only canonical, bounded lamports", () => {
  assert.equal(parseCanaryInputLamports("1000000"), 1_000_000);
  assert.equal(parseCanaryInputLamports("100000000"), 100_000_000);
  for (const value of ["0", "1", "999999", "100000001", "01000000",
    "1.0", "1e6", "+1000000", "9223372036854775808", "-1000000"]) {
    assert.throws(() => parseCanaryInputLamports(value));
  }
});

test("generated canary migration is schema-only, paused, bounded, and scoped", () => {
  const db = fixture();
  try {
    assert.equal(db.prepare(INSERT_PAUSED_REWARD_CANARY_SQL)
      .run(launch, "settlement-b", 1_000_000).changes, 0);
    assert.equal(db.prepare(INSERT_PAUSED_REWARD_CANARY_SQL)
      .run(launch, settlement, "1000000").changes, 0);
    prepare(db);
    assert.equal(db.prepare(ARM_REWARD_CANARY_SQL).run(launch, settlement).changes, 0);
    assert.throws(() => db.exec(`UPDATE solana_reward_purchase_canary
      SET max_input_lamports=999999`));
    assert.throws(() => db.exec(`INSERT INTO solana_reward_purchase_canary
      (key,launch_id,settlement_id,max_input_lamports)
      VALUES ('another','launch-b','settlement-b',1000000)`));
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});

test("one exact source reserves once; scope, cap, and pause cannot create a second spend", () => {
  const db = fixture();
  try {
    prepare(db);
    assert.equal(reserve(db, "batch-b"), 0);
    assert.equal(db.prepare(RESERVE_REWARD_CANARY_BUDGET_SQL)
      .run(launch, "settlement-b", batch, amount).changes, 0);
    assert.equal(reserve(db, batch, "1000001"), 0);
    db.exec(`INSERT INTO reward_swap_batch_sources VALUES
      ('batch-a','settlement-b','reserved','0','1','1')`);
    assert.equal(reserve(db), 0);
    db.exec(`DELETE FROM reward_swap_batch_sources
      WHERE batch_id='batch-a' AND settlement_id='settlement-b'`);
    assert.equal(reserve(db), 1);
    assert.equal(reserve(db), 0);
    assert.equal(db.prepare(PAUSE_REWARD_CANARY_SQL).run().changes, 1);
    assert.equal(reserve(db), 0);
    assert.equal(db.prepare(ARM_REWARD_CANARY_SQL).run(launch, settlement).changes, 0);
    assert.equal(db.prepare(ASSERT_REWARD_CANARY_RESERVATION_SQL)
      .get(launch, settlement, batch, amount)?.matched, 1);
    assert.throws(() => db.prepare(ASSERT_REWARD_CANARY_RESERVATION_SQL)
      .get(launch, settlement, "batch-b", amount));
    assert.deepEqual({ ...db.prepare(`SELECT reserved_input_lamports,reward_batch_id,state
      FROM solana_reward_purchase_canary`).get() }, {
      reserved_input_lamports: 1_000_000, reward_batch_id: batch, state: "paused",
    });
  } finally { db.close(); }
});

test("reservation and intent must commit atomically; a failed intent leaves no budget use", () => {
  const db = fixture();
  try {
    prepare(db);
    db.exec(`INSERT INTO transaction_intents VALUES ('duplicate',NULL)`);
    db.exec("BEGIN IMMEDIATE");
    try {
      assert.equal(reserve(db), 1);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      db.exec(`INSERT INTO transaction_intents VALUES ('duplicate','batch-a')`);
      db.exec("COMMIT");
      assert.fail("duplicate intent should fail");
    } catch {
      db.exec("ROLLBACK");
    }
    assert.equal(db.prepare(`SELECT reserved_input_lamports,reward_batch_id
      FROM solana_reward_purchase_canary`).get()?.reserved_input_lamports, 0);
    db.exec("BEGIN IMMEDIATE");
    try {
      assert.equal(reserve(db), 1);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      assert.equal(db.prepare(`INSERT INTO transaction_intents VALUES (?,?)`)
        .run("intent", batch).changes, 1);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    assert.equal(reserve(db), 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transaction_intents").get()?.n, 2);
  } finally { db.close(); }
});

test("two SQLite writers cannot reserve different batches against the same canary", () => {
  const directory = mkdtempSync(join(tmpdir(), "sportpad-canary-"));
  const filename = join(directory, "canary.sqlite");
  const first = fixture(filename);
  const second = new DatabaseSync(filename, { timeout: 50 });
  try {
    prepare(first);
    first.exec("BEGIN IMMEDIATE");
    assert.equal(reserve(first), 1);
    assert.throws(() => second.prepare(RESERVE_REWARD_CANARY_BUDGET_SQL)
      .run(launch, settlement, "batch-b", amount));
    first.exec("COMMIT");
    assert.equal(second.prepare(RESERVE_REWARD_CANARY_BUDGET_SQL)
      .run(launch, settlement, "batch-b", amount).changes, 0);
    assert.equal(second.prepare("SELECT reserved_input_lamports FROM solana_reward_purchase_canary")
      .get()?.reserved_input_lamports, 1_000_000);
  } finally {
    if (first.isOpen) first.close();
    second.close();
    unlinkSync(filename);
    rmdirSync(directory);
  }
});
