import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { failureDisposition, FINANCIAL_LEDGER_VERIFIED, HOLD_BROADCAST_RECEIPT_SQL,
  laneAllowsJob, ownsActiveLease, ownsBroadcast, pauseConditionSql,
  QUEUE_CLAIM_JOB_SQL } from "./automation-safety.ts";

const openLanes = {
  mainnetEnabled: true, settlementEnabled: true, rewardsEnabled: true,
  claimsEnabled: true, buybackEnabled: true, settlementPaused: false,
  rewardsPaused: false, buybackPaused: false,
};

test("financial execution remains statically held pending ledger verification", () => {
  assert.equal(FINANCIAL_LEDGER_VERIFIED, false);
});

test("financial lanes respect their flags and independent pause controls", () => {
  assert.equal(laneAllowsJob("chiliz_reward_purchase", openLanes), true);
  assert.equal(laneAllowsJob("chiliz_claim_unwrap", openLanes), true);
  assert.equal(laneAllowsJob("solana_claim_payout", openLanes), true);
  assert.equal(laneAllowsJob("sportpad_buyback_burn", openLanes), true);
  for (const type of ["chiliz_reward_purchase", "chiliz_claim_unwrap", "solana_claim_payout", "sportpad_buyback_burn"] as const) {
    assert.equal(laneAllowsJob(type, { ...openLanes, mainnetEnabled: false }), false);
  }
  assert.equal(laneAllowsJob("chiliz_reward_purchase", { ...openLanes, settlementPaused: true }), false);
  assert.equal(laneAllowsJob("sportpad_buyback_burn", { ...openLanes, settlementPaused: true }), false);
  assert.equal(laneAllowsJob("chiliz_claim_unwrap", { ...openLanes, settlementPaused: true }), true);
  assert.equal(laneAllowsJob("chiliz_reward_purchase", { ...openLanes, rewardsPaused: true }), false);
  assert.equal(laneAllowsJob("chiliz_claim_unwrap", { ...openLanes, rewardsPaused: true }), false);
  assert.equal(laneAllowsJob("solana_claim_payout", { ...openLanes, claimsEnabled: false }), false);
  assert.equal(laneAllowsJob("sportpad_buyback_burn", { ...openLanes, buybackPaused: true }), false);
  assert.equal(laneAllowsJob("chiliz_claim_unwrap", { ...openLanes, buybackPaused: true }), true);
});

test("arming checks the matching database pause columns atomically", () => {
  assert.equal(pauseConditionSql("chiliz_reward_purchase"), "settlement_paused = 0 AND rewards_paused = 0");
  assert.equal(pauseConditionSql("chiliz_claim_unwrap"), "rewards_paused = 0");
  assert.equal(pauseConditionSql("solana_claim_payout"), "rewards_paused = 0");
  assert.equal(pauseConditionSql("sportpad_buyback_burn"), "settlement_paused = 0 AND buyback_paused = 0");
  assert.equal(pauseConditionSql("unknown"), null);
});

test("only an unexpired lease owner can arm a job", () => {
  const job = { state: "leased", leased_until: 100, error_code: "leased:worker-a" };
  assert.equal(ownsActiveLease(job, "worker-a", 100), true);
  assert.equal(ownsActiveLease(job, "worker-a", 101), false);
  assert.equal(ownsActiveLease(job, "worker-b", 90), false);
});

test("broadcasting jobs cannot be armed again and only their owner may complete", () => {
  const job = { state: "broadcasting", leased_until: null, error_code: "broadcasting:worker-a" };
  assert.equal(ownsActiveLease(job, "worker-a", 0), false);
  assert.equal(ownsBroadcast(job, "worker-a"), true);
  assert.equal(ownsBroadcast(job, "worker-b"), false);
});

test("an ambiguous broadcast always requires reconciliation, regardless of retry hint", () => {
  assert.deepEqual(failureDisposition(true, true), { state: "reconciliation_required", retry: false });
  assert.deepEqual(failureDisposition(true, false), { state: "reconciliation_required", retry: false });
  assert.deepEqual(failureDisposition(false, true), { state: "queued", retry: true });
  assert.deepEqual(failureDisposition(false, false), { state: "failed", retry: false });
});

test("a definitively failed claim job can be requeued but a broadcasting job cannot", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE reward_claims (id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE automation_jobs (
      id TEXT PRIMARY KEY, job_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, chain TEXT NOT NULL, payload_json TEXT NOT NULL,
      state TEXT NOT NULL, available_at INTEGER NOT NULL, attempt INTEGER DEFAULT 0,
      tx_hash TEXT, error_code TEXT, leased_until INTEGER, updated_at TEXT
    );
    CREATE UNIQUE INDEX job_entity_type ON automation_jobs(entity_id, job_type);
  `);
  db.prepare("INSERT INTO reward_claims (id, state) VALUES (?, ?)").run("claim-1", "claimable");
  db.prepare("INSERT INTO automation_jobs (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("old", "chiliz_claim_unwrap", "reward_claim", "claim-1", "chiliz", "{}", "failed", 0);
  const queue = db.prepare(QUEUE_CLAIM_JOB_SQL);
  assert.equal(queue.run("new", "chiliz_claim_unwrap", "claim-1", "chiliz", "{}", 1).changes, 1);
  assert.equal(db.prepare("SELECT state FROM automation_jobs WHERE id = 'new'").get()?.state, "queued");
  db.prepare("UPDATE automation_jobs SET state = 'broadcasting' WHERE id = 'new'").run();
  assert.equal(queue.run("unsafe", "chiliz_claim_unwrap", "claim-1", "chiliz", "{}", 2).changes, 0);
  assert.equal(db.prepare("SELECT state FROM automation_jobs WHERE id = 'new'").get()?.state, "broadcasting");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_jobs").get()?.count, 1);
  db.close();
});

test("a held broadcast preserves evidence once without marking the job complete", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (
      id TEXT PRIMARY KEY, state TEXT, tx_hash TEXT, payload_json TEXT,
      error_code TEXT, leased_until INTEGER, updated_at TEXT
    );
  `);
  db.prepare("INSERT INTO automation_jobs VALUES (?, ?, NULL, ?, ?, NULL, NULL)")
    .run("job-1", "broadcasting", "{}", "broadcasting:worker-a");
  const receipt = JSON.stringify({ txHash: "0x123", sourceTxHash: null, outputAmountAtomic: "5" });
  const hold = db.prepare(HOLD_BROADCAST_RECEIPT_SQL);
  assert.equal(hold.run("job-1", "0x123", receipt, "broadcasting:worker-a").changes, 1);
  const row = db.prepare("SELECT state, tx_hash, payload_json FROM automation_jobs WHERE id = ?").get("job-1");
  assert.equal(row?.state, "reconciliation_required");
  assert.equal(row?.tx_hash, "0x123");
  assert.deepEqual(JSON.parse(String(row?.payload_json)).reconciliationReceipt, JSON.parse(receipt));
  assert.equal(hold.run("job-1", "0x456", receipt, "broadcasting:worker-a").changes, 0);
  db.close();
});
