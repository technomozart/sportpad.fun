import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ASSERT_ONE_ROW_CHANGED_SQL, COMPLETE_BROADCAST_JOB_SQL, COMPLETE_BUYBACK_SETTLEMENT_SQL, COMPLETE_CLAIM_SQL,
  COMPLETE_CLAIM_VAULT_SQL, COMPLETE_PURCHASE_SETTLEMENT_SQL, COMPLETE_PURCHASE_VAULT_SQL,
  COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL, COMPLETE_SOLANA_PURCHASE_VAULT_SQL,
  COMPLETE_RECONCILED_JOB_SQL,
  DEFER_CHILIZ_EPOCH_SQL, ELIGIBLE_COMMUNITY_BUYBACK_SETTLEMENTS_SQL,
  failureDisposition, FENCE_CHILIZ_EPOCH_SQL,
  FINANCIAL_LEDGER_VERIFIED, HOLD_BROADCAST_RECEIPT_SQL,
  laneAllowsJob, ownsActiveLease, ownsBroadcast, pauseConditionSql,
  REQUEUE_UNPREPARED_REWARD_JOB_SQL,
  QUEUE_CLAIM_JOB_SQL, QUEUE_CLAIM_TRANSITION_SQL } from "./automation-safety.ts";

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

function assertOne(db: DatabaseSync) {
  db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
}

test("zero-row CAS raises an actual SQL error that rolls back earlier writes", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ledger (id TEXT PRIMARY KEY, amount TEXT NOT NULL); INSERT INTO ledger VALUES ('a', '1')");
  assert.throws(() => atomic(db, [
    () => { db.prepare("UPDATE ledger SET amount = '2' WHERE id = 'a'").run(); },
    () => assertOne(db),
    () => { db.prepare("UPDATE ledger SET amount = '3' WHERE id = 'missing'").run(); },
    () => assertOne(db),
  ]), /malformed JSON/);
  assert.equal(db.prepare("SELECT amount FROM ledger WHERE id = 'a'").get()?.amount, "1");
  db.close();
});

