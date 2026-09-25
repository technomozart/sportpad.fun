import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const wallet = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const destination = `0x${"a".repeat(40)}`;
const mint = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const amount = "100000000";
const minimum = "990000000000000000";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE chiliz_fee_reservations (id TEXT PRIMARY KEY,
      fee_event_id TEXT, launch_id TEXT, reward_treasury TEXT);
    CREATE TABLE chiliz_sol_chz_swap_journal (id TEXT PRIMARY KEY,
      reservation_id TEXT, state TEXT, output_amount_atomic TEXT,
      output_mint TEXT, source_wallet TEXT);
    CREATE TABLE chiliz_bridge_journal (id TEXT PRIMARY KEY, quote_id TEXT,
      source_signature TEXT, signed_transaction_sha256 TEXT,
      bridge_message_id TEXT, destination_tx_hash TEXT);
  `);
  for (const name of ["0029_living_calypso", "0033_repeat_bridge_attempts"]) {
    db.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", ""));
  }
  return db;
}

function fundedBridge(db: DatabaseSync, id: string) {
  db.prepare("INSERT INTO launch_drafts VALUES (?1)").run(`launch-${id}`);
  db.prepare("INSERT INTO fee_events VALUES (?1,?2)")
    .run(`fee-${id}`, `launch-${id}`);
  db.prepare("INSERT INTO chiliz_fee_reservations VALUES (?1,?2,?3,?4)")
    .run(`reservation-${id}`, `fee-${id}`, `launch-${id}`, wallet);
  db.prepare("INSERT INTO chiliz_sol_chz_swap_journal VALUES (?1,?2,'finalized_success',?3,?4,?5)")
    .run(`swap-${id}`, `reservation-${id}`, amount, mint, wallet);
  db.prepare(`INSERT INTO chiliz_bridge_transfers
    (id,source_wallet,destination_treasury,source_mint,destination_chain_id,
     source_amount_atomic,minimum_destination_wei)
    VALUES (?1,?2,?3,?4,88888,?5,?6)`)
    .run(id, wallet, destination, mint, amount, minimum);
  db.prepare(`INSERT INTO chiliz_bridge_allocations
    (id,bridge_id,swap_intent_id,reservation_id,fee_event_id,launch_id,
     swap_output_offset_atomic,amount_atomic)
    VALUES (?1,?2,?3,?4,?5,?6,'0',?7)`)
    .run(`allocation-${id}`, id, `swap-${id}`, `reservation-${id}`,
      `fee-${id}`, `launch-${id}`, amount);
}

function attempt(db: DatabaseSync, bridgeId: string, sequence: number,
  suffix: string, preparedAtMs: number, quoteExpiresAtMs: number) {
  const quoteId = `oft:${suffix.repeat(64)}`;
  const signature = `${suffix === "1" ? "5" : suffix === "2" ? "6" : "7"}`.repeat(64);
  const signedSha = suffix.repeat(64);
  const signedBytes = suffix.toUpperCase().repeat(100);
  const plan = JSON.stringify({
    sourceWallet: wallet, destinationTreasury: destination, sourceMint: mint,
    sourceAmountAtomic: amount, minimumDestinationWei: minimum,
    onchainQuoteDigestSha256: suffix.repeat(64), quoteExpiresAtMs,
    expectedMessageSha256: "e".repeat(64), lastValidBlockHeight: 12345,
    executionReady: false,
  });
  db.prepare(`INSERT INTO chiliz_bridge_attempts
    (bridge_id,attempt_sequence,quote_id,quote_expires_at_ms,
     signed_transaction_base64,signed_transaction_sha256,source_signature,
     plan_json,plan_sha256,prepared_at_ms)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
    .run(bridgeId, sequence, quoteId, quoteExpiresAtMs, signedBytes,
      signedSha, signature, plan, "f".repeat(64), preparedAtMs);
  return { quoteId, signature, signedSha, signedBytes, quoteExpiresAtMs };
}

function clock(db: DatabaseSync): number {
  return Number((db.prepare("SELECT unixepoch('now') * 1000 AS now_ms").get() as
    { now_ms: number }).now_ms);
}

