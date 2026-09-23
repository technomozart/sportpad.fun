import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ASSERT_ONE_ROW_CHANGED_SQL } from "../../protocol/automation-safety.ts";
import {
  ADVANCE_AUTOMATIC_BUYBACK_SETTLEMENT_SQL,
  automaticBuybackChunkKey,
  COMPLETE_AUTOMATIC_BUYBACK_CHUNK_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_JOB_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL,
  planAutomaticBuybackChunk,
  RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL,
} from "./buyback-chunk-sql.ts";

const settlementId = `settlement:${"1".repeat(88)}:0`;
const total = "250000001";
const nativeMint = "So11111111111111111111111111111111111111112";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      buyback_amount_atomic TEXT NOT NULL, buyback_spent_atomic TEXT NOT NULL DEFAULT '0',
      reward_swap_signature TEXT, buyback_swap_signature TEXT, burn_signature TEXT,
      state TEXT, updated_at TEXT);
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
    CREATE UNIQUE INDEX one_active_buyback_chunk ON settlement_steps(settlement_id)
      WHERE stage = 'automatic_buyback_chunk' AND state <> 'verified';
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT,
      entity_type TEXT, entity_id TEXT, chain TEXT, payload_json TEXT,
      state TEXT, available_at INTEGER, tx_hash TEXT, error_code TEXT,
      UNIQUE(entity_id,job_type));
    CREATE TABLE transaction_intents (idempotency_key TEXT PRIMARY KEY,
      settlement_id TEXT, action TEXT, tx_signature TEXT UNIQUE,
      state TEXT, input_amount_atomic TEXT, input_mint TEXT, output_mint TEXT);
    INSERT INTO launch_drafts VALUES
      ('community','COMMUNITY','buyback-treasury','mainnet_published');
    INSERT INTO fee_events VALUES ('fee-1','community');
    INSERT INTO protocol_settings VALUES ('sportpad_mint','SPORTPAD');
    INSERT INTO protocol_controls VALUES ('global',0,0);
    INSERT INTO settlements (id,fee_event_id,buyback_amount_atomic,buyback_spent_atomic,state)
      VALUES ('${settlementId}','fee-1','${total}','0','reconciled');
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

function insertChunk(db: DatabaseSync, stepId: string) {
  const row = db.prepare("SELECT buyback_amount_atomic,buyback_spent_atomic FROM settlements")
    .get() as { buyback_amount_atomic: string; buyback_spent_atomic: string };
  const plan = planAutomaticBuybackChunk(row.buyback_amount_atomic, row.buyback_spent_atomic);
  if (!plan) throw new Error("all chunks complete");
  const key = automaticBuybackChunkKey(settlementId, plan.offsetAtomic);
  atomic(db, [
    () => { db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL).run(stepId, key,
      plan.inputAmountLamports, settlementId, plan.offsetAtomic, total,
      "buyback-treasury", "SPORTPAD"); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
    () => { db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_JOB_SQL).run(`job-${stepId}`, stepId, "{}", 0); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
  ]);
  return plan;
}

