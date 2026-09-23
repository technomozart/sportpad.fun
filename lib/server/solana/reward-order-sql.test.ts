import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { INSERT_AUTOMATIC_REWARD_INTENT_SQL } from "./reward-order-sql.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT, entity_id TEXT,
      state TEXT, error_code TEXT);
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY, settlement_paused INTEGER,
      rewards_paused INTEGER);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, mainnet_mint TEXT,
      mainnet_reward_treasury TEXT, reward_chain TEXT, reward_mint TEXT, status TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      reward_amount_atomic TEXT, reward_swap_signature TEXT, state TEXT);
    CREATE TABLE transaction_intents (
      id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, settlement_id TEXT,
      signer_role TEXT, signer_address TEXT, action TEXT, state TEXT,
      expected_programs_json TEXT, expected_mints_json TEXT,
      maximum_spend_lamports TEXT, provider_request_id TEXT,
      unsigned_transaction_base64 TEXT, transaction_message_hash TEXT,
      last_valid_block_height INTEGER, input_mint TEXT, output_mint TEXT,
      input_amount_atomic TEXT, minimum_output_atomic TEXT,
      tx_signature TEXT UNIQUE, expires_at TEXT
    );
    INSERT INTO automation_jobs VALUES ('job-1', 'solana_reward_purchase', 'settlement-1',
      'broadcasting', 'broadcasting:solana:treasury');
    INSERT INTO protocol_controls VALUES ('global', 0, 0);
    INSERT INTO protocol_settings VALUES ('sportpad_mint', 'SPORTPAD');
    INSERT INTO launch_drafts VALUES ('community', 'COMMUNITY', 'treasury', 'solana',
      'FAN', 'mainnet_published');
    INSERT INTO fee_events VALUES ('fee-1', 'community');
    INSERT INTO settlements VALUES ('settlement-1', 'fee-1', '50000000', NULL, 'reconciled');
  `);
  return db;
}

function fields() {
  return [
    "intent-1", "automation:reward:swap:settlement-1", "settlement-1", "treasury",
    '["jupiter_v2_metis_pinned"]', '["SOL","FAN"]',
    "50000000", "request-1", "unsigned-base64", "a".repeat(64),
    200, "SOL", "FAN", "50000000", "990000", "swap-signature",
    "2026-09-23T12:00:00.000Z", "job-1", "broadcasting:solana:treasury", null,
  ];
}

test("persists one reward order for an armed community settlement", () => {
  const db = database();
  try {
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_INTENT_SQL).run(...fields()).changes, 1);
    const intent = db.prepare("SELECT action, signer_role, output_mint FROM transaction_intents").get();
    assert.deepEqual({ ...intent }, { action: "solana_reward_purchase_automation",
      signer_role: "reward_treasury", output_mint: "FAN" });
    assert.throws(() => db.prepare(INSERT_AUTOMATIC_REWARD_INTENT_SQL).run(...fields()),
      /UNIQUE constraint failed/);
  } finally { db.close(); }
});

test("rejects a stale, paused, misdirected, or platform-owned reward order", () => {
  const mutations = [
    "UPDATE automation_jobs SET state = 'leased' WHERE id = 'job-1'",
    "UPDATE automation_jobs SET error_code = 'broadcasting:solana:other' WHERE id = 'job-1'",
    "UPDATE protocol_controls SET settlement_paused = 1 WHERE key = 'global'",
    "UPDATE protocol_controls SET rewards_paused = 1 WHERE key = 'global'",
    "UPDATE launch_drafts SET status = 'draft' WHERE id = 'community'",
    "UPDATE launch_drafts SET mainnet_mint = 'SPORTPAD' WHERE id = 'community'",
    "UPDATE launch_drafts SET mainnet_reward_treasury = 'other' WHERE id = 'community'",
    "UPDATE launch_drafts SET reward_chain = 'chiliz' WHERE id = 'community'",
    "UPDATE launch_drafts SET reward_mint = 'OTHER' WHERE id = 'community'",
    "UPDATE settlements SET reward_amount_atomic = '0' WHERE id = 'settlement-1'",
    "UPDATE settlements SET reward_amount_atomic = '60000000' WHERE id = 'settlement-1'",
    "UPDATE settlements SET reward_swap_signature = 'old-swap' WHERE id = 'settlement-1'",
    "UPDATE settlements SET state = 'failed' WHERE id = 'settlement-1'",
  ];
  for (const mutation of mutations) {
    const db = database();
    try {
      db.exec(mutation);
      assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_INTENT_SQL).run(...fields()).changes, 0, mutation);
    } finally { db.close(); }
  }
});

test("accepts a community reward before the platform mint exists", () => {
  const db = database();
  try {
    db.exec("DELETE FROM protocol_settings WHERE key = 'sportpad_mint'");
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_INTENT_SQL).run(...fields()).changes, 1);
  } finally { db.close(); }
});

test("configured platform mint excludes itself and conflicts with a different DB mint", () => {
  const db = database();
  try {
    const configured = fields();
    configured[19] = "OTHER_PLATFORM";
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_INTENT_SQL).run(...configured).changes, 0);
    db.exec("DELETE FROM protocol_settings WHERE key = 'sportpad_mint'");
    db.exec("UPDATE launch_drafts SET mainnet_mint = 'SPORTPAD' WHERE id = 'community'");
    configured[19] = "SPORTPAD";
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_INTENT_SQL).run(...configured).changes, 0);
  } finally { db.close(); }
});
