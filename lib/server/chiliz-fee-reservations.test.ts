import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { feeEventId } from "../protocol/accounting.ts";
import { reserveChilizFeeShare } from "./chiliz-fee-reservations.ts";

const signature = "1".repeat(64);
const eventId = feeEventId(signature, 0);
const treasury = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const launchId = "launch-chiliz";

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
    CREATE TABLE reward_swap_batch_sources (settlement_id TEXT);
    CREATE TABLE settlement_steps (settlement_id TEXT, stage TEXT, state TEXT);
    CREATE TABLE transaction_intents (settlement_id TEXT, action TEXT);
    CREATE TABLE automation_jobs (entity_type TEXT, entity_id TEXT, job_type TEXT);
    INSERT INTO launch_drafts VALUES
      ('launch-chiliz', 'chiliz', 8000, 2000, 'mainnet_published',
        '2026-09-25', 'COMMUNITY_MINT', '${treasury}', 99);
    INSERT INTO fee_events VALUES
      ('${eventId}', 'launch-chiliz', '${signature}', 0, 100, '1250000', 'reconciled');
    INSERT INTO settlements VALUES
      ('settlement:${eventId}', '${eventId}', '1000000', '250000', '0', NULL, 'reconciled');
  `);
  const migration = readFileSync(new URL("../../drizzle/0027_glossy_agent_zero.sql", import.meta.url), "utf8");
  db.exec(migration.replaceAll("--> statement-breakpoint", ""));
  return db;
}

function d1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const statement = database.prepare(sql);
          const bindings = args as (string | number | bigint | null | Uint8Array)[];
          return {
            async run() { return { meta: { changes: statement.run(...bindings).changes } }; },
            async first<T>() { return (statement.get(...bindings) ?? null) as T | null; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const input = { feeEventId: eventId, launchId, rewardTreasury: treasury };

test("reserves the exact finalized 80% fee share once and returns the same row idempotently", async () => {
  const db = fixture();
  const first = await reserveChilizFeeShare(d1(db), input);
  assert.equal(first.created, true);
  assert.equal(first.reservation.rewardAmountLamports, "1000000");
  assert.equal(first.reservation.grossAmountLamports, "1250000");
  assert.equal(first.reservation.sourceSlot, 100);
  const again = await reserveChilizFeeShare(d1(db), input);
  assert.equal(again.created, false);
  assert.deepEqual(again.reservation, first.reservation);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_fee_reservations").get() as { n: number }).n, 1);
  await assert.rejects(() => reserveChilizFeeShare(d1(db), { ...input, rewardTreasury: "other-treasury" }),
    /ineligible_or_conflict/);
  db.close();
});

test("a completed 20% buyback does not prevent reserving the still-unused 80% share", async () => {
  for (const state of ["distributed", "buyback_burned"]) {
    const db = fixture();
    db.prepare("UPDATE settlements SET state=?").run(state);
    const result = await reserveChilizFeeShare(d1(db), input);
    assert.equal(result.created, true, state);
    assert.equal(result.reservation.rewardAmountLamports, "1000000");
    db.close();
  }
});

test("reservation fails closed for unfinalized, wrong-chain, already-used, or incorrect fee math", async () => {
  const mutations = [
    "UPDATE fee_events SET state='observed'",
    "UPDATE launch_drafts SET reward_chain='solana'",
    "UPDATE launch_drafts SET mainnet_verified_at=NULL",
    "UPDATE launch_drafts SET mainnet_fee_slot=100",
    "UPDATE settlements SET reward_spent_atomic='1'",
    "UPDATE settlements SET reward_swap_signature='old-swap'",
    "UPDATE settlements SET reward_amount_atomic='999999'",
    "UPDATE settlements SET buyback_amount_atomic='249999'",
    "INSERT INTO reward_swap_batch_sources VALUES ('settlement:" + eventId + "')",
    "INSERT INTO settlement_steps VALUES ('settlement:" + eventId + "','automatic_reward_chunk','planned')",
    "INSERT INTO transaction_intents VALUES ('settlement:" + eventId + "','reward_swap')",
  ];
  for (const mutation of mutations) {
    const db = fixture();
    db.exec(mutation);
    await assert.rejects(() => reserveChilizFeeShare(d1(db), input), /chiliz_fee_reservation_ineligible/,
      mutation);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_fee_reservations").get() as { n: number }).n, 0);
    db.close();
  }
});

test("a reservation bars later Solana reward paths and source rewrites at the database boundary", async () => {
  const db = fixture();
  await reserveChilizFeeShare(d1(db), input);
  const forbidden = [
    "INSERT INTO reward_swap_batch_sources VALUES ('settlement:" + eventId + "')",
    "INSERT INTO settlement_steps VALUES ('settlement:" + eventId + "','automatic_reward_chunk','planned')",
    "INSERT INTO transaction_intents VALUES ('settlement:" + eventId + "','reward_swap')",
    "INSERT INTO automation_jobs VALUES ('settlement','settlement:" + eventId + "','solana_reward_purchase')",
    "UPDATE settlements SET reward_spent_atomic='1000000'",
    "UPDATE settlements SET reward_swap_signature='conflicting'",
    "UPDATE settlements SET reward_amount_atomic='1000001'",
    "UPDATE fee_events SET gross_amount_atomic='1250001'",
    "UPDATE launch_drafts SET mainnet_reward_treasury='different'",
    "UPDATE chiliz_fee_reservations SET reward_amount_lamports='999999'",
    "DELETE FROM chiliz_fee_reservations",
  ];
  for (const statement of forbidden) assert.throws(() => db.exec(statement), /chiliz_fee_/,
    statement);
  db.close();
});

test("only exact recorded source amounts can be inserted, and one event cannot be reserved twice", async () => {
  const db = fixture();
  const base = `INSERT INTO chiliz_fee_reservations
    (id, fee_event_id, settlement_id, launch_id, reward_treasury,
      source_signature, source_slot, gross_amount_lamports, reward_amount_lamports)
    VALUES ('chiliz:fee:${eventId}', '${eventId}', 'settlement:${eventId}',
      '${launchId}', '${treasury}', '${signature}', 100, '1250000',`;
  assert.throws(() => db.exec(`${base} '999999')`), /chiliz_fee_reservation_ineligible/);
  await reserveChilizFeeShare(d1(db), input);
  assert.throws(() => db.exec(`${base} '1000000')`), /UNIQUE constraint failed/);
  db.close();
});

test("tiny fee shares stay unreserved until a Chiliz batching path exists", async () => {
  const db = fixture();
  db.exec(`UPDATE fee_events SET gross_amount_atomic='1001';
    UPDATE settlements SET reward_amount_atomic='800', buyback_amount_atomic='201'`);
  await assert.rejects(() => reserveChilizFeeShare(d1(db), input),
    /chiliz_fee_reservation_ineligible/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_fee_reservations").get() as { n: number }).n, 0);
  db.close();
});
