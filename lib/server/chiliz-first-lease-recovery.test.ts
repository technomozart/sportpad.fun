import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { CHILIZ_FIRST_LEASE_ELIGIBLE_SQL,
  REQUEUE_UNPREPARED_CHILIZ_FIRST_LEASE_SQL } from "./chiliz-first-lease-recovery.ts";

const worker = `chiliz:0x${"a".repeat(40)}`;

function fixture(jobType: "chiliz_reward_purchase" | "chiliz_claim_unwrap" =
  "chiliz_reward_purchase", state: "queued" | "leased" = "queued") {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (
      id TEXT PRIMARY KEY, chain TEXT NOT NULL, job_type TEXT NOT NULL,
      state TEXT NOT NULL, attempt INTEGER NOT NULL, error_code TEXT,
      tx_hash TEXT, payload_json TEXT NOT NULL, leased_until INTEGER,
      available_at INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE chiliz_signed_intents (job_id TEXT NOT NULL);
    CREATE TABLE chiliz_intent_policy (
      key TEXT NOT NULL, authorized_job_id TEXT NOT NULL,
      state TEXT NOT NULL, reserved_intent_id TEXT
    );
  `);
  const now = Date.now();
  db.prepare(`INSERT INTO automation_jobs VALUES
    ('job_1','chiliz',?1,?2,1,?3,NULL,'{}',?4,?5,datetime('now','-10 minutes'))`)
    .run(jobType, state, state === "queued" ? "quote_unavailable" : `leased:${worker}`,
      state === "leased" ? now - 9 * 60_000 : null, now - 9 * 60_000);
  db.prepare(`INSERT INTO chiliz_intent_policy VALUES (?1,'job_1','armed',NULL)`)
    .run(jobType === "chiliz_reward_purchase" ? "purchase_canary" : "claim_canary");
  return db;
}

function requeue(db: DatabaseSync, now = Date.now(), requestedPurchase = 1,
  requestedClaim = 0, owner = worker) {
  return db.prepare(REQUEUE_UNPREPARED_CHILIZ_FIRST_LEASE_SQL)
    .run(now, owner, requestedPurchase, requestedClaim).changes;
}

function leaseable(db: DatabaseSync) {
  return db.prepare(`SELECT id FROM automation_jobs
    WHERE state = 'queued' AND ${CHILIZ_FIRST_LEASE_ELIGIBLE_SQL}`).get();
}

test("an aged queued first-lease failure is reissued as attempt one", () => {
  const db = fixture();
  try {
    assert.equal(leaseable(db), undefined);
    assert.equal(requeue(db), 1);
    assert.deepEqual({ ...db.prepare(`SELECT state,attempt,error_code,leased_until
      FROM automation_jobs WHERE id='job_1'`).get() }, {
      state: "queued", attempt: 0, error_code: null, leased_until: null,
    });
    assert.equal(leaseable(db)?.id, "job_1");
    assert.equal(db.prepare(`UPDATE automation_jobs SET state='leased',attempt=attempt+1
      WHERE id='job_1' AND ${CHILIZ_FIRST_LEASE_ELIGIBLE_SQL}`).run().changes, 1);
    assert.equal(db.prepare(`SELECT attempt FROM automation_jobs WHERE id='job_1'`).get()?.attempt, 1);
    assert.equal(requeue(db), 0);
  } finally { db.close(); }
});

test("an expired owned first lease and the claim canary recover only when requested", () => {
  const db = fixture("chiliz_claim_unwrap", "leased");
  try {
    assert.equal(requeue(db, Date.now(), 1, 0), 0);
    assert.equal(requeue(db, Date.now(), 0, 1, `chiliz:0x${"b".repeat(40)}`), 0);
    assert.equal(requeue(db, Date.now(), 0, 1), 1);
    assert.equal(leaseable(db)?.id, "job_1");
  } finally { db.close(); }
});

test("first-lease recovery holds every signed, broadcast, policy, and lease ambiguity", () => {
  const mutations = [
    `UPDATE automation_jobs SET attempt=2 WHERE id='job_1'`,
    `UPDATE automation_jobs SET state='broadcasting' WHERE id='job_1'`,
    `UPDATE automation_jobs SET state='reconciliation_required' WHERE id='job_1'`,
    `UPDATE automation_jobs SET tx_hash='0xabc' WHERE id='job_1'`,
    `UPDATE automation_jobs SET payload_json='{"reconciliationReceipt":null}' WHERE id='job_1'`,
    `UPDATE automation_jobs SET updated_at=CURRENT_TIMESTAMP WHERE id='job_1'`,
    `UPDATE automation_jobs SET available_at=9223372036854775807 WHERE id='job_1'`,
    `UPDATE chiliz_intent_policy SET state='paused'`,
    `UPDATE chiliz_intent_policy SET state='reserved',reserved_intent_id='intent_1'`,
    `UPDATE chiliz_intent_policy SET key='claim_canary'`,
    `DELETE FROM chiliz_intent_policy`,
    `INSERT INTO chiliz_signed_intents VALUES ('job_1')`,
  ];
  for (const mutation of mutations) {
    const db = fixture();
    try {
      db.exec(mutation);
      assert.equal(requeue(db), 0, mutation);
      assert.equal(leaseable(db), undefined, mutation);
    } finally { db.close(); }
  }
});

test("a recent or still-active lease cannot reset", () => {
  const db = fixture("chiliz_reward_purchase", "leased");
  try {
    db.exec(`UPDATE automation_jobs SET leased_until=9223372036854775807`);
    assert.equal(requeue(db), 0);
    db.exec(`UPDATE automation_jobs SET leased_until=0,updated_at=CURRENT_TIMESTAMP`);
    assert.equal(requeue(db), 0);
  } finally { db.close(); }
});

test("evidence appearing after the reset still bars a second lease", () => {
  for (const mutation of [
    `INSERT INTO chiliz_signed_intents VALUES ('job_1')`,
    `UPDATE automation_jobs SET tx_hash='0xabc' WHERE id='job_1'`,
    `UPDATE automation_jobs SET payload_json='{"reconciliationReceipt":{}}' WHERE id='job_1'`,
  ]) {
    const db = fixture();
    try {
      assert.equal(requeue(db), 1);
      db.exec(mutation);
      assert.equal(leaseable(db), undefined, mutation);
      assert.equal(db.prepare(`UPDATE automation_jobs SET state='leased',attempt=attempt+1
        WHERE id='job_1' AND ${CHILIZ_FIRST_LEASE_ELIGIBLE_SQL}`).run().changes, 0,
      mutation);
    } finally { db.close(); }
  }
});
