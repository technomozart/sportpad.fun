import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ASSERT_ONE_ROW_CHANGED_SQL } from "../../protocol/automation-safety.ts";
import {
  ADVANCE_AUTOMATIC_REWARD_SETTLEMENT_SQL,
  automaticRewardChunkKey,
  COMPLETE_AUTOMATIC_REWARD_CHUNK_SQL,
  INSERT_AUTOMATIC_REWARD_CHUNK_JOB_SQL,
  INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL,
  INSERT_AUTOMATIC_REWARD_CHUNK_SQL,
  planAutomaticRewardChunk,
} from "./reward-chunk-sql.ts";

const settlementId = `settlement:${"3".repeat(88)}:0`;
const nativeMint = "So11111111111111111111111111111111111111112";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      reward_amount_atomic TEXT NOT NULL, reward_spent_atomic TEXT NOT NULL DEFAULT '0',
      reward_swap_signature TEXT, buyback_swap_signature TEXT, burn_signature TEXT,
      state TEXT, updated_at TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT,
      reward_mint TEXT, mainnet_mint TEXT, mainnet_reward_treasury TEXT,
      status TEXT);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE settlement_steps (id TEXT PRIMARY KEY, settlement_id TEXT,
      stage TEXT, idempotency_key TEXT UNIQUE, state TEXT, input_mint TEXT,
      output_mint TEXT, input_amount_atomic TEXT, output_amount_atomic TEXT,
      tx_signature TEXT UNIQUE, verified_slot INTEGER, updated_at TEXT);
    CREATE UNIQUE INDEX one_active_reward_chunk ON settlement_steps(settlement_id)
      WHERE stage = 'automatic_reward_chunk' AND state <> 'verified';
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT,
      entity_type TEXT, entity_id TEXT, chain TEXT, payload_json TEXT,
      state TEXT, available_at INTEGER, tx_hash TEXT, error_code TEXT,
      UNIQUE(entity_id,job_type));
    CREATE TABLE transaction_intents (
      id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, settlement_id TEXT,
      signer_role TEXT, signer_address TEXT, action TEXT, state TEXT,
      expected_programs_json TEXT, expected_mints_json TEXT,
      maximum_spend_lamports TEXT, provider_request_id TEXT,
      unsigned_transaction_base64 TEXT, transaction_message_hash TEXT,
      last_valid_block_height INTEGER, input_mint TEXT, output_mint TEXT,
      input_amount_atomic TEXT, minimum_output_atomic TEXT,
      tx_signature TEXT UNIQUE, expires_at TEXT);
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY,
      settlement_paused INTEGER,rewards_paused INTEGER);
    CREATE TABLE reward_vaults (launch_id TEXT PRIMARY KEY, inventory_atomic TEXT);
    INSERT INTO launch_drafts VALUES
      ('community','solana','FAN','COMMUNITY','reward-treasury','mainnet_published');
    INSERT INTO fee_events VALUES ('fee-1','community');
    INSERT INTO settlements (id,fee_event_id,reward_amount_atomic,reward_spent_atomic,state)
      VALUES ('${settlementId}','fee-1','250000001','0','reconciled');
    INSERT INTO reward_vaults VALUES ('community','0');
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

function insertChunk(db: DatabaseSync, stepId: string) {
  const settlement = db.prepare("SELECT reward_amount_atomic, reward_spent_atomic FROM settlements WHERE id = ?")
    .get(settlementId) as { reward_amount_atomic: string; reward_spent_atomic: string };
  const plan = planAutomaticRewardChunk(settlement.reward_amount_atomic, settlement.reward_spent_atomic);
  if (!plan) throw new Error("all chunks complete");
  const key = automaticRewardChunkKey(settlementId, plan.offsetAtomic);
  const inserted = db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_SQL).run(
    stepId, key, plan.inputAmountLamports, settlementId,
    plan.offsetAtomic, settlement.reward_amount_atomic, "reward-treasury", null,
  );
  assert.equal(inserted.changes, 1);
  assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_JOB_SQL).run(
    `job-${stepId}`, stepId, "{}", 0,
  ).changes, 1);
  return { ...plan, key };
}