test("only an exactly funded, durable signed attempt can seal and claim", () => {
  const db = fixture();
  fundedBridge(db, "bridge-a");
  const now = clock(db);
  assert.throws(() => db.prepare(`UPDATE chiliz_bridge_transfers SET state='prepared',
    quote_id='oft:missing',quote_expires_at_ms=?2,
    signed_transaction_base64=?3,signed_transaction_sha256=?4,
    source_signature=?5 WHERE id=?1`).run("bridge-a", now + 120_000,
      "X".repeat(100), "a".repeat(64), "5".repeat(64)));
  const first = attempt(db, "bridge-a", 0, "1", now, now + 120_000);
  assert.throws(() => attempt(db, "bridge-a", 1, "2", now, now + 120_000));
  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE chiliz_bridge_transfers SET state='prepared',quote_id=?2,
      quote_expires_at_ms=?3,signed_transaction_base64=?4,
      signed_transaction_sha256=?5,source_signature=?6 WHERE id=?1`)
      .run("bridge-a", first.quoteId, first.quoteExpiresAtMs,
        first.signedBytes, first.signedSha, first.signature);
    db.prepare(`UPDATE chiliz_bridge_transfers SET state='broadcast_unknown',
      broadcast_attempted_at_ms=?2 WHERE id=?1`).run("bridge-a", now);
    db.prepare(`UPDATE chiliz_bridge_attempts SET state='claimed',claimed_at_ms=?3
      WHERE bridge_id=?1 AND attempt_sequence=?2`).run("bridge-a", 0, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const row = db.prepare("SELECT state,broadcast_attempted_at_ms FROM chiliz_bridge_transfers WHERE id='bridge-a'")
    .get() as { state: string; broadcast_attempted_at_ms: number };
  assert.equal(row.state, "broadcast_unknown");
  assert.equal(row.broadcast_attempted_at_ms, now);
  assert.throws(() => db.prepare(`UPDATE chiliz_bridge_attempts
    SET state='abandoned_unbroadcast',abandoned_at_ms=?1
    WHERE bridge_id='bridge-a'`).run(now + 120_001));
  assert.throws(() => attempt(db, "bridge-a", 1, "2", now, now + 120_000));
});

test("expired unbroadcast attempt can be replaced but its identity cannot be reused", async () => {
  const db = fixture();
  fundedBridge(db, "bridge-a");
  fundedBridge(db, "bridge-b");
  const now = clock(db);
  const first = attempt(db, "bridge-a", 0, "1", now - 29_900, now + 200);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const later = clock(db);
  assert.ok(later > first.quoteExpiresAtMs);
  db.prepare(`UPDATE chiliz_bridge_attempts SET state='abandoned_unbroadcast',
    abandoned_at_ms=?3 WHERE bridge_id=?1 AND attempt_sequence=?2`)
    .run("bridge-a", 0, later);
  const next = attempt(db, "bridge-a", 1, "2", later, later + 120_000);
  assert.equal(next.quoteId, `oft:${"2".repeat(64)}`);
  assert.equal((db.prepare("SELECT state FROM chiliz_bridge_transfers WHERE id='bridge-a'")
    .get() as { state: string }).state, "collecting");
  assert.throws(() => attempt(db, "bridge-b", 0, "1", later, later + 120_000));
  assert.throws(() => db.prepare(`UPDATE chiliz_bridge_attempts SET
    signed_transaction_sha256=?3 WHERE bridge_id=?1 AND attempt_sequence=?2`)
    .run("bridge-a", 0, "3".repeat(64)));
});

test("a failed atomic claim rolls back sealing and leaves fee allocation collectible", () => {
  const db = fixture();
  fundedBridge(db, "bridge-a");
  const now = clock(db);
  const first = attempt(db, "bridge-a", 0, "1", now, now + 120_000);
  db.exec("BEGIN");
  assert.throws(() => {
    db.prepare(`UPDATE chiliz_bridge_transfers SET state='prepared',quote_id=?2,
      quote_expires_at_ms=?3,signed_transaction_base64=?4,
      signed_transaction_sha256=?5,source_signature=?6 WHERE id=?1`)
      .run("bridge-a", first.quoteId, first.quoteExpiresAtMs,
        first.signedBytes, first.signedSha, first.signature);
    db.prepare(`UPDATE chiliz_bridge_transfers SET state='broadcast_unknown',
      broadcast_attempted_at_ms=?2 WHERE id=?1`).run("bridge-a", now);
    // The adapter's final zero-row assertion deliberately violates the
    // attempt table's non-null bridge ID if any claim step did not occur.
    db.prepare(`INSERT INTO chiliz_bridge_attempts (bridge_id)
      SELECT NULL WHERE NOT EXISTS (
        SELECT 1 FROM chiliz_bridge_attempts WHERE bridge_id='bridge-a'
          AND attempt_sequence=0 AND state='claimed')`).run();
  });
  db.exec("ROLLBACK");
  assert.deepEqual({ ...db.prepare(`SELECT state,source_signature FROM chiliz_bridge_transfers
    WHERE id='bridge-a'`).get() }, { state: "collecting", source_signature: null });
  assert.equal((db.prepare(`SELECT state FROM chiliz_bridge_attempts
    WHERE bridge_id='bridge-a'`).get() as { state: string }).state, "prepared");
});