test("mature epoch fencing is exclusive and an empty epoch can be reopened", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE reward_epochs (
      id TEXT PRIMARY KEY, launch_id TEXT, state TEXT, funded_amount_atomic TEXT,
      starts_at TEXT, ends_at TEXT, updated_at TEXT
    );
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE holder_snapshot_checkpoints (
      epoch_id TEXT PRIMARY KEY, first_finalized_at INTEGER,
      last_observed_slot INTEGER NOT NULL, last_observed_at INTEGER NOT NULL,
      position_count INTEGER NOT NULL
    );
    CREATE TABLE holder_epoch_positions (
      epoch_id TEXT, last_observed_slot INTEGER, last_observed_at INTEGER
    );
    INSERT INTO launch_drafts VALUES ('launch', 'mainnet_published');
    INSERT INTO reward_epochs VALUES ('epoch', 'launch', 'accruing', '1000000000000000000',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hour'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL);
  `);
  assert.equal(db.prepare(FENCE_CHILIZ_EPOCH_SQL).run("epoch", "1000000000000000000").changes, 0);
  db.exec(`
    INSERT INTO holder_snapshot_checkpoints VALUES
      ('epoch', CAST(strftime('%s', 'now', '-3 hour') AS INTEGER),
        10, CAST(strftime('%s', 'now') AS INTEGER), 1);
    INSERT INTO holder_epoch_positions VALUES
      ('epoch', 10, CAST(strftime('%s', 'now', '-1 hour') AS INTEGER));
  `);
  db.exec("UPDATE launch_drafts SET status = 'mainnet_suspended' WHERE id = 'launch'");
  assert.equal(db.prepare(FENCE_CHILIZ_EPOCH_SQL).run("epoch", "1000000000000000000").changes, 0);
  db.exec("UPDATE launch_drafts SET status = 'mainnet_published' WHERE id = 'launch'");
  assert.equal(db.prepare(FENCE_CHILIZ_EPOCH_SQL).run("epoch", "1000000000000000000").changes, 1);
  assert.equal(db.prepare(FENCE_CHILIZ_EPOCH_SQL).run("epoch", "1000000000000000000").changes, 0);
  assert.equal(db.prepare("SELECT state FROM reward_epochs").get()?.state, "allocating");
  assert.equal(db.prepare(DEFER_CHILIZ_EPOCH_SQL).run("epoch", "0").changes, 0);
  assert.equal(db.prepare(DEFER_CHILIZ_EPOCH_SQL).run("epoch", "1000000000000000000").changes, 1);
  assert.equal(db.prepare("SELECT state FROM reward_epochs").get()?.state, "accruing");
  assert.equal(db.prepare(FENCE_CHILIZ_EPOCH_SQL).run("epoch", "1000000000000000000").changes, 0);
  db.close();
});

test("claim enqueue and retry are atomic and cannot overwrite an in-flight job", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE reward_claims (
      id TEXT PRIMARY KEY, state TEXT NOT NULL, solana_wallet TEXT NOT NULL,
      destination_chain TEXT, destination_address TEXT, claim_requested_at TEXT, updated_at TEXT
    );
    CREATE TABLE automation_jobs (
      id TEXT PRIMARY KEY, job_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, chain TEXT NOT NULL, payload_json TEXT NOT NULL,
      state TEXT NOT NULL, available_at INTEGER NOT NULL, attempt INTEGER DEFAULT 0,
      tx_hash TEXT, error_code TEXT, leased_until INTEGER, updated_at TEXT
    );
    CREATE UNIQUE INDEX job_entity_type ON automation_jobs(entity_id, job_type);
    INSERT INTO reward_claims (id, state, solana_wallet) VALUES ('claim-1', 'claimable', 'wallet-a');
  `);
  const queue = (jobId: string, wallet: string) => atomic(db, [
    () => { db.prepare(QUEUE_CLAIM_JOB_SQL).run(jobId, "chiliz_claim_unwrap", "claim-1", "chiliz", "{}", 1); },
    () => assertOne(db),
    () => { db.prepare(QUEUE_CLAIM_TRANSITION_SQL).run("claim-1", "chiliz", "0xdestination", jobId, wallet); },
    () => assertOne(db),
  ]);
  assert.throws(() => queue("unauthorized", "wallet-b"), /malformed JSON/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_jobs").get()?.count, 0);
  queue("job-1", "wallet-a");
  assert.equal(db.prepare("SELECT state FROM reward_claims WHERE id = 'claim-1'").get()?.state, "queued");
  assert.throws(() => queue("job-2", "wallet-a"), /malformed JSON/);
  assert.equal(db.prepare("SELECT id FROM automation_jobs").get()?.id, "job-1");
  db.exec("UPDATE reward_claims SET state = 'claimable'; UPDATE automation_jobs SET state = 'failed'");
  queue("job-3", "wallet-a");
  assert.equal(db.prepare("SELECT id FROM automation_jobs").get()?.id, "job-3");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_jobs").get()?.count, 1);
  db.close();
});