function completeChunk(db: DatabaseSync, stepId: string,
  plan: NonNullable<ReturnType<typeof planAutomaticBuybackChunk>>,
  options: { staleOffset?: boolean; skipBurnIntent?: boolean } = {}) {
  const swap = `swap-${stepId}`;
  const burn = `burn-${stepId}`;
  db.prepare("UPDATE automation_jobs SET state='broadcasting' WHERE id=?").run(`job-${stepId}`);
  db.prepare(`INSERT INTO transaction_intents VALUES (?,?,?,?,?,?,?,?)`).run(
    `automation:buyback:swap:${stepId}`, settlementId,
    "sportpad_buyback_automation", swap, "confirmed", plan.inputAmountLamports,
    nativeMint, "SPORTPAD");
  atomic(db, [
    () => { db.prepare(RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL).run(
      stepId, swap, "12345", 123, plan.inputAmountLamports, "SPORTPAD",
      `job-${stepId}`, `automation:buyback:swap:${stepId}`); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
  ]);
  assert.equal(db.prepare("SELECT buyback_spent_atomic FROM settlements").get()?.buyback_spent_atomic,
    plan.offsetAtomic, "a finalized swap alone must not advance the parent");
  if (!options.skipBurnIntent) {
    db.prepare(`INSERT INTO transaction_intents VALUES (?,?,?,?,?,?,?,?)`).run(
      `automation:buyback:burn:${stepId}`, settlementId,
      "sportpad_burn_automation", burn, "confirmed", "12345", "SPORTPAD", null);
  }
  db.prepare("UPDATE automation_jobs SET state='complete',tx_hash=? WHERE id=?")
    .run(burn, `job-${stepId}`);
  atomic(db, [
    () => { db.prepare(COMPLETE_AUTOMATIC_BUYBACK_CHUNK_SQL).run(
      stepId, swap, burn, "12345", `job-${stepId}`,
      `automation:buyback:swap:${stepId}`, `automation:buyback:burn:${stepId}`); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
    () => { db.prepare(ADVANCE_AUTOMATIC_BUYBACK_SETTLEMENT_SQL).run(
      settlementId, options.staleOffset ? "999" : plan.offsetAtomic, total,
      plan.nextSpentAtomic, swap, burn, stepId, plan.inputAmountLamports); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
  ]);
}

test("plans capped 0.1 SOL buyback chunks with an exact final remainder", () => {
  assert.deepEqual(planAutomaticBuybackChunk(total, "0"), {
    offsetAtomic: "0", inputAmountLamports: "100000000",
    nextSpentAtomic: "100000000", final: false,
  });
  assert.deepEqual(planAutomaticBuybackChunk(total, "200000000"), {
    offsetAtomic: "200000000", inputAmountLamports: "50000001",
    nextSpentAtomic: total, final: true,
  });
  assert.equal(planAutomaticBuybackChunk(total, total), null);
  for (const [badTotal, badSpent] of [["0", "0"], ["01", "0"], ["10", "11"],
    ["9223372036854775808", "0"], ["10", "-1"]]) {
    assert.throws(() => planAutomaticBuybackChunk(badTotal, badSpent));
  }
  assert.equal(automaticBuybackChunkKey(settlementId, "0"),
    `automation:buyback:chunk:${settlementId}:0`);
  const largestSafeIndexId = `settlement:${"1".repeat(88)}:9007199254740991`;
  assert.equal(automaticBuybackChunkKey(largestSafeIndexId, "0"),
    `automation:buyback:chunk:${largestSafeIndexId}:0`);
  for (const invalid of ["11111111-1111-4111-8111-111111111111", `settlement:${"1".repeat(88)}:00`,
    `settlement:${"0".repeat(88)}:0`, `settlement:${"1".repeat(63)}:0`,
    `settlement:${"1".repeat(88)}:9007199254740992`]) {
    assert.throws(() => automaticBuybackChunkKey(invalid, "0"), /settlement_id_invalid/);
  }
});

test("insert refuses an oversize, duplicate, misrouted, paused, or platform-owned chunk", () => {
  const db = fixture();
  try {
    const bind = (id: string, amount: string, offset = "0") => db.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL)
      .run(id, automaticBuybackChunkKey(settlementId, offset), amount,
        settlementId, offset, total, "buyback-treasury", "SPORTPAD").changes;
    assert.equal(bind("oversize", total), 0);
    assert.equal(bind("undersize", "99999999"), 0);
    assert.equal(bind("wrong-offset", "100000000", "1"), 0);
    db.exec("UPDATE protocol_controls SET buyback_paused=1");
    assert.equal(bind("paused", "100000000"), 0);
    db.exec("UPDATE protocol_controls SET buyback_paused=0");
    db.exec("UPDATE launch_drafts SET status='mainnet_suspended'");
    assert.equal(bind("suspended", "100000000"), 0);
    db.exec("UPDATE launch_drafts SET status='mainnet_published',mainnet_mint='SPORTPAD'");
    assert.equal(bind("platform-owned", "100000000"), 0);
    db.exec("UPDATE launch_drafts SET mainnet_mint='COMMUNITY'");
    assert.equal(bind("first", "100000000"), 1);
    assert.equal(bind("second", "100000000"), 0);
    assert.equal(db.prepare("SELECT input_mint FROM settlement_steps").get()?.input_mint, nativeMint);
  } finally { db.close(); }
});

test("three swap-and-burn chunks advance once; final signatures are pointers", () => {
  const db = fixture();
  try {
    for (const [index, expectedSpent] of ["100000000", "200000000", total].entries()) {
      const stepId = `step-${index}`;
      const plan = insertChunk(db, stepId);
      completeChunk(db, stepId, plan);
      const parent = db.prepare(`SELECT buyback_spent_atomic,buyback_swap_signature,burn_signature,state
        FROM settlements`).get() as Record<string, string | null>;
      assert.equal(parent.buyback_spent_atomic, expectedSpent);
      assert.equal(parent.buyback_swap_signature, index === 2 ? `swap-${stepId}` : null);
      assert.equal(parent.burn_signature, index === 2 ? `burn-${stepId}` : null);
      assert.equal(parent.state, index === 2 ? "buyback_burned" : "reconciled");
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settlement_steps WHERE state='verified'").get()?.n, 3);
    assert.equal(planAutomaticBuybackChunk(total, total), null);
  } finally { db.close(); }
});

test("missing burn proof or stale offset rolls back chunk and parent together", () => {
  for (const options of [{ skipBurnIntent: true }, { staleOffset: true }]) {
    const db = fixture();
    try {
      const plan = insertChunk(db, "step-0");
      assert.throws(() => completeChunk(db, "step-0", plan, options), /malformed JSON/);
      assert.equal(db.prepare("SELECT buyback_spent_atomic FROM settlements").get()?.buyback_spent_atomic, "0");
      assert.equal(db.prepare("SELECT state FROM settlement_steps").get()?.state, "swap_verified");
      assert.equal(db.prepare("SELECT burn_signature FROM settlement_steps").get()?.burn_signature, null);
    } finally { db.close(); }
  }
});
