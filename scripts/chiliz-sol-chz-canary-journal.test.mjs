import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const sql = readFileSync(new URL("../drizzle/0030_tan_metal_master.sql", import.meta.url), "utf8");
function database() {
  const db = new DatabaseSync(":memory:");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim())) {
    if (statement) db.exec(statement);
  }
  return db;
}
function insert(db, operation, maxSpend) {
  const signedSha = operation === "ata_setup" ? "a".repeat(64) : "b".repeat(64);
  const sig = operation === "ata_setup" ? "1".repeat(64) : "2".repeat(64);
  db.prepare(`INSERT INTO chiliz_sol_chz_canary_journal (
    id, operation, source_wallet, output_ata, input_lamports,
    maximum_spend_lamports, minimum_output_atomic, provider_request_id,
    last_valid_block_height, unsigned_transaction_base64,
    signed_transaction_base64, signed_plan_json, signed_transaction_sha256,
    transaction_message_hash, source_signature
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `sportpad-chz-canary:${operation}`, operation, "reward", "ata",
    operation === "ata_setup" ? 0 : 1_000_000, maxSpend,
    operation === "ata_setup" ? "0" : "500000000",
    operation === "ata_setup" ? null : "req-1234", 123456,
    "A".repeat(100), "A".repeat(100),
    JSON.stringify({ sourceSignature: sig, signedTransactionSha256: signedSha }),
    signedSha, signedSha, sig,
  );
  return `sportpad-chz-canary:${operation}`;
}

test("0030 canary migration accepts one ATA and one 1m-lamport swap under aggregate cap", () => {
  const db = database();
  insert(db, "ata_setup", 2_100_000);
  insert(db, "sol_chz_swap", 1_500_000);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chiliz_sol_chz_canary_journal").get().count, 2);
  assert.throws(() => insert(db, "sol_chz_swap", 1_500_000));
  assert.throws(() => db.exec("DELETE FROM chiliz_sol_chz_canary_journal"),
    /chiliz_canary_delete_rejected/);
});

test("0030 canary rejects aggregate authorized spend above 0.005 SOL", () => {
  const db = database();
  insert(db, "ata_setup", 4_000_000);
  assert.throws(() => insert(db, "sol_chz_swap", 1_500_000),
    /chiliz_canary_insert_rejected/);
});

test("0030 canary permits one-way claim and finalization, never mutable replay", () => {
  const db = database();
  const rowId = insert(db, "sol_chz_swap", 1_500_000);
  assert.throws(() => db.prepare("UPDATE chiliz_sol_chz_canary_journal SET input_lamports=2000000 WHERE id=?")
    .run(rowId), /chiliz_canary_transition_rejected/);
  db.prepare(`UPDATE chiliz_sol_chz_canary_journal SET state='broadcast_unknown',
    broadcast_attempted_at_ms=1234 WHERE id=?`).run(rowId);
  assert.throws(() => db.prepare(`UPDATE chiliz_sol_chz_canary_journal
    SET state='prepared' WHERE id=?`).run(rowId), /chiliz_canary_transition_rejected/);
  const evidence = { signature: "2".repeat(64), slot: 444,
    operation: "sol_chz_swap", actualSpendLamports: 1_010_000,
    actualOutputAtomic: "600000000" };
  db.prepare(`UPDATE chiliz_sol_chz_canary_journal
    SET state='finalized_success', finalized_slot=?, actual_spend_lamports=?,
      actual_output_atomic=?, receipt_evidence_json=? WHERE id=?`).run(
    444, 1_010_000, "600000000", JSON.stringify(evidence), rowId);
  assert.throws(() => db.prepare(`UPDATE chiliz_sol_chz_canary_journal
    SET state='broadcast_unknown' WHERE id=?`).run(rowId),
  /chiliz_canary_transition_rejected/);
});

test("0030 rejects overflowing atomic receipt and duplicate JSON evidence keys", () => {
  const db = database();
  const rowId = insert(db, "sol_chz_swap", 1_500_000);
  db.prepare(`UPDATE chiliz_sol_chz_canary_journal SET state='broadcast_unknown',
    broadcast_attempted_at_ms=1234 WHERE id=?`).run(rowId);
  const huge = "9".repeat(30);
  const evidence = JSON.stringify({ signature: "2".repeat(64), slot: 444,
    operation: "sol_chz_swap", actualSpendLamports: 1_010_000,
    actualOutputAtomic: huge });
  assert.throws(() => db.prepare(`UPDATE chiliz_sol_chz_canary_journal
    SET state='finalized_success', finalized_slot=444,
    actual_spend_lamports=1010000, actual_output_atomic=?, receipt_evidence_json=?
    WHERE id=?`).run(huge, evidence, rowId), /chiliz_canary_transition_rejected/);
  const duplicate = `{"signature":"${"2".repeat(64)}",` +
    `"signature":"${"2".repeat(64)}","slot":444,"operation":"sol_chz_swap",` +
    `"actualSpendLamports":1010000,"actualOutputAtomic":"600000000"}`;
  assert.throws(() => db.prepare(`UPDATE chiliz_sol_chz_canary_journal
    SET state='finalized_success', finalized_slot=444,
    actual_spend_lamports=1010000, actual_output_atomic='600000000', receipt_evidence_json=?
    WHERE id=?`).run(duplicate, rowId), /chiliz_canary_transition_rejected/);
});