test("two purchase completions cannot lose a vault increment or partially commit", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, state TEXT, tx_hash TEXT, error_code TEXT, leased_until INTEGER, updated_at TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT, reward_swap_signature TEXT,
      buyback_swap_signature TEXT, burn_signature TEXT, state TEXT, updated_at TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT, reward_mint TEXT, reward_wrapped_contract TEXT);
    CREATE TABLE reward_vaults (
      id TEXT PRIMARY KEY, launch_id TEXT, reward_mint TEXT, chain TEXT, owner_address TEXT,
      state TEXT, inventory_atomic TEXT, updated_at TEXT,
      UNIQUE(launch_id, reward_mint)
    );
    INSERT INTO launch_drafts VALUES ('launch', 'chiliz', 'v2-token', NULL);
    INSERT INTO fee_events VALUES ('fee-a', 'launch'), ('fee-b', 'launch');
    INSERT INTO settlements VALUES ('settlement-a', 'fee-a', NULL, NULL, NULL, 'reconciled', NULL),
      ('settlement-b', 'fee-b', NULL, NULL, NULL, 'reconciled', NULL);
    INSERT INTO automation_jobs VALUES ('job-a', 'broadcasting', NULL, 'broadcasting:worker', NULL, NULL),
      ('job-b', 'broadcasting', NULL, 'broadcasting:worker', NULL, NULL);
    INSERT INTO reward_vaults VALUES ('vault', 'launch', 'v2-token', 'chiliz', '0xowner', 'funded', '10000000000000000000', NULL);
  `);
  const complete = (jobId: string, settlementId: string, tx: string, expected: string, next: string) => atomic(db, [
    () => { db.prepare(COMPLETE_BROADCAST_JOB_SQL).run(jobId, tx, "broadcasting:worker"); },
    () => assertOne(db),
    () => { db.prepare(COMPLETE_PURCHASE_SETTLEMENT_SQL).run(settlementId, tx, "launch", "v2-token"); },
    () => assertOne(db),
    () => { db.prepare(COMPLETE_PURCHASE_VAULT_SQL).run("unused-id", "launch", "v2-token", "0xowner", next, expected); },
    () => assertOne(db),
  ]);
  complete("job-a", "settlement-a", "0xtx-a", "10000000000000000000", "14000000000000000000");
  assert.equal(db.prepare(COMPLETE_PURCHASE_VAULT_SQL).run("wrong-owner", "launch", "v2-token",
    "0xrotated", "16000000000000000000", "14000000000000000000").changes, 0);
  assert.equal(db.prepare("SELECT owner_address FROM reward_vaults").get()?.owner_address, "0xowner");
  assert.throws(() => complete("job-b", "settlement-b", "0xtx-b", "10000000000000000000", "16000000000000000000"), /malformed JSON/);
  assert.equal(db.prepare("SELECT state FROM automation_jobs WHERE id = 'job-b'").get()?.state, "broadcasting");
  assert.equal(db.prepare("SELECT reward_swap_signature FROM settlements WHERE id = 'settlement-b'").get()?.reward_swap_signature, null);
  complete("job-b", "settlement-b", "0xtx-b", "14000000000000000000", "20000000000000000000");
  assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults").get()?.inventory_atomic, "20000000000000000000");
  assert.throws(() => complete("job-a", "settlement-a", "0xtx-a", "20000000000000000000", "24000000000000000000"), /malformed JSON/);
  assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults").get()?.inventory_atomic, "20000000000000000000");
  db.close();
});

test("a Solana reward purchase credits only its community launch and rolls back a stale vault write", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, state TEXT, tx_hash TEXT,
      error_code TEXT, leased_until INTEGER, updated_at TEXT);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT, reward_mint TEXT,
      mainnet_mint TEXT, mainnet_reward_treasury TEXT, status TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT, reward_amount_atomic TEXT,
      reward_swap_signature TEXT, buyback_swap_signature TEXT, burn_signature TEXT,
      state TEXT, updated_at TEXT);
    CREATE TABLE reward_vaults (id TEXT PRIMARY KEY, launch_id TEXT, reward_mint TEXT,
      chain TEXT, owner_address TEXT, token_account TEXT, state TEXT,
      inventory_atomic TEXT, last_observed_slot INTEGER, updated_at TEXT,
      UNIQUE(launch_id, reward_mint));
    INSERT INTO protocol_settings VALUES ('sportpad_mint', 'SPORTPAD');
    INSERT INTO launch_drafts VALUES ('community', 'solana', 'FAN', 'COMMUNITY', 'reward-treasury', 'mainnet_published'),
      ('platform', 'solana', 'FAN', 'SPORTPAD', 'reward-treasury', 'mainnet_published');
    INSERT INTO fee_events VALUES ('fee-a', 'community'), ('fee-b', 'community'),
      ('fee-platform', 'platform');
    INSERT INTO settlements VALUES
      ('settlement-a', 'fee-a', '50000000', NULL, NULL, NULL, 'reconciled', NULL),
      ('settlement-b', 'fee-b', '50000000', NULL, NULL, NULL, 'reconciled', NULL),
      ('platform', 'fee-platform', '50000000', NULL, NULL, NULL, 'reconciled', NULL);
    INSERT INTO automation_jobs VALUES ('job-a', 'broadcasting', NULL, 'broadcasting:worker', NULL, NULL),
      ('job-b', 'broadcasting', NULL, 'broadcasting:worker', NULL, NULL);
    INSERT INTO reward_vaults VALUES ('vault', 'community', 'FAN', 'solana',
      'reward-treasury', 'fan-ata', 'funded', '100', NULL, NULL);
  `);
  const complete = (jobId: string, settlementId: string, tx: string, oldValue: string, newValue: string) => atomic(db, [
    () => { db.prepare(COMPLETE_BROADCAST_JOB_SQL).run(jobId, tx, "broadcasting:worker"); },
    () => assertOne(db),
    () => { db.prepare(COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL).run(settlementId, tx,
      "community", "FAN", "reward-treasury", "50000000"); },
    () => assertOne(db),
    () => { db.prepare(COMPLETE_SOLANA_PURCHASE_VAULT_SQL).run("unused", "community",
      "FAN", "reward-treasury", "fan-ata", newValue, 100, oldValue); },
    () => assertOne(db),
  ]);
  assert.equal(db.prepare(COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL).run("platform", "platform-swap",
    "platform", "FAN", "reward-treasury", "50000000").changes, 0);
  db.exec("UPDATE launch_drafts SET status = 'mainnet_suspended' WHERE id = 'community'");
  assert.equal(db.prepare(COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL).run("settlement-a", "suspended-swap",
    "community", "FAN", "reward-treasury", "50000000").changes, 0);
  db.exec("UPDATE launch_drafts SET status = 'mainnet_published' WHERE id = 'community'");
  complete("job-a", "settlement-a", "swap-a", "100", "140");
  assert.throws(() => complete("job-b", "settlement-b", "swap-b", "100", "160"), /malformed JSON/);
  assert.equal(db.prepare("SELECT reward_swap_signature FROM settlements WHERE id = 'settlement-b'").get()?.reward_swap_signature, null);
  assert.equal(db.prepare("SELECT state FROM automation_jobs WHERE id = 'job-b'").get()?.state, "broadcasting");
  complete("job-b", "settlement-b", "swap-b", "140", "200");
  assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults").get()?.inventory_atomic, "200");
  assert.equal(db.prepare(COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL).run("settlement-a", "swap-a",
    "community", "FAN", "reward-treasury", "50000000").changes, 0);
  db.close();
});

