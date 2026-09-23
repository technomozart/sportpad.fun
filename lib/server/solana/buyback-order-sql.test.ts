import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { INSERT_AUTOMATIC_BUYBACK_INTENT_SQL } from "./buyback-order-sql.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (
      id TEXT PRIMARY KEY, job_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      state TEXT NOT NULL, error_code TEXT NOT NULL
    );
    CREATE TABLE protocol_controls (
      key TEXT PRIMARY KEY, settlement_paused INTEGER NOT NULL, buyback_paused INTEGER NOT NULL
    );
    CREATE TABLE transaction_intents (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
      settlement_id TEXT NOT NULL, signer_role TEXT NOT NULL,
      signer_address TEXT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL,
      expected_programs_json TEXT NOT NULL, expected_mints_json TEXT NOT NULL,
      maximum_spend_lamports TEXT NOT NULL, provider_request_id TEXT,
      unsigned_transaction_base64 TEXT, transaction_message_hash TEXT,
      last_valid_block_height INTEGER, input_mint TEXT, output_mint TEXT,
      input_amount_atomic TEXT, minimum_output_atomic TEXT,
      tx_signature TEXT UNIQUE, expires_at TEXT NOT NULL
    );
    INSERT INTO automation_jobs VALUES
      ('job-1', 'sportpad_buyback_burn', 'settlement-1', 'broadcasting', 'broadcasting:solana:treasury');
    INSERT INTO protocol_controls VALUES ('global', 0, 0);
  `);
  return db;
}

function fields({ intentId = "intent-1", signature = "swap-signature", worker = "solana:treasury",
  jobId = "job-1" } = {}) {
  return [
    intentId, "automation:buyback:swap:settlement-1", "settlement-1", "treasury",
    '["jupiter_v2_metis_pinned"]', '["SOL","SPORTPAD"]',
    "50000000", "request-1", "unsigned-base64", "a".repeat(64),
    200, "SOL", "SPORTPAD", "50000000", "995000", signature,
    "2026-09-23T12:00:00.000Z", jobId, `broadcasting:${worker}`,
  ];
}

test("persists exactly one order only for the armed buyback job", () => {
  const db = database();
  try {
    const result = db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields());
    assert.equal(result.changes, 1);
    const row = db.prepare("SELECT action, state, tx_signature FROM transaction_intents")
      .get() as { action: string; state: string; tx_signature: string };
    assert.deepEqual({ ...row }, { action: "sportpad_buyback_automation", state: "prepared", tx_signature: "swap-signature" });
  } finally { db.close(); }
});

test("does not persist an order for an unarmed job or a different worker fence", () => {
  const db = database();
  try {
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields({ worker: "solana:other" })).changes, 0);
    db.exec("UPDATE automation_jobs SET state = 'leased' WHERE id = 'job-1'");
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields()).changes, 0);
    db.exec("UPDATE automation_jobs SET state = 'broadcasting', job_type = 'solana_claim_payout' WHERE id = 'job-1'");
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields()).changes, 0);
  } finally { db.close(); }
});

test("does not persist when settlement or buyback has been paused", () => {
  const db = database();
  try {
    db.exec("UPDATE protocol_controls SET buyback_paused = 1 WHERE key = 'global'");
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields()).changes, 0);
    db.exec("UPDATE protocol_controls SET buyback_paused = 0, settlement_paused = 1 WHERE key = 'global'");
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields()).changes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transaction_intents").get()?.count, 0);
  } finally { db.close(); }
});

test("a duplicate idempotency key cannot replace the original signed order", () => {
  const db = database();
  try {
    db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields());
    assert.throws(() => db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL)
      .run(...fields({ intentId: "intent-2", signature: "different-swap" })), /UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT tx_signature FROM transaction_intents").get()?.tx_signature, "swap-signature");
  } finally { db.close(); }
});

test("a transaction signature cannot be bound to a second intent", () => {
  const db = database();
  try {
    db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...fields());
    db.exec("INSERT INTO automation_jobs VALUES ('job-2', 'sportpad_buyback_burn', 'settlement-2', 'broadcasting', 'broadcasting:solana:treasury')");
    const second = fields({ intentId: "intent-2" });
    second[1] = "automation:buyback:swap:settlement-2";
    second[2] = "settlement-2";
    second[17] = "job-2";
    assert.throws(() => db.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).run(...second), /UNIQUE constraint failed/);
  } finally { db.close(); }
});