function completeChunk(db: DatabaseSync, stepId: string, signature: string,
  plan: NonNullable<ReturnType<typeof planAutomaticRewardChunk>>, vaultConflict = false,
  beforeCommit?: () => void) {
  const intentKey = `automation:reward:swap:${stepId}`;
  db.prepare(`INSERT INTO transaction_intents
    (id,idempotency_key,settlement_id,action,tx_signature,input_amount_atomic,output_mint)
    VALUES (?,?,?,?,?,?,?)`).run(
    `intent-${stepId}`,
    intentKey, settlementId, "solana_reward_purchase_automation", signature,
    plan.inputAmountLamports, "FAN",
  );
  db.prepare("UPDATE automation_jobs SET state='complete',tx_hash=? WHERE id=?")
    .run(signature, `job-${stepId}`);
  beforeCommit?.();
  atomic(db, [
    () => { db.prepare(COMPLETE_AUTOMATIC_REWARD_CHUNK_SQL).run(
      stepId, signature, "12345", 123, plan.inputAmountLamports, "FAN",
      `job-${stepId}`, intentKey,
    ); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
    () => { db.prepare(ADVANCE_AUTOMATIC_REWARD_SETTLEMENT_SQL).run(
      settlementId, plan.offsetAtomic, "250000001", plan.nextSpentAtomic,
      signature, stepId, plan.inputAmountLamports, null, "reward-treasury",
    ); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
    () => { db.prepare(`UPDATE reward_vaults SET inventory_atomic = CAST(inventory_atomic AS INTEGER) + 12345
      WHERE launch_id = 'community' AND inventory_atomic = ?`).run(vaultConflict ? "stale" :
      (db.prepare("SELECT inventory_atomic FROM reward_vaults WHERE launch_id='community'")
        .get() as { inventory_atomic: string }).inventory_atomic); },
    () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
  ]);
}

test("plans exact capped chunks without truncating decimal amounts", () => {
  assert.equal(automaticRewardChunkKey(settlementId, "0"),
    `automation:reward:chunk:${settlementId}:0`);
  assert.throws(() => automaticRewardChunkKey("11111111-1111-4111-8111-111111111111", "0"));
  assert.deepEqual(planAutomaticRewardChunk("250000001", "0"), {
    offsetAtomic: "0", inputAmountLamports: "100000000",
    nextSpentAtomic: "100000000", final: false,
  });
  assert.deepEqual(planAutomaticRewardChunk("250000001", "200000000"), {
    offsetAtomic: "200000000", inputAmountLamports: "50000001",
    nextSpentAtomic: "250000001", final: true,
  });
  assert.equal(planAutomaticRewardChunk("100000001", "100000001"), null);
  for (const [total, spent] of [["0", "0"], ["01", "0"], ["1", "2"],
    ["9223372036854775808", "0"], ["10", "-1"]]) {
    assert.throws(() => planAutomaticRewardChunk(total, spent));
  }
});

test("a chunk cannot be mis-sized, duplicated, redirected, or created for a suspended launch", () => {
  const db = fixture();
  try {
    const key = automaticRewardChunkKey(settlementId, "0");
    const bind = (id: string, amount: string, offset = "0", configuredMint: string | null = null) =>
      db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_SQL).run(
        id, automaticRewardChunkKey(settlementId, offset), amount,
        settlementId, offset, "250000001", "reward-treasury", configuredMint,
      ).changes;
    assert.equal(bind("bad-size", "250000001"), 0);
    assert.equal(bind("under-size", "99999999"), 0);
    assert.equal(bind("wrong-offset", "100000000", "1"), 0);
    assert.equal(bind("platform-owned", "100000000", "0", "COMMUNITY"), 0);
    db.exec("INSERT INTO protocol_settings VALUES ('sportpad_mint','OTHER')");
    assert.equal(bind("conflicting-platform", "100000000", "0", "SPORTPAD"), 0);
    db.exec("DELETE FROM protocol_settings");
    db.exec("UPDATE launch_drafts SET status = 'mainnet_suspended'");
    assert.equal(bind("suspended", "100000000"), 0);
    db.exec("UPDATE launch_drafts SET status = 'mainnet_published'");
    db.exec("UPDATE settlements SET state = 'failed'");
    assert.equal(bind("bad-settlement-state", "100000000"), 0);
    db.exec("UPDATE settlements SET state = 'reconciled'");
    db.exec("UPDATE protocol_controls SET rewards_paused = 1");
    assert.equal(bind("rewards-paused", "100000000"), 0);
    db.exec("UPDATE protocol_controls SET rewards_paused = 0");
    db.exec(`INSERT INTO transaction_intents (id,idempotency_key,settlement_id,action,state)
      VALUES ('manual','manual:reward','${settlementId}','reward_swap','planned')`);
    assert.equal(bind("manual-conflict", "100000000"), 0);
    db.exec("UPDATE transaction_intents SET state = 'failed' WHERE id = 'manual'");
    assert.equal(bind("first", "100000000"), 1);
    assert.equal(db.prepare("SELECT idempotency_key,input_mint FROM settlement_steps").get()?.idempotency_key, key);
    assert.equal(db.prepare("SELECT input_mint FROM settlement_steps").get()?.input_mint, nativeMint);
    assert.equal(bind("second-active", "100000000"), 0);
  } finally { db.close(); }
});

test("one armed chunk permits exactly one immutable signed order intent", () => {
  const db = fixture();
  try {
    const plan = insertChunk(db, "step-0");
    db.prepare("UPDATE automation_jobs SET state='broadcasting',error_code=? WHERE entity_id='step-0'")
      .run("broadcasting:solana:reward-treasury");
    const fields = [
      "intent-0", "automation:reward:swap:step-0", settlementId,
      "reward-treasury", '["jupiter_v2_metis_pinned"]',
      `["${nativeMint}","FAN"]`, plan.inputAmountLamports,
      "provider-0", "unsigned-base64", "a".repeat(64), 200,
      nativeMint, "FAN", plan.inputAmountLamports, "12345",
      "signature-0", "2026-09-23T12:00:00.000Z",
      "job-step-0", "broadcasting:solana:reward-treasury", "step-0", null,
    ];
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL).run(...fields).changes, 1);
    assert.throws(() => db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL).run(...fields),
      /UNIQUE constraint failed/);
    const stale = [...fields];
    stale[0] = "intent-other";
    stale[1] = "automation:reward:swap:other-step";
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL).run(...stale).changes, 0);
    db.exec("UPDATE launch_drafts SET status = 'mainnet_suspended'");
    const suspended = [...fields];
    suspended[0] = "intent-suspended";
    suspended[15] = "signature-suspended";
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL).run(...suspended).changes, 0);
    db.exec("UPDATE launch_drafts SET status = 'mainnet_published'");
    db.exec("UPDATE settlements SET reward_amount_atomic = '50000000'");
    const changedTotal = [...fields];
    changedTotal[0] = "intent-changed-total";
    changedTotal[15] = "signature-changed-total";
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL).run(...changedTotal).changes, 0);
  } finally { db.close(); }
});