test("a community Solana reward can settle before the SPORTPAD mint is registered", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT,
      reward_mint TEXT, mainnet_mint TEXT, mainnet_reward_treasury TEXT,
      status TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT,
      reward_swap_signature TEXT, buyback_swap_signature TEXT,
      burn_signature TEXT, reward_amount_atomic TEXT, state TEXT,
      updated_at TEXT);
    INSERT INTO launch_drafts VALUES ('community', 'solana', 'FAN',
      'COMMUNITY', 'reward-treasury', 'mainnet_published');
    INSERT INTO fee_events VALUES ('fee', 'community');
    INSERT INTO settlements VALUES ('settlement', 'fee', NULL, NULL,
      NULL, '50000000', 'reconciled', NULL);
  `);
  const settle = () => db.prepare(COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL)
    .run('settlement', 'swap', 'community', 'FAN', 'reward-treasury', '50000000').changes;
  assert.equal(settle(), 1);
  db.exec(`
    UPDATE settlements SET reward_swap_signature = NULL, state = 'reconciled';
    INSERT INTO protocol_settings VALUES ('sportpad_mint', 'COMMUNITY');
  `);
  assert.equal(settle(), 0);
  db.close();
});

test("only the same signed Solana reward swap can complete a held job", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT, entity_type TEXT, state TEXT,
      tx_hash TEXT, error_code TEXT, leased_until INTEGER, updated_at TEXT);
    INSERT INTO automation_jobs VALUES
      ('held', 'solana_reward_purchase', 'settlement_step', 'reconciliation_required',
        'signed-swap', 'swap_timeout', NULL, NULL),
      ('other', 'sportpad_buyback_burn', 'settlement', 'reconciliation_required',
        'burn', 'swap_timeout', NULL, NULL);
  `);
  assert.equal(db.prepare(COMPLETE_RECONCILED_JOB_SQL).run("held", "another-swap").changes, 0);
  assert.equal(db.prepare(COMPLETE_RECONCILED_JOB_SQL).run("other", "burn").changes, 0);
  assert.equal(db.prepare(COMPLETE_RECONCILED_JOB_SQL).run("held", "signed-swap").changes, 1);
  assert.equal(db.prepare(COMPLETE_RECONCILED_JOB_SQL).run("held", "signed-swap").changes, 0);
  db.close();
});

