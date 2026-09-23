import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ASSERT_ONE_CHECKPOINT_SQL,
  ASSERT_ONE_EPOCH_SHIFT_SQL,
  ASSERT_POSITION_COUNT_SQL,
  ASSERT_STAGED_SNAPSHOT_SQL,
  COMPLETE_FINALIZED_HOLDER_SNAPSHOT_SQL,
  COMMIT_HOLDER_CHECKPOINT_SQL,
  COMMIT_STAGED_HOLDER_POSITIONS_SQL,
  RECORD_HOLDER_SNAPSHOT_SQL,
  RECORD_HOLDER_BASELINE_SHIFT_SQL,
  SHIFT_EPOCH_TO_FINALIZED_BASELINE_SQL,
  STAGE_HOLDER_POSITION_SQL,
} from "./holder-indexer-sql.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE reward_epochs (id TEXT PRIMARY KEY, launch_id TEXT NOT NULL,
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, state TEXT NOT NULL,
      updated_at TEXT);
    CREATE TABLE holder_epoch_positions (
      id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL, launch_id TEXT NOT NULL,
      wallet TEXT NOT NULL, token_seconds_atomic TEXT NOT NULL,
      ending_balance_atomic TEXT NOT NULL, last_observed_slot INTEGER,
      last_observed_at INTEGER, excluded INTEGER NOT NULL, updated_at TEXT,
      UNIQUE(epoch_id, wallet)
    );
    CREATE TABLE holder_snapshot_staging (
      generation_id TEXT NOT NULL, epoch_id TEXT NOT NULL, launch_id TEXT NOT NULL,
      wallet TEXT NOT NULL, token_seconds_atomic TEXT NOT NULL,
      ending_balance_atomic TEXT NOT NULL, observed_slot INTEGER NOT NULL,
      observed_at INTEGER NOT NULL, UNIQUE(generation_id, wallet)
    );
    CREATE TABLE holder_snapshot_checkpoints (
      epoch_id TEXT PRIMARY KEY, generation_id TEXT NOT NULL,
      first_finalized_at INTEGER,
      last_observed_slot INTEGER NOT NULL, last_observed_at INTEGER NOT NULL,
      position_count INTEGER NOT NULL, evidence_hash TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE protocol_events (
      id TEXT PRIMARY KEY, category TEXT, entity_type TEXT, entity_id TEXT,
      event_type TEXT, idempotency_key TEXT UNIQUE, state TEXT, slot INTEGER,
      amount_atomic TEXT, mint TEXT, evidence_hash TEXT
    );
    INSERT INTO launch_drafts (id, status) VALUES ('launch', 'mainnet_published');
    INSERT INTO reward_epochs (id, launch_id, starts_at, ends_at, state)
      VALUES ('epoch', 'launch', '1970-01-01T00:01:40.000Z', '1970-01-01T00:03:20.000Z', 'accruing');
  `);
  return db;
}

function stage(db: DatabaseSync, generation: string, wallet: string, weight: string, slot: number, time: number) {
  return db.prepare(STAGE_HOLDER_POSITION_SQL)
    .run(generation, "epoch", "launch", wallet, weight, "10", slot, time);
}

function hasCompleteCoverage(db: DatabaseSync) {
  return Boolean(db.prepare(`SELECT e.id FROM reward_epochs e
    JOIN launch_drafts l ON l.id = e.launch_id
    WHERE l.status = 'mainnet_published' AND ${COMPLETE_FINALIZED_HOLDER_SNAPSHOT_SQL}`)
    .get());
}

// This models one D1.batch: every statement succeeds together or an error
// rolls back the checkpoint, canonical positions, and evidence event.
function commit(db: DatabaseSync, generation: string, expectedCount: number, slot: number, time: number,
  expectedBase: string | null = null, eventId = generation,
  shift?: { startsAt: string; endsAt: string; observedAt: number },
  expectedWindow?: { startsAt: string; endsAt: string }) {
  db.exec("BEGIN");
  try {
    if (shift) {
      db.prepare(SHIFT_EPOCH_TO_FINALIZED_BASELINE_SQL).run(
        "epoch", shift.startsAt, shift.endsAt,
        "1970-01-01T00:01:40.000Z", "1970-01-01T00:03:20.000Z", shift.observedAt,
      );
      db.prepare(ASSERT_ONE_EPOCH_SHIFT_SQL).get();
      db.prepare(RECORD_HOLDER_BASELINE_SHIFT_SQL).run(
        "baseline:epoch", "epoch", slot, String(shift.observedAt - 100), "mint", "hash",
      );
      db.prepare(ASSERT_ONE_CHECKPOINT_SQL).get();
    }
    db.prepare(ASSERT_STAGED_SNAPSHOT_SQL).get(generation, "epoch", expectedCount);
    db.prepare(COMMIT_HOLDER_CHECKPOINT_SQL).run("epoch", generation, slot, time, expectedCount, "hash", expectedBase,
      expectedWindow?.startsAt ?? shift?.startsAt ?? "1970-01-01T00:01:40.000Z",
      expectedWindow?.endsAt ?? shift?.endsAt ?? "1970-01-01T00:03:20.000Z");
    db.prepare(ASSERT_ONE_CHECKPOINT_SQL).get();
    db.prepare(COMMIT_STAGED_HOLDER_POSITIONS_SQL).run(generation, "epoch");
    db.prepare(ASSERT_POSITION_COUNT_SQL).get(expectedCount);
    db.prepare(RECORD_HOLDER_SNAPSHOT_SQL).run(eventId, "epoch", slot, "2", "mint", "hash", generation);
    db.prepare(ASSERT_ONE_CHECKPOINT_SQL).get();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("partial multi-batch stage is invisible to epoch closure and cannot commit", () => {
  const db = fixture();
  db.exec(`
    INSERT INTO holder_epoch_positions VALUES
      ('old:a','epoch','launch','a','100','5',8,90,0,NULL),
      ('old:b','epoch','launch','b','200','5',8,90,0,NULL);
  `);
  assert.equal(stage(db, "new", "a", "111", 10, 100).changes, 1);
  assert.deepEqual(
    db.prepare("SELECT wallet, token_seconds_atomic FROM holder_epoch_positions ORDER BY wallet").all().map((row) => ({ ...row })),
    [{ wallet: "a", token_seconds_atomic: "100" }, { wallet: "b", token_seconds_atomic: "200" }],
  );
  assert.throws(() => commit(db, "new", 2, 10, 100), /malformed JSON/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM holder_snapshot_checkpoints").get()?.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM protocol_events").get()?.n, 0);

  assert.equal(stage(db, "new", "b", "222", 10, 100).changes, 1);
  commit(db, "new", 2, 10, 100);
  assert.deepEqual(
    db.prepare("SELECT wallet, token_seconds_atomic FROM holder_epoch_positions ORDER BY wallet").all().map((row) => ({ ...row })),
    [{ wallet: "a", token_seconds_atomic: "111" }, { wallet: "b", token_seconds_atomic: "222" }],
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM protocol_events").get()?.n, 1);
  db.close();
});

test("epoch closure during staging fences the entire generation", () => {
  const db = fixture();
  assert.equal(stage(db, "late", "a", "111", 10, 100).changes, 1);
  db.exec("UPDATE reward_epochs SET state = 'allocating' WHERE id = 'epoch'");
  assert.equal(stage(db, "late", "b", "222", 10, 100).changes, 0);
  assert.throws(() => commit(db, "late", 1, 10, 100), /malformed JSON/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM holder_epoch_positions").get()?.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM protocol_events").get()?.n, 0);
  db.close();
});

test("older finalized slot cannot overwrite a newer committed snapshot", () => {
  const db = fixture();
  stage(db, "latest", "a", "111", 10, 100);
  commit(db, "latest", 1, 10, 100);
  stage(db, "stale", "a", "999", 9, 101);
  assert.throws(() => commit(db, "stale", 1, 9, 101, "latest"), /malformed JSON/);
  assert.equal(db.prepare("SELECT token_seconds_atomic FROM holder_epoch_positions WHERE wallet = 'a'").get()?.token_seconds_atomic, "111");
  assert.equal(db.prepare("SELECT generation_id FROM holder_snapshot_checkpoints WHERE epoch_id = 'epoch'").get()?.generation_id, "latest");
  db.close();
});

test("same finalized slot may accrue at a later observation time only", () => {
  const db = fixture();
  stage(db, "first", "a", "111", 10, 100);
  commit(db, "first", 1, 10, 100);
  stage(db, "next-second", "a", "222", 10, 101);
  commit(db, "next-second", 1, 10, 101, "first");
  stage(db, "same-second", "a", "999", 10, 101);
  assert.throws(() => commit(db, "same-second", 1, 10, 101, "next-second"), /malformed JSON/);
  assert.equal(db.prepare("SELECT token_seconds_atomic FROM holder_epoch_positions WHERE wallet = 'a'").get()?.token_seconds_atomic, "222");
  db.close();
});

test("event insertion error rolls back both checkpoint and position replacement", () => {
  const db = fixture();
  stage(db, "first", "a", "111", 10, 100);
  commit(db, "first", 1, 10, 100, null, "same-event");
  stage(db, "second", "a", "222", 11, 101);
  assert.throws(() => commit(db, "second", 1, 11, 101, "first", "same-event"), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT token_seconds_atomic FROM holder_epoch_positions WHERE wallet = 'a'").get()?.token_seconds_atomic, "111");
  assert.equal(db.prepare("SELECT generation_id FROM holder_snapshot_checkpoints WHERE epoch_id = 'epoch'").get()?.generation_id, "first");
  db.close();
});

test("stale base generation cannot overwrite newer accrued token-seconds even with later slot", () => {
  const db = fixture();
  stage(db, "base", "a", "100", 10, 100);
  commit(db, "base", 1, 10, 100);

  // Both indexers read the base generation. The delayed one has a later
  // observed slot, but its computed weight omits the first indexer's accrual.
  stage(db, "first", "a", "200", 11, 101);
  stage(db, "delayed", "a", "150", 12, 102);
  commit(db, "first", 1, 11, 101, "base");
  assert.throws(() => commit(db, "delayed", 1, 12, 102, "base"), /malformed JSON/);
  assert.equal(db.prepare("SELECT token_seconds_atomic FROM holder_epoch_positions WHERE wallet = 'a'").get()?.token_seconds_atomic, "200");
  assert.equal(db.prepare("SELECT generation_id FROM holder_snapshot_checkpoints WHERE epoch_id = 'epoch'").get()?.generation_id, "first");
  db.close();
});

test("allocation requires a finalized snapshot before start and after end", () => {
  const db = fixture();
  try {
    stage(db, "opening", "holder", "0", 10, 95);
    commit(db, "opening", 1, 10, 95);
    assert.equal(hasCompleteCoverage(db), false);
    stage(db, "near-end", "holder", "100", 11, 199);
    commit(db, "near-end", 1, 11, 199, "opening");
    assert.equal(hasCompleteCoverage(db), false);
    stage(db, "closing", "holder", "200", 12, 205);
    commit(db, "closing", 1, 12, 205, "near-end");
    assert.equal(hasCompleteCoverage(db), true);
    db.exec("UPDATE launch_drafts SET status = 'mainnet_suspended' WHERE id = 'launch'");
    assert.equal(hasCompleteCoverage(db), false);
    assert.equal(stage(db, "suspended", "holder", "300", 13, 210).changes, 0);
  } finally { db.close(); }
});

test("late opening, legacy, and incomplete canonical checkpoints fail closed", () => {
  const db = fixture();
  try {
    stage(db, "late-opening", "holder", "0", 10, 101);
    commit(db, "late-opening", 1, 10, 101);
    stage(db, "closing", "holder", "200", 11, 205);
    commit(db, "closing", 1, 11, 205, "late-opening");
    assert.equal(hasCompleteCoverage(db), false);
    db.exec("UPDATE holder_snapshot_checkpoints SET first_finalized_at = 95");
    assert.equal(hasCompleteCoverage(db), true);
    db.exec("UPDATE holder_epoch_positions SET last_observed_slot = 10");
    assert.equal(hasCompleteCoverage(db), false);
    db.exec("UPDATE holder_epoch_positions SET last_observed_slot = 11");
    db.exec("UPDATE holder_snapshot_checkpoints SET first_finalized_at = NULL");
    assert.equal(hasCompleteCoverage(db), false);
  } finally { db.close(); }
});

test("late first finalized snapshot atomically shifts the full epoch window", () => {
  const db = fixture();
  try {
    stage(db, "late-opening", "holder", "0", 10, 245);
    commit(db, "late-opening", 1, 10, 245, null, "late-opening", {
      startsAt: "1970-01-01T00:04:05.000Z",
      endsAt: "1970-01-01T00:05:45.000Z",
      observedAt: 245,
    });
    const epoch = db.prepare("SELECT starts_at, ends_at FROM reward_epochs WHERE id = 'epoch'").get();
    assert.equal(epoch?.starts_at, "1970-01-01T00:04:05.000Z");
    assert.equal(epoch?.ends_at, "1970-01-01T00:05:45.000Z");
    assert.equal(hasCompleteCoverage(db), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM protocol_events WHERE event_type = 'holder_epoch_baseline_shifted'").get()?.n, 1);

    stage(db, "too-early", "holder", "200", 11, 344);
    assert.throws(() => commit(db, "too-early", 1, 11, 344, "late-opening"), /malformed JSON/);
    const shiftedWindow = {
      startsAt: "1970-01-01T00:04:05.000Z",
      endsAt: "1970-01-01T00:05:45.000Z",
    };
    commit(db, "too-early", 1, 11, 344, "late-opening", "too-early", undefined, shiftedWindow);
    assert.equal(hasCompleteCoverage(db), false);
    stage(db, "closing", "holder", "300", 12, 346);
    commit(db, "closing", 1, 12, 346, "too-early", "closing", undefined, shiftedWindow);
    assert.equal(hasCompleteCoverage(db), true);
  } finally { db.close(); }
});

test("failed first-snapshot commit rolls back the baseline shift and audit event", () => {
  const db = fixture();
  try {
    stage(db, "partial", "holder", "0", 10, 245);
    assert.throws(() => commit(db, "partial", 2, 10, 245, null, "partial", {
      startsAt: "1970-01-01T00:04:05.000Z",
      endsAt: "1970-01-01T00:05:45.000Z",
      observedAt: 245,
    }), /malformed JSON/);
    assert.equal(db.prepare("SELECT starts_at FROM reward_epochs WHERE id = 'epoch'").get()?.starts_at,
      "1970-01-01T00:01:40.000Z");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM protocol_events").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM holder_snapshot_checkpoints").get()?.n, 0);
  } finally { db.close(); }
});