test("each receipt credits once and only the final chunk marks the reward leg complete", () => {
  const db = fixture();
  try {
    for (const [index, expectedSpent] of ["100000000", "200000000", "250000001"].entries()) {
      const stepId = `step-${index}`;
      const plan = insertChunk(db, stepId);
      const signature = `swap-${index}`;
      completeChunk(db, stepId, signature, plan);
      const settlement = db.prepare("SELECT reward_spent_atomic,reward_swap_signature,state FROM settlements")
        .get() as { reward_spent_atomic: string; reward_swap_signature: string | null; state: string };
      assert.equal(settlement.reward_spent_atomic, expectedSpent);
      assert.equal(settlement.reward_swap_signature, index === 2 ? signature : null);
      assert.equal(settlement.state, index === 2 ? "reward_acquired" : "reconciled");
      assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults").get()?.inventory_atomic,
        String((index + 1) * 12345));
      assert.throws(() => atomic(db, [
        () => { db.prepare(COMPLETE_AUTOMATIC_REWARD_CHUNK_SQL).run(
          stepId, signature, "12345", 123, plan.inputAmountLamports, "FAN",
          `job-${stepId}`, `automation:reward:swap:${stepId}`,
        ); },
        () => { db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get(); },
      ]), /malformed JSON/);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settlement_steps WHERE state='verified'").get()?.n, 3);
  } finally { db.close(); }
});

test("a stale vault write rolls back both chunk verification and settlement progress", () => {
  const db = fixture();
  try {
    const plan = insertChunk(db, "stale-step");
    assert.throws(() => completeChunk(db, "stale-step", "stale-sig", plan, true), /malformed JSON/);
    assert.equal(db.prepare("SELECT reward_spent_atomic FROM settlements").get()?.reward_spent_atomic, "0");
    assert.equal(db.prepare("SELECT state FROM settlement_steps").get()?.state, "planned");
    assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults").get()?.inventory_atomic, "0");
  } finally { db.close(); }
});

test("a signed purchase credits exactly once after suspension but cannot start another order", () => {
  const db = fixture();
  try {
    const plan = insertChunk(db, "suspended-step");
    completeChunk(db, "suspended-step", "suspended-sig", plan, false,
      () => db.exec("UPDATE launch_drafts SET status = 'mainnet_suspended'"));
    assert.equal(db.prepare("SELECT reward_spent_atomic FROM settlements").get()?.reward_spent_atomic,
      "100000000");
    assert.equal(db.prepare("SELECT state FROM settlement_steps").get()?.state, "verified");
    assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults").get()?.inventory_atomic,
      "12345");
    assert.throws(() => completeChunk(db, "suspended-step", "suspended-sig", plan));
    assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults").get()?.inventory_atomic,
      "12345");
    const next = planAutomaticRewardChunk("250000001", "100000000");
    assert.ok(next);
    assert.equal(db.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_SQL).run(
      "new-suspended-step", automaticRewardChunkKey(settlementId, next.offsetAtomic),
      next.inputAmountLamports, settlementId, next.offsetAtomic, "250000001",
      "reward-treasury", null,
    ).changes, 0);
  } finally { db.close(); }
});

test("registering the source as SPORTPAD before ledger commit blocks reward credit", () => {
  const db = fixture();
  try {
    const plan = insertChunk(db, "new-platform-step");
    db.exec("INSERT INTO protocol_settings VALUES ('sportpad_mint','COMMUNITY')");
    assert.throws(() => completeChunk(db, "new-platform-step", "swap-platform", plan));
    assert.equal(db.prepare("SELECT reward_spent_atomic FROM settlements").get()?.reward_spent_atomic, "0");
    assert.equal(db.prepare("SELECT state FROM settlement_steps").get()?.state, "planned");
  } finally { db.close(); }
});
