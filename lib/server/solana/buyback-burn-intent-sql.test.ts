import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { COMPLETE_AUTOMATIC_BUYBACK_BURN_INTENT_SQL,
  INSERT_AUTOMATIC_BUYBACK_BURN_INTENT_SQL } from "./buyback-burn-intent-sql.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT, entity_type TEXT,
      entity_id TEXT, chain TEXT, state TEXT, error_code TEXT);
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY, settlement_paused INTEGER,
      buyback_paused INTEGER);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, mainnet_mint TEXT,
      mainnet_buyback_treasury TEXT, status TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      buyback_swap_signature TEXT, burn_signature TEXT, state TEXT);
    CREATE TABLE transaction_intents (
      id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, settlement_id TEXT,
      signer_role TEXT, signer_address TEXT, action TEXT, state TEXT,
      expected_programs_json TEXT, expected_mints_json TEXT,
      maximum_spend_lamports TEXT, provider_request_id TEXT,
      unsigned_transaction_base64 TEXT, transaction_message_hash TEXT,
      last_valid_block_height INTEGER, input_mint TEXT,
      input_amount_atomic TEXT, tx_signature TEXT UNIQUE, expires_at TEXT,
      updated_at TEXT
    );
    INSERT INTO automation_jobs VALUES ('job-1', 'sportpad_buyback_burn',
      'settlement', 'settlement-1', 'solana', 'broadcasting',
      'broadcasting:solana:treasury');
    INSERT INTO protocol_controls VALUES ('global', 0, 0);
    INSERT INTO protocol_settings VALUES ('sportpad_mint', 'SPORTPAD');
    INSERT INTO launch_drafts VALUES ('community', 'COMMUNITY', 'treasury',
      'mainnet_published');
    INSERT INTO fee_events VALUES ('fee-1', 'community');
    INSERT INTO settlements VALUES ('settlement-1', 'fee-1', NULL, NULL, 'reconciled');
    INSERT INTO transaction_intents
      (id, idempotency_key, settlement_id, signer_role, signer_address,
       action, state, tx_signature, expires_at)
    VALUES ('swap-intent', 'automation:buyback:swap:settlement-1', 'settlement-1',
      'buyback_treasury', 'treasury', 'sportpad_buyback_automation',
      'prepared', 'swap-signature', '2026-09-23T12:00:00.000Z');
  `);
  return db;
}

function fields() {
  return [
    "burn-intent", "automation:buyback:burn:settlement-1", "settlement-1", "treasury",
    '["TokenProgram"]', '["SPORTPAD"]', "blockhash", "signed-base64", "a".repeat(64),
    200, "SPORTPAD", "123", "burn-signature", "2026-09-23T12:00:00.000Z",
    "job-1", "broadcasting:solana:treasury", "swap-signature",
  ];
}

test("persists one exact buyback burn only after its swap intent", () => {
  const db = database();
  try {
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_BURN_INTENT_SQL).run(...fields()).changes, 1);
    assert.throws(() => db.prepare(INSERT_AUTOMATIC_BUYBACK_BURN_INTENT_SQL).run(...fields()),
      /UNIQUE constraint failed/);
    assert.equal(db.prepare(COMPLETE_AUTOMATIC_BUYBACK_BURN_INTENT_SQL).run(
      "automation:buyback:burn:settlement-1", "settlement-1", "wrong-signature").changes, 0);
    assert.equal(db.prepare(COMPLETE_AUTOMATIC_BUYBACK_BURN_INTENT_SQL).run(
      "automation:buyback:burn:settlement-1", "settlement-1", "burn-signature").changes, 1);
  } finally { db.close(); }
});

test("rejects a paused, stale, misdirected, or unlinked burn", () => {
  const mutations = [
    "UPDATE automation_jobs SET state = 'leased' WHERE id = 'job-1'",
    "UPDATE automation_jobs SET error_code = 'broadcasting:solana:other' WHERE id = 'job-1'",
    "UPDATE protocol_controls SET settlement_paused = 1 WHERE key = 'global'",
    "UPDATE protocol_controls SET buyback_paused = 1 WHERE key = 'global'",
    "UPDATE protocol_settings SET value = 'OTHER' WHERE key = 'sportpad_mint'",
    "UPDATE launch_drafts SET status = 'draft' WHERE id = 'community'",
    "UPDATE launch_drafts SET mainnet_mint = 'SPORTPAD' WHERE id = 'community'",
    "UPDATE launch_drafts SET mainnet_buyback_treasury = 'other' WHERE id = 'community'",
    "UPDATE settlements SET buyback_swap_signature = 'old-swap' WHERE id = 'settlement-1'",
    "UPDATE settlements SET state = 'failed' WHERE id = 'settlement-1'",
    "UPDATE transaction_intents SET tx_signature = 'other' WHERE id = 'swap-intent'",
  ];
  for (const mutation of mutations) {
    const db = database();
    try {
      db.exec(mutation);
      assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_BURN_INTENT_SQL).run(...fields()).changes, 0,
        mutation);
    } finally { db.close(); }
  }
});
