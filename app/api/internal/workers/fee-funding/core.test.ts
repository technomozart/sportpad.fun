import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { feeEventId } from "../../../../../lib/protocol/accounting.ts";
import { reserveChilizFeeShare } from
  "../../../../../lib/server/chiliz-fee-reservations.ts";
import { inspectFeeFunding } from "./core.ts";

const signature = "1".repeat(64);
const eventId = feeEventId(signature, 0);
const treasury = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const input = { feeEventId: eventId, launchId: "launch-chiliz",
  rewardTreasury: treasury, sportpadMint: "SPORTPAD_MINT" };

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT,
      reward_bps INTEGER, buyback_bps INTEGER, status TEXT,
      mainnet_verified_at TEXT, mainnet_mint TEXT,
      mainnet_reward_treasury TEXT, mainnet_fee_slot INTEGER);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT,
      source_signature TEXT, instruction_index INTEGER, source_slot INTEGER,
      gross_amount_atomic TEXT, state TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      reward_amount_atomic TEXT, buyback_amount_atomic TEXT,
      reward_spent_atomic TEXT, reward_swap_signature TEXT, state TEXT);
    CREATE TABLE protocol_events (id TEXT PRIMARY KEY, idempotency_key TEXT,
      category TEXT, entity_type TEXT, entity_id TEXT, event_type TEXT,
      state TEXT, signature TEXT, slot INTEGER, amount_atomic TEXT, mint TEXT);
    CREATE TABLE reward_swap_batch_sources (settlement_id TEXT);
    CREATE TABLE settlement_steps (settlement_id TEXT, stage TEXT, state TEXT);
    CREATE TABLE transaction_intents (settlement_id TEXT, action TEXT);
    CREATE TABLE automation_jobs (entity_type TEXT, entity_id TEXT, job_type TEXT);
    INSERT INTO launch_drafts VALUES
      ('launch-chiliz','chiliz',8000,2000,'mainnet_published',
       '2026-09-25','COMMUNITY_MINT','${treasury}',99);
    INSERT INTO fee_events VALUES
      ('${eventId}','launch-chiliz','${signature}',0,100,'1250000','reconciled');
    INSERT INTO settlements VALUES
      ('settlement:${eventId}','${eventId}','1000000','250000','0',NULL,'reconciled');
    INSERT INTO protocol_events VALUES
      ('fee:${eventId}','fee:${eventId}','fees','launch','launch-chiliz',
       'pump_fee_distributed','verified','${signature}',100,'1250000','COMMUNITY_MINT');
  `);
  for (const path of ["../../../../../drizzle/0027_glossy_agent_zero.sql",
    "../../../../../drizzle/0028_confused_epoch.sql"]) {
    db.exec(readFileSync(new URL(path, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", ""));
  }
  return db;
}

function d1(database: DatabaseSync) {
  return { prepare(sql: string) {
    return { bind(...args: unknown[]) {
      const statement = database.prepare(sql);
      const bindings = args as (string | number | bigint | null | Uint8Array)[];
      return {
        async run() { return { meta: { changes: statement.run(...bindings).changes } }; },
        async first<T>() { return (statement.get(...bindings) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...bindings) as T[] }; },
      };
    } };
  } } as unknown as D1Database;
}

test("inspection proves exact fee event, verified indexer evidence and 80/20 split without writing", async () => {
  const db = fixture();
  const result = await inspectFeeFunding(d1(db), input);
  assert.equal(result.rewardAmountLamports, "1000000");
  assert.equal(result.buybackAmountLamports, "250000");
  assert.deepEqual(result.nextChunk, { sequence: 0, attempt: 0,
    offsetLamports: "0", inputLamports: "1000000" });
  assert.equal(result.reservation, null);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_fee_reservations")
    .get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_sol_chz_swap_journal")
    .get() as { n: number }).n, 0);
  db.close();
});

test("inspection refuses mismatched treasury, unverified evidence, and incorrect allocation", async () => {
  const mutations = [
    "UPDATE protocol_events SET state='observed'",
    "UPDATE protocol_events SET signature='wrong'",
    "UPDATE protocol_events SET amount_atomic='1250001'",
    "UPDATE fee_events SET state='observed'",
    "UPDATE launch_drafts SET mainnet_reward_treasury='different'",
  ];
  for (const mutation of mutations) {
    const db = fixture();
    db.exec(mutation);
    await assert.rejects(() => inspectFeeFunding(d1(db), input),
      /fee_funding_finalized_source_unverified/, mutation);
    db.close();
  }
  const db = fixture();
  db.exec("UPDATE settlements SET buyback_amount_atomic='249999'");
  await assert.rejects(() => inspectFeeFunding(d1(db), input),
    /fee_funding_split_or_minimum_invalid/);
  db.close();
});

test("inspection reads an existing atomic reservation and journal cursor without mutating it", async () => {
  const db = fixture();
  const reserved = await reserveChilizFeeShare(d1(db), {
    feeEventId: eventId, launchId: "launch-chiliz", rewardTreasury: treasury,
  });
  assert.equal(reserved.created, true);
  const result = await inspectFeeFunding(d1(db), input);
  assert.equal(result.reservation?.id, reserved.reservation.id);
  assert.equal(result.nextChunk?.inputLamports, "1000000");
  assert.equal(result.journal.length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_fee_reservations")
    .get() as { n: number }).n, 1);
  db.close();
});
