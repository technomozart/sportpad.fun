import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  ARCHIVE_EXPIRED_BUYBACK_CHUNK_BURN_INTENT_SQL,
  CONFIRM_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_JOB_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL,
  RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL,
  automaticBuybackChunkKey,
} from "./buyback-chunk-sql.ts";

const settlementId = `settlement:${"1".repeat(88)}:0`;
const nativeMint = "So11111111111111111111111111111111111111112";
const stepId = "step-1";
const jobId = "job-1";
const fence = "broadcasting:solana:treasury";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      buyback_amount_atomic TEXT NOT NULL, buyback_spent_atomic TEXT NOT NULL DEFAULT '0',
      buyback_swap_signature TEXT, burn_signature TEXT, state TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, mainnet_mint TEXT,
      mainnet_buyback_treasury TEXT, status TEXT);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY,
      settlement_paused INTEGER, buyback_paused INTEGER);
    CREATE TABLE settlement_steps (id TEXT PRIMARY KEY, settlement_id TEXT,
      stage TEXT, idempotency_key TEXT UNIQUE, state TEXT, input_mint TEXT,
      output_mint TEXT, input_amount_atomic TEXT, output_amount_atomic TEXT,
      tx_signature TEXT UNIQUE, burn_signature TEXT UNIQUE, verified_slot INTEGER,
      updated_at TEXT);
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT,
      entity_type TEXT, entity_id TEXT, chain TEXT, payload_json TEXT,
      state TEXT, available_at INTEGER, tx_hash TEXT, error_code TEXT);
    CREATE TABLE transaction_intents (id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE, settlement_id TEXT, signer_role TEXT,
      signer_address TEXT, action TEXT, state TEXT, expected_programs_json TEXT,
      expected_mints_json TEXT, maximum_spend_lamports TEXT,
      provider_request_id TEXT, unsigned_transaction_base64 TEXT,
      transaction_message_hash TEXT, last_valid_block_height INTEGER,
      input_mint TEXT, output_mint TEXT, input_amount_atomic TEXT,
      minimum_output_atomic TEXT, tx_signature TEXT UNIQUE, expires_at TEXT,
      error_code TEXT, updated_at TEXT);
    INSERT INTO launch_drafts VALUES
      ('community','COMMUNITY','treasury','mainnet_published');
    INSERT INTO fee_events VALUES ('fee-1','community');
    INSERT INTO protocol_settings VALUES ('sportpad_mint','SPORTPAD');
    INSERT INTO protocol_controls VALUES ('global',0,0);
    INSERT INTO settlements VALUES ('${settlementId}','fee-1','100000000','0',NULL,NULL,'reconciled');
  `);
  assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL).run(
    stepId, automaticBuybackChunkKey(settlementId, "0"), "100000000",
    settlementId, "0", "100000000", "treasury", "SPORTPAD",
  ).changes, 1);
  assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_JOB_SQL).run(
    jobId, stepId, "{}", 0,
  ).changes, 1);
  db.prepare("UPDATE automation_jobs SET state='broadcasting',error_code=? WHERE id=?")
    .run(fence, jobId);
  return db;
}

function swapFields() {
  return [
    "swap-intent", `automation:buyback:swap:${stepId}`, settlementId,
    "treasury", '["jupiter_v2_metis_pinned"]',
    `["${nativeMint}","SPORTPAD"]`, "100000000", "jupiter-order",
    "unsigned-swap", "a".repeat(64), 200, nativeMint, "SPORTPAD",
    "100000000", "1", "swap-signature", "2026-09-23T12:00:00.000Z",
    jobId, fence, stepId,
  ];
}

function burnFields() {
  return [
    "burn-intent", `automation:buyback:burn:${stepId}`, settlementId,
    "treasury", '["TokenProgram"]', '["SPORTPAD"]', "blockhash",
    "signed-burn", "b".repeat(64), 200, "SPORTPAD", "12345",
    "burn-signature", "2026-09-23T12:00:00.000Z", jobId, fence,
    "swap-signature", stepId,
  ];
}

test("a buyback chunk persists the exact swap, then burn only after swap verification", () => {
  const db = fixture();
  try {
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL)
      .run(...burnFields()).changes, 0);
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL)
      .run(...swapFields()).changes, 1);
    assert.equal(db.prepare(CONFIRM_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL)
      .run(`automation:buyback:swap:${stepId}`, settlementId, "swap-signature").changes, 1);
    assert.equal(db.prepare(RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL).run(
      stepId, "swap-signature", "12345", 123, "100000000", "SPORTPAD",
      jobId, `automation:buyback:swap:${stepId}`,
    ).changes, 1);
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL)
      .run(...burnFields()).changes, 1);
    assert.throws(() => db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL)
      .run(...burnFields()), /UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT buyback_spent_atomic FROM settlements").get()?.buyback_spent_atomic,
      "0", "a swap alone must not credit the parent settlement");
  } finally { db.close(); }
});

test("a buyback chunk intent rejects wrong step, stale job, pause and mismatched output", () => {
  for (const mutation of [
    "UPDATE automation_jobs SET state='leased'",
    "UPDATE protocol_controls SET buyback_paused=1",
    "UPDATE launch_drafts SET mainnet_mint='SPORTPAD'",
    "UPDATE launch_drafts SET status='mainnet_suspended'",
    "UPDATE protocol_settings SET value='OTHER'",
  ]) {
    const db = fixture();
    try {
      db.exec(mutation);
      assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL)
        .run(...swapFields()).changes, 0, mutation);
    } finally { db.close(); }
  }
  const db = fixture();
  try {
    const wrongStep = swapFields();
    wrongStep[19] = "other-step";
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL)
      .run(...wrongStep).changes, 0);
    const wrongMint = swapFields();
    wrongMint[12] = "OTHER";
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL)
      .run(...wrongMint).changes, 0);
  } finally { db.close(); }
});

test("a proven-expired burn attempt is archived, not overwritten", () => {
  const db = fixture();
  try {
    db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL).run(...swapFields());
    db.prepare(CONFIRM_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL)
      .run(`automation:buyback:swap:${stepId}`, settlementId, "swap-signature");
    db.prepare(RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL).run(
      stepId, "swap-signature", "12345", 123, "100000000", "SPORTPAD",
      jobId, `automation:buyback:swap:${stepId}`);
    db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL).run(...burnFields());
    assert.equal(db.prepare(ARCHIVE_EXPIRED_BUYBACK_CHUNK_BURN_INTENT_SQL).run(
      stepId, "wrong-signature", "b".repeat(64), jobId, fence).changes, 0);
    assert.equal(db.prepare(ARCHIVE_EXPIRED_BUYBACK_CHUNK_BURN_INTENT_SQL).run(
      stepId, "burn-signature", "b".repeat(64), jobId, fence).changes, 1);
    const replacement = burnFields();
    replacement[0] = "replacement-intent";
    replacement[12] = "replacement-signature";
    assert.equal(db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL)
      .run(...replacement).changes, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transaction_intents WHERE action='sportpad_burn_automation'")
      .get()?.n, 2);
    assert.equal(db.prepare("SELECT state FROM transaction_intents WHERE tx_signature='burn-signature'")
      .get()?.state, "expired");
    assert.equal(db.prepare("SELECT tx_signature FROM transaction_intents WHERE idempotency_key=?")
      .get(`automation:buyback:burn:${stepId}`)?.tx_signature, "replacement-signature");
  } finally { db.close(); }
});