test("only an old unprepared reward job can be automatically requeued", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT, entity_type TEXT, entity_id TEXT,
      state TEXT, tx_hash TEXT, error_code TEXT, leased_until INTEGER,
      available_at INTEGER, updated_at TEXT);
    CREATE TABLE transaction_intents (idempotency_key TEXT, action TEXT);
    INSERT INTO automation_jobs VALUES
      ('unprepared', 'solana_reward_purchase', 'settlement_step', 'a', 'reconciliation_required', NULL,
        'quote_failed', NULL, 0, datetime('now', '-10 minutes')),
      ('prepared', 'solana_reward_purchase', 'settlement_step', 'b', 'reconciliation_required', NULL,
        'swap_timeout', NULL, 0, datetime('now', '-10 minutes')),
      ('reported', 'solana_reward_purchase', 'settlement_step', 'c', 'reconciliation_required', 'tx-c',
        'swap_timeout', NULL, 0, datetime('now', '-10 minutes')),
      ('fresh', 'solana_reward_purchase', 'settlement_step', 'd', 'broadcasting', NULL,
        'broadcasting:solana:treasury', NULL, 0, CURRENT_TIMESTAMP);
    INSERT INTO transaction_intents VALUES ('automation:reward:swap:b', 'solana_reward_purchase_automation');
  `);
  assert.equal(db.prepare(REQUEUE_UNPREPARED_REWARD_JOB_SQL)
    .run(100, "broadcasting:solana:treasury").changes, 1);
  assert.equal(db.prepare("SELECT state FROM automation_jobs WHERE id = 'unprepared'").get()?.state, "queued");
  for (const id of ["prepared", "reported", "fresh"]) {
    assert.notEqual(db.prepare("SELECT state FROM automation_jobs WHERE id = ?1").get(id)?.state, "queued");
  }
  db.close();
});

test("a settlement is complete only after both reward and buyback receipts, in either order", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT, reward_swap_signature TEXT,
      buyback_swap_signature TEXT, burn_signature TEXT, state TEXT, updated_at TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT, reward_mint TEXT, reward_wrapped_contract TEXT,
      mainnet_mint TEXT, status TEXT);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO protocol_settings VALUES ('sportpad_mint', 'sportpad-mint');
    INSERT INTO launch_drafts VALUES ('launch', 'chiliz', 'v2-token', NULL, 'community-mint', 'mainnet_published');
    INSERT INTO fee_events VALUES ('fee-a', 'launch'), ('fee-b', 'launch');
    INSERT INTO settlements VALUES ('settlement-a', 'fee-a', NULL, NULL, NULL, 'reconciled', NULL),
      ('settlement-b', 'fee-b', NULL, NULL, NULL, 'reconciled', NULL);
  `);
  db.prepare(COMPLETE_BUYBACK_SETTLEMENT_SQL).run("settlement-a", "swap-a", "burn-a");
  assertOne(db);
  assert.equal(db.prepare("SELECT state FROM settlements WHERE id = 'settlement-a'").get()?.state, "buyback_burned");
  db.prepare(COMPLETE_PURCHASE_SETTLEMENT_SQL).run("settlement-a", "reward-a", "launch", "v2-token");
  assertOne(db);
  assert.equal(db.prepare("SELECT state FROM settlements WHERE id = 'settlement-a'").get()?.state, "complete");

  db.prepare(COMPLETE_PURCHASE_SETTLEMENT_SQL).run("settlement-b", "reward-b", "launch", "v2-token");
  assertOne(db);
  assert.equal(db.prepare("SELECT state FROM settlements WHERE id = 'settlement-b'").get()?.state, "reward_acquired");
  db.prepare(COMPLETE_BUYBACK_SETTLEMENT_SQL).run("settlement-b", "swap-b", "burn-b");
  assertOne(db);
  assert.equal(db.prepare("SELECT state FROM settlements WHERE id = 'settlement-b'").get()?.state, "complete");
  db.close();
});

