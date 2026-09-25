import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { FINALIZE_AFC_BUY_CANARY_SQL, INSERT_AFC_BUY_CANARY_SQL, MARK_AFC_BUY_CANARY_BROADCAST_SQL,
  SELECT_AFC_BUY_CANARY_SQL } from "./chiliz-afc-buy-canary-journal.ts";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../drizzle/0032_afc_v2_buy_canary.sql",
    import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  return db;
}

const treasury = `0x${"a".repeat(40)}`;
const token = "0x76088f3ed5dc655de9295d93868ec1eec654a615";
const raw = `0x${"a".repeat(200)}`;
const hash = `0x${"b".repeat(64)}`;
const bindings = [treasury, token, "10000000000000000", "1000000000000",
  1, 1_800_000_120, "1000000000000000000", hash, raw, "{}"] as const;

test("0032 canary journal is empty by default, one-shot, immutable, and non-replayable", () => {
  const db = fixture();
  assert.equal(db.prepare(SELECT_AFC_BUY_CANARY_SQL).get(), undefined);
  db.prepare(INSERT_AFC_BUY_CANARY_SQL).run(...bindings);
  assert.equal(db.prepare(SELECT_AFC_BUY_CANARY_SQL).get()?.state, "prepared");
  assert.throws(() => db.prepare(INSERT_AFC_BUY_CANARY_SQL).run(...bindings));
  assert.equal(db.prepare(MARK_AFC_BUY_CANARY_BROADCAST_SQL)
    .run(hash, 1_800_000_000_000).changes, 1);
  assert.equal(db.prepare(MARK_AFC_BUY_CANARY_BROADCAST_SQL)
    .run(hash, 1_800_000_000_001).changes, 0);
  assert.throws(() => db.exec("UPDATE chiliz_afc_v2_buy_canary SET state='prepared'"),
    /one_way|CHECK/);
  assert.throws(() => db.exec("UPDATE chiliz_afc_v2_buy_canary SET amount_in_wei='1'"),
    /identity_immutable|one_way/);
  assert.throws(() => db.exec("DELETE FROM chiliz_afc_v2_buy_canary"),
    /no_delete/);
  db.close();
});

test("0032 finality is a one-way receipt-bound transition, not a dust credit", () => {
  const db = fixture();
  db.prepare(INSERT_AFC_BUY_CANARY_SQL).run(...bindings);
  db.prepare(MARK_AFC_BUY_CANARY_BROADCAST_SQL).run(hash, 1_800_000_000_000);
  const blockHash = `0x${"c".repeat(64)}`;
  const evidence = (outputAmountAtomic: string) => JSON.stringify({
    txHash: hash, receiptStatus: "success", receiptBlockHash: blockHash,
    receiptBlockNumber: 100, finalizedBlockNumber: 103, outputAmountAtomic,
  });
  assert.equal(db.prepare(FINALIZE_AFC_BUY_CANARY_SQL).run(hash,
    "finalized_success", "success", blockHash, 100, 103, "1", evidence("1")).changes, 0);
  assert.equal(db.prepare(FINALIZE_AFC_BUY_CANARY_SQL).run(hash,
    "finalized_success", "success", blockHash, 100, 103,
    "1000000000000", evidence("1000000000000")).changes, 1);
  assert.equal(db.prepare(SELECT_AFC_BUY_CANARY_SQL).get()?.state, "finalized_success");
  assert.equal(db.prepare(FINALIZE_AFC_BUY_CANARY_SQL).run(hash,
    "finalized_success", "success", blockHash, 100, 103,
    "1000000000000", evidence("1000000000000")).changes, 0);
  assert.throws(() => db.exec("UPDATE chiliz_afc_v2_buy_canary SET output_amount_atomic='9999999999999'"),
    /one_way/);
  db.close();
});

test("0032 DB constraints reject wrong token, amount, gas, and raw bytes", () => {
  for (const [index, value] of [
    [1, `0x${"b".repeat(40)}`], [2, "20000000000000000"],
    [7, "1000000000000000001"], [8, "0x1234"],
  ] as const) {
    const db = fixture();
    const bad = [...bindings];
    bad[index] = value as never;
    assert.throws(() => db.prepare(INSERT_AFC_BUY_CANARY_SQL).run(...bad));
    db.close();
  }
});