test("SPORTPAD's own fees cannot seed community buyback jobs or complete a burn settlement", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, mainnet_mint TEXT, status TEXT);
    CREATE TABLE fee_events (id TEXT PRIMARY KEY, launch_id TEXT);
    CREATE TABLE settlements (id TEXT PRIMARY KEY, fee_event_id TEXT, buyback_amount_atomic TEXT,
      buyback_swap_signature TEXT, burn_signature TEXT, reward_swap_signature TEXT, state TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE protocol_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO protocol_settings VALUES ('sportpad_mint', 'sportpad-mint');
    INSERT INTO launch_drafts VALUES ('platform', 'sportpad-mint', 'mainnet_published'),
      ('community', 'community-mint', 'mainnet_published'),
      ('unverified', NULL, 'draft');
    INSERT INTO fee_events VALUES ('fee-platform', 'platform'), ('fee-community', 'community'),
      ('fee-dust', 'community'), ('fee-unverified', 'unverified');
    INSERT INTO settlements VALUES
      ('platform', 'fee-platform', '20', NULL, NULL, NULL, 'reconciled', '2026-01-01', NULL),
      ('community', 'fee-community', '20', NULL, NULL, NULL, 'reconciled', '2026-01-02', NULL),
      ('dust', 'fee-dust', '0', NULL, NULL, NULL, 'reconciled', '2026-01-03', NULL),
      ('unverified', 'fee-unverified', '20', NULL, NULL, NULL, 'reconciled', '2026-01-04', NULL);
    ALTER TABLE settlements ADD COLUMN buyback_spent_atomic TEXT NOT NULL DEFAULT '0';
    CREATE TABLE settlement_steps (settlement_id TEXT, stage TEXT, state TEXT);
    CREATE TABLE automation_jobs (entity_type TEXT, entity_id TEXT, job_type TEXT);
    CREATE TABLE transaction_intents (settlement_id TEXT, action TEXT, state TEXT);
  `);
  const eligible = db.prepare(ELIGIBLE_COMMUNITY_BUYBACK_SETTLEMENTS_SQL).all("sportpad-mint");
  assert.deepEqual(eligible.map((row) => row.settlement_id), ["community"]);
  assert.equal(db.prepare(COMPLETE_BUYBACK_SETTLEMENT_SQL).run("platform", "swap-platform", "burn-platform").changes, 0);
  assert.equal(db.prepare(COMPLETE_BUYBACK_SETTLEMENT_SQL).run("community", "swap-community", "burn-community").changes, 1);
  db.close();
});

test("two claim completions cannot double-debit a vault or leave a confirmed claim without debit", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, state TEXT, tx_hash TEXT, error_code TEXT, leased_until INTEGER, updated_at TEXT);
    CREATE TABLE reward_claims (id TEXT PRIMARY KEY, state TEXT, claim_signature TEXT, updated_at TEXT);
    CREATE TABLE reward_vaults (
      launch_id TEXT, reward_mint TEXT, chain TEXT, inventory_atomic TEXT,
      reserved_atomic TEXT, claimed_atomic TEXT, updated_at TEXT,
      UNIQUE(launch_id, reward_mint)
    );
    INSERT INTO automation_jobs VALUES ('job-a', 'broadcasting', NULL, 'broadcasting:worker', NULL, NULL),
      ('job-b', 'broadcasting', NULL, 'broadcasting:worker', NULL, NULL);
    INSERT INTO reward_claims VALUES ('claim-a', 'queued', NULL, NULL), ('claim-b', 'queued', NULL, NULL);
    INSERT INTO reward_vaults VALUES ('launch', 'wrapped', 'chiliz', '10000000000000000000', '10000000000000000000', '0', NULL);
  `);
  const complete = (jobId: string, claimId: string, tx: string, previous: string[], next: string[]) => atomic(db, [
    () => { db.prepare(COMPLETE_BROADCAST_JOB_SQL).run(jobId, tx, "broadcasting:worker"); },
    () => assertOne(db),
    () => { db.prepare(COMPLETE_CLAIM_VAULT_SQL).run("launch", "wrapped", ...next, ...previous, "chiliz"); },
    () => assertOne(db),
    () => { db.prepare(COMPLETE_CLAIM_SQL).run(claimId, tx); },
    () => assertOne(db),
  ]);
  complete("job-a", "claim-a", "0xtx-a",
    ["10000000000000000000", "10000000000000000000", "0"],
    ["4000000000000000000", "4000000000000000000", "6000000000000000000"]);
  assert.throws(() => complete("job-b", "claim-b", "0xtx-b",
    ["10000000000000000000", "10000000000000000000", "0"],
    ["6000000000000000000", "6000000000000000000", "4000000000000000000"]), /malformed JSON/);
  assert.equal(db.prepare("SELECT state FROM reward_claims WHERE id = 'claim-b'").get()?.state, "queued");
  assert.equal(db.prepare("SELECT state FROM automation_jobs WHERE id = 'job-b'").get()?.state, "broadcasting");
  complete("job-b", "claim-b", "0xtx-b",
    ["4000000000000000000", "4000000000000000000", "6000000000000000000"],
    ["0", "0", "10000000000000000000"]);
  assert.deepEqual(db.prepare("SELECT inventory_atomic, reserved_atomic, claimed_atomic FROM reward_vaults").get(),
    Object.assign(Object.create(null), { inventory_atomic: "0", reserved_atomic: "0", claimed_atomic: "10000000000000000000" }));
  db.close();
});

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
  assert.equal(laneAllowsJob("solana_reward_purchase", openLanes), true);
  assert.equal(laneAllowsJob("solana_claim_payout", openLanes), true);
  assert.equal(laneAllowsJob("sportpad_buyback_burn", openLanes), true);
  for (const type of ["chiliz_reward_purchase", "chiliz_claim_unwrap", "solana_reward_purchase", "solana_claim_payout", "sportpad_buyback_burn"] as const) {
    assert.equal(laneAllowsJob(type, { ...openLanes, mainnetEnabled: false }), false);
  }
  assert.equal(laneAllowsJob("chiliz_reward_purchase", { ...openLanes, settlementPaused: true }), false);
  assert.equal(laneAllowsJob("solana_reward_purchase", { ...openLanes, settlementPaused: true }), false);
  assert.equal(laneAllowsJob("sportpad_buyback_burn", { ...openLanes, settlementPaused: true }), false);
  assert.equal(laneAllowsJob("chiliz_claim_unwrap", { ...openLanes, settlementPaused: true }), true);
  assert.equal(laneAllowsJob("chiliz_reward_purchase", { ...openLanes, rewardsPaused: true }), false);
  assert.equal(laneAllowsJob("solana_reward_purchase", { ...openLanes, rewardsPaused: true }), false);
  assert.equal(laneAllowsJob("chiliz_claim_unwrap", { ...openLanes, rewardsPaused: true }), false);
  assert.equal(laneAllowsJob("solana_claim_payout", { ...openLanes, claimsEnabled: false }), false);
  assert.equal(laneAllowsJob("sportpad_buyback_burn", { ...openLanes, buybackPaused: true }), false);
  assert.equal(laneAllowsJob("chiliz_claim_unwrap", { ...openLanes, buybackPaused: true }), true);
});

test("arming checks the matching database pause columns atomically", () => {
  assert.equal(pauseConditionSql("chiliz_reward_purchase"), "settlement_paused = 0 AND rewards_paused = 0");
  assert.equal(pauseConditionSql("solana_reward_purchase"), "settlement_paused = 0 AND rewards_paused = 0");
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
