import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { encodeFunctionData, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ASSERT_ONE_ROW_CHANGED_SQL } from "../protocol/automation-safety.ts";
import { CHILIZ_CHAIN_ID, KAYEN_ROUTER, WRAPPED_CHZ } from "../protocol/chiliz-receipts.ts";
import { createChilizSignedIntent, type ChilizReconciliationEvidence,
  type ChilizSignedIntent } from "../protocol/chiliz-signed-intent.ts";
import {
  ARM_CHILIZ_INTENT_POLICY_SQL, chilizFinalizationBindings,
  chilizSignedIntentInsertBindings, FINALIZE_CHILIZ_INTENT_SQL,
  FINALIZE_REVERTED_CHILIZ_JOB_SQL,
  INSERT_CHILIZ_SIGNED_INTENT_SQL, INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL,
  MARK_CHILIZ_INTENT_BROADCAST_SQL, parsePersistedChilizSignedIntent,
  PAUSE_CHILIZ_INTENT_POLICY_SQL, RESERVE_CHILIZ_INTENT_POLICY_SQL,
  REQUEUE_UNPREPARED_CHILIZ_JOB_SQL,
  REQUEUE_STALE_UNPREPARED_CHILIZ_BROADCAST_SQL,
  SELECT_CHILIZ_SIGNED_INTENT_SQL, type PersistedChilizIntentRow,
} from "./chiliz-intent-sql.ts";

const account = privateKeyToAccount(generatePrivateKey());
const token = "0x4444444444444444444444444444444444444444";
const destination = "0x5555555555555555555555555555555555555555";
const worker = `chiliz:${account.address.toLowerCase()}`;
const oneChz = 10n ** 18n;
const canaryCap = (3n * oneChz).toString();
const abi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const transferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT NOT NULL,
      chain TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL,
      error_code TEXT, tx_hash TEXT, payload_json TEXT NOT NULL DEFAULT '{}',
      leased_until INTEGER, available_at INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE protocol_controls (key TEXT PRIMARY KEY, rewards_paused INTEGER,
      settlement_paused INTEGER);
    INSERT INTO automation_jobs (id,job_type,chain,state,attempt,error_code) VALUES
      ('job_1','chiliz_reward_purchase','chiliz','broadcasting',1,'broadcasting:${worker}'),
      ('job_2','chiliz_reward_purchase','chiliz','broadcasting',1,'broadcasting:${worker}'),
      ('job_3','chiliz_claim_unwrap','chiliz','broadcasting',1,'broadcasting:${worker}');
    INSERT INTO protocol_controls VALUES ('global',1,1);
  `);
  db.exec(readFileSync(new URL("../../drizzle/0023_green_ulik.sql", import.meta.url), "utf8")
    .replaceAll("--> statement-breakpoint", ""));
  return db;
}

async function purchase(jobId = "job_1", nonce = 7): Promise<ChilizSignedIntent> {
  const signedAtEpochSeconds = 1_800_000_000;
  const deadlineEpochSeconds = signedAtEpochSeconds + 90;
  const rawTransaction = await account.signTransaction({
    chainId: CHILIZ_CHAIN_ID, type: "eip1559", nonce, gas: 200_000n,
    maxFeePerGas: 2_500_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
    to: KAYEN_ROUTER, value: 2n * oneChz,
    data: encodeFunctionData({ abi, functionName: "swapExactETHForTokens",
      args: [100n, [WRAPPED_CHZ, token], account.address, BigInt(deadlineEpochSeconds)] }),
  });
  return createChilizSignedIntent({ kind: "purchase", jobId, attempt: 1,
    treasury: account.address, fanTokenContract: token, rawTransaction,
    gasFeeCeilingWei: oneChz.toString(), maxPrincipalWei: (2n * oneChz).toString(),
    minimumOutputAtomic: "100", signedAtEpochSeconds, deadlineEpochSeconds });
}

async function claim(): Promise<ChilizSignedIntent> {
  const rawTransaction = await account.signTransaction({
    chainId: CHILIZ_CHAIN_ID, type: "eip1559", nonce: 8, gas: 100_000n,
    maxFeePerGas: 2_500_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
    to: token, value: 0n,
    data: encodeFunctionData({ abi: transferAbi, functionName: "transfer",
      args: [destination, 500n] }),
  });
  return createChilizSignedIntent({ kind: "claim", jobId: "job_3", attempt: 1,
    treasury: account.address, fanTokenContract: token, rawTransaction,
    destination, amountAtomic: "500", gasFeeCeilingWei: oneChz.toString() });
}

function unpause(db: DatabaseSync) {
  db.exec("UPDATE protocol_controls SET rewards_paused=0,settlement_paused=0 WHERE key='global'");
}

function arm(db: DatabaseSync) {
  assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL)
    .run("job_1", canaryCap).changes, 1);
  assert.equal(db.prepare("SELECT state FROM chiliz_intent_policy").get()?.state, "paused");
  assert.equal(db.prepare(ARM_CHILIZ_INTENT_POLICY_SQL).run("job_1").changes, 1);
}

function armClaim(db: DatabaseSync) {
  assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL)
    .run("job_3", oneChz.toString()).changes, 1);
  assert.equal(db.prepare(ARM_CHILIZ_INTENT_POLICY_SQL).run("job_3").changes, 1);
}

function insert(db: DatabaseSync, intent: ChilizSignedIntent, id = "intent_1", owner = worker) {
  return db.prepare(INSERT_CHILIZ_SIGNED_INTENT_SQL)
    .run(...chilizSignedIntentInsertBindings(intent, owner, id)).changes;
}

function reserve(db: DatabaseSync, id = "intent_1", jobId = "job_1") {
  return db.prepare(RESERVE_CHILIZ_INTENT_POLICY_SQL).run(jobId, id).changes;
}

test("schema is additive, empty, paused by default and uniquely fences job and nonce", async () => {
  const db = fixture();
  try {
    const intent = await purchase();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chiliz_intent_policy").get()?.n, 0);
    assert.equal(insert(db, intent), 0);
    assert.throws(() => db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get());
    assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL)
      .run("job_1", (11n * oneChz).toString()).changes, 0);
    arm(db);
    assert.equal(insert(db, intent), 0); // global rewards lane still paused
    unpause(db);
    assert.equal(insert(db, intent, "intent_1", "chiliz:wrong"), 0);
    db.exec("UPDATE automation_jobs SET attempt=2 WHERE id='job_1'");
    assert.equal(insert(db, intent), 0);
    db.exec("UPDATE automation_jobs SET attempt=1 WHERE id='job_1'");
    db.exec(`UPDATE chiliz_intent_policy SET max_total_spend_wei='1000000000000000000'`);
    assert.equal(insert(db, intent), 0); // principal plus gas exceeds explicit one-shot cap
    db.prepare("UPDATE chiliz_intent_policy SET max_total_spend_wei=?1")
      .run(canaryCap);
    assert.equal(insert(db, intent), 1);
    assert.equal(reserve(db), 1);
    assert.equal(db.prepare("SELECT state,reserved_intent_id FROM chiliz_intent_policy")
      .get()?.reserved_intent_id, "intent_1");
    assert.equal(insert(db, intent), 0);
    assert.equal(db.prepare(ARM_CHILIZ_INTENT_POLICY_SQL).run("job_1").changes, 0);
    assert.throws(() => db.exec("UPDATE chiliz_signed_intents SET nonce=nonce+1"),
      /chiliz_signed_intent_immutable/);
    assert.throws(() => db.exec("DELETE FROM chiliz_signed_intents"),
      /chiliz_signed_intent_no_delete/);
    assert.throws(() => db.exec("UPDATE chiliz_intent_policy SET reserved_intent_id=NULL"),
      /chiliz_policy_reserved_immutable/);
    assert.equal(db.prepare(PAUSE_CHILIZ_INTENT_POLICY_SQL).run().changes, 1);
    assert.equal(db.prepare(ARM_CHILIZ_INTENT_POLICY_SQL).run("job_1").changes, 0);
    assert.equal(db.prepare(MARK_CHILIZ_INTENT_BROADCAST_SQL)
      .run("job_1", intent.txHash, 1_800_000_000_000).changes, 0);
    assert.throws(() => db.exec("DELETE FROM chiliz_intent_policy"),
      /chiliz_policy_reserved_no_delete/);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const indexes = db.prepare("PRAGMA index_list('chiliz_signed_intents')").all()
      .filter((row) => row.unique === 1).map((row) => row.name);
    assert.ok(indexes.includes("idx_chiliz_intent_job"));
    assert.ok(indexes.includes("idx_chiliz_intent_job_attempt"));
    assert.ok(indexes.includes("idx_chiliz_intent_treasury_nonce"));
    assert.ok(indexes.includes("idx_chiliz_intent_tx_hash"));
  } finally { db.close(); }
});

test("two independent one-shot slots permit one purchase and one claim within 9+1 CHZ", async () => {
  const db = fixture();
  try {
    const purchaseIntent = await purchase();
    const claimIntent = await claim();
    assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL)
      .run("job_1", (9n * oneChz + 1n).toString()).changes, 0);
    assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL)
      .run("job_3", (oneChz + 1n).toString()).changes, 0);
    arm(db);
    assert.throws(() => db.exec(`INSERT INTO chiliz_intent_policy
      (key,authorized_job_id,max_total_spend_wei)
      VALUES ('claim_canary','job_1','1000000000000000000')`), /UNIQUE constraint failed/);
    armClaim(db);
    unpause(db);
    assert.equal(insert(db, purchaseIntent, "purchase_intent"), 1);
    assert.equal(reserve(db, "purchase_intent"), 1);
    assert.equal(insert(db, claimIntent, "claim_intent"), 1);
    assert.equal(reserve(db, "claim_intent", "job_3"), 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chiliz_signed_intents").get()?.n, 2);
    assert.deepEqual(await parsePersistedChilizSignedIntent(
      db.prepare(SELECT_CHILIZ_SIGNED_INTENT_SQL).get("job_3") as PersistedChilizIntentRow),
    claimIntent);
    assert.deepEqual(db.prepare(`SELECT key FROM chiliz_intent_policy ORDER BY key`).all()
      .map((row) => row.key), ["claim_canary", "purchase_canary"]);
    assert.throws(() => db.prepare(INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL)
      .run("job_2", oneChz.toString()), /UNIQUE constraint failed/);
    const indexes = db.prepare("PRAGMA index_list('chiliz_intent_policy')").all()
      .filter((row) => row.unique === 1).map((row) => row.name);
    assert.ok(indexes.includes("idx_chiliz_policy_authorized_job"));
    assert.ok(indexes.includes("idx_chiliz_policy_reserved_intent"));
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});

test("reservation and signed intent commit or roll back together", async () => {
  const db = fixture();
  try {
    const intent = await purchase();
    arm(db);
    unpause(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      assert.equal(insert(db, intent), 1);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      assert.equal(reserve(db, "wrong_intent"), 0);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      assert.fail("failed policy reservation must roll back signed intent");
    } catch { db.exec("ROLLBACK"); }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chiliz_signed_intents").get()?.n, 0);
    assert.equal(db.prepare("SELECT state FROM chiliz_intent_policy").get()?.state, "armed");
    db.exec("BEGIN IMMEDIATE");
    try {
      assert.equal(insert(db, intent), 1);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      assert.equal(reserve(db), 1);
      db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chiliz_signed_intents").get()?.n, 1);
    assert.equal(db.prepare("SELECT state FROM chiliz_intent_policy").get()?.state, "reserved");
  } finally { db.close(); }
});

test("stored raw/hash/caps are verified and different nonce or raw cannot replace", async () => {
  const db = fixture();
  try {
    const intent = await purchase();
    arm(db);
    unpause(db);
    assert.equal(insert(db, intent), 1);
    assert.equal(reserve(db), 1);
    const row = db.prepare(SELECT_CHILIZ_SIGNED_INTENT_SQL).get("job_1") as PersistedChilizIntentRow;
    assert.deepEqual(await parsePersistedChilizSignedIntent(row), intent);
    await assert.rejects(() => parsePersistedChilizSignedIntent({ ...row, tx_hash: `0x${"f".repeat(64)}` }),
      /persisted_row_mismatch/);
    await assert.rejects(() => parsePersistedChilizSignedIntent({ ...row, raw_transaction: "0x02" }),
      /persisted_row_mismatch/);
    const otherNonce = await purchase("job_1", 8);
    assert.equal(insert(db, otherNonce, "intent_2"), 0);
    // Even a caller bypassing the canary predicate cannot reuse the same
    // treasury nonce or job ID because both are hard database constraints.
    assert.throws(() => db.prepare(`INSERT INTO chiliz_signed_intents
      (id,job_id,attempt,chain_id,treasury_address,nonce,kind,fan_token_contract,
      tx_hash,raw_transaction,intent_json,maximum_principal_wei,
      maximum_network_fee_wei,maximum_total_spend_wei)
      SELECT 'intent_2','job_2',attempt,chain_id,treasury_address,nonce,kind,
        fan_token_contract,?1,raw_transaction,intent_json,maximum_principal_wei,
        maximum_network_fee_wei,maximum_total_spend_wei
      FROM chiliz_signed_intents WHERE id='intent_1'`)
      .run(`0x${"e".repeat(64)}`), /UNIQUE constraint failed/);
  } finally { db.close(); }
});

test("broadcast marker and finalized receipt evidence are one-way", async () => {
  const db = fixture();
  try {
    const intent = await purchase();
    arm(db);
    unpause(db);
    assert.equal(insert(db, intent), 1);
    assert.equal(reserve(db), 1);
    assert.equal(db.prepare(MARK_CHILIZ_INTENT_BROADCAST_SQL)
      .run("job_1", intent.txHash, 1_800_000_000_000).changes, 1);
    assert.equal(db.prepare(MARK_CHILIZ_INTENT_BROADCAST_SQL)
      .run("job_1", intent.txHash, 1_800_000_000_001).changes, 0);
    const blockHash = `0x${"a".repeat(64)}`;
    const input = encodeFunctionData({ abi, functionName: "swapExactETHForTokens",
      args: [100n, [WRAPPED_CHZ, token], account.address, 1_800_000_090n] });
    const evidence: ChilizReconciliationEvidence = {
      chainId: CHILIZ_CHAIN_ID, canonicalReceiptBlockHash: blockHash,
      finalizedBlockNumber: 101n,
      transaction: { hash: intent.txHash, from: account.address, to: KAYEN_ROUTER,
        input, value: BigInt(intent.valueWei), chainId: CHILIZ_CHAIN_ID,
        nonce: intent.nonce, gas: BigInt(intent.gasLimit),
        maxFeePerGas: BigInt(intent.maxFeePerGasWei),
        maxPriorityFeePerGas: BigInt(intent.maxPriorityFeePerGasWei),
        type: "eip1559", blockHash, blockNumber: 100n },
      receipt: { transactionHash: intent.txHash, status: "success", blockHash,
        blockNumber: 100n, gasUsed: 150_000n, effectiveGasPrice: 2_000_000_000n },
    };
    const bindings = await chilizFinalizationBindings(intent, evidence);
    assert.equal(db.prepare(FINALIZE_CHILIZ_INTENT_SQL).run(...bindings).changes, 1);
    assert.equal(db.prepare(FINALIZE_CHILIZ_INTENT_SQL).run(...bindings).changes, 0);
    const row = db.prepare(SELECT_CHILIZ_SIGNED_INTENT_SQL).get("job_1") as
      PersistedChilizIntentRow & { receipt_block_number: number; state: string; total_spent_wei: string };
    assert.equal(row.state, "finalized_success");
    assert.equal(row.receipt_block_number, 100);
    assert.equal(row.total_spent_wei, (2n * oneChz + 150_000n * 2_000_000_000n).toString());
    await assert.rejects(() => chilizFinalizationBindings(intent,
      { ...evidence, finalizedBlockNumber: 99n }), /finality_unverified/);
  } finally { db.close(); }
});

test("a finalized revert records gas and closes only the job, not its reward liability", async () => {
  const db = fixture();
  try {
    const intent = await purchase();
    arm(db); unpause(db);
    assert.equal(insert(db, intent), 1);
    assert.equal(reserve(db), 1);
    const blockHash = `0x${"b".repeat(64)}`;
    const input = encodeFunctionData({ abi, functionName: "swapExactETHForTokens",
      args: [100n, [WRAPPED_CHZ, token], account.address, 1_800_000_090n] });
    const proof: ChilizReconciliationEvidence = {
      chainId: CHILIZ_CHAIN_ID, canonicalReceiptBlockHash: blockHash,
      finalizedBlockNumber: 101n,
      transaction: { hash: intent.txHash, from: account.address, to: KAYEN_ROUTER,
        input, value: BigInt(intent.valueWei), chainId: CHILIZ_CHAIN_ID,
        nonce: intent.nonce, gas: BigInt(intent.gasLimit),
        maxFeePerGas: BigInt(intent.maxFeePerGasWei),
        maxPriorityFeePerGas: BigInt(intent.maxPriorityFeePerGasWei),
        type: "eip1559", blockHash, blockNumber: 100n },
      receipt: { transactionHash: intent.txHash, status: "reverted", blockHash,
        blockNumber: 100n, gasUsed: 150_000n, effectiveGasPrice: 2_000_000_000n },
    };
    const bindings = await chilizFinalizationBindings(intent, proof);
    db.exec("BEGIN IMMEDIATE");
    try {
      assert.equal(db.prepare(FINALIZE_CHILIZ_INTENT_SQL).run(...bindings).changes, 1);
      assert.equal(db.prepare(FINALIZE_REVERTED_CHILIZ_JOB_SQL)
        .run(intent.jobId, intent.txHash, JSON.stringify({ state: "finalized_reverted" })).changes, 1);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const row = db.prepare(`SELECT j.state AS job_state,j.error_code,
      i.state AS intent_state,i.principal_spent_wei,i.network_fee_wei,i.total_spent_wei
      FROM automation_jobs j JOIN chiliz_signed_intents i ON i.job_id=j.id
      WHERE j.id='job_1'`).get();
    assert.equal(row?.job_state, "failed");
    assert.equal(row?.error_code, "chiliz_finalized_reverted");
    assert.equal(row?.intent_state, "finalized_reverted");
    assert.equal(row?.principal_spent_wei, "0");
    assert.equal(row?.total_spent_wei, row?.network_fee_wei);
    assert.equal(db.prepare(FINALIZE_REVERTED_CHILIZ_JOB_SQL)
      .run(intent.jobId, intent.txHash, "{}").changes, 0);
  } finally { db.close(); }
});

test("only an aged first-attempt Chiliz job with zero signed/broadcast evidence can requeue", () => {
  const db = fixture();
  try {
    arm(db);
    db.exec(`UPDATE automation_jobs SET state='reconciliation_required',
      error_code='chiliz_quote_failed', updated_at=datetime('now','-10 minutes')
      WHERE id='job_1'`);
    const requeue = (errorCode = "chiliz_quote_failed") => db.prepare(REQUEUE_UNPREPARED_CHILIZ_JOB_SQL)
      .run("job_1", errorCode, 1_800_000_000_000).changes;
    assert.equal(requeue("wrong_error"), 0);
    assert.equal(requeue(), 1);
    assert.deepEqual({ ...db.prepare(`SELECT state,attempt,error_code,available_at
      FROM automation_jobs WHERE id='job_1'`).get() }, {
      state: "queued", attempt: 0, error_code: null, available_at: 1_800_000_000_000,
    });
    assert.equal(requeue(), 0);
  } finally { db.close(); }
});

test("no-intent recovery holds recent, retried, owner-ambiguous, receipt or signed jobs", async () => {
  for (const [mutation, expected] of [
    ["UPDATE automation_jobs SET updated_at=CURRENT_TIMESTAMP WHERE id='job_1'", 0],
    ["UPDATE automation_jobs SET attempt=2 WHERE id='job_1'", 0],
    ["UPDATE automation_jobs SET tx_hash='0xabc' WHERE id='job_1'", 0],
    ["UPDATE automation_jobs SET leased_until=1 WHERE id='job_1'", 0],
    ["UPDATE automation_jobs SET payload_json='{\"reconciliationReceipt\":{}}' WHERE id='job_1'", 0],
    ["UPDATE automation_jobs SET state='broadcasting' WHERE id='job_1'", 0],
  ] as const) {
    const db = fixture();
    try {
      arm(db);
      db.exec(`UPDATE automation_jobs SET state='reconciliation_required',
        error_code='chiliz_quote_failed', updated_at=datetime('now','-10 minutes')
        WHERE id='job_1'`);
      db.exec(mutation);
      assert.equal(db.prepare(REQUEUE_UNPREPARED_CHILIZ_JOB_SQL)
        .run("job_1", "chiliz_quote_failed", 1_800_000_000_000).changes,
      expected, mutation);
    } finally { db.close(); }
  }
  const signedDb = fixture();
  try {
    arm(signedDb);
    unpause(signedDb);
    const intent = await purchase();
    assert.equal(insert(signedDb, intent), 1);
    assert.equal(reserve(signedDb), 1);
    signedDb.exec(`UPDATE automation_jobs SET state='reconciliation_required',
      error_code='chiliz_quote_failed', updated_at=datetime('now','-10 minutes')
      WHERE id='job_1'`);
    assert.equal(signedDb.prepare(REQUEUE_UNPREPARED_CHILIZ_JOB_SQL)
      .run("job_1", "chiliz_quote_failed", 1_800_000_000_000).changes, 0);
  } finally { signedDb.close(); }
});

test("stale owned broadcast without a signed intent can requeue at attempt one", () => {
  const db = fixture();
  try {
    arm(db);
    db.exec(`UPDATE automation_jobs SET updated_at=datetime('now','-10 minutes')
      WHERE id='job_1'`);
    const requeue = (owner = worker) => db.prepare(REQUEUE_STALE_UNPREPARED_CHILIZ_BROADCAST_SQL)
      .run("job_1", owner, 1_800_000_000_000).changes;
    assert.equal(requeue("chiliz:wrong"), 0);
    assert.equal(requeue(), 1);
    assert.deepEqual({ ...db.prepare(`SELECT state,attempt,error_code,available_at
      FROM automation_jobs WHERE id='job_1'`).get() }, {
      state: "queued", attempt: 0, error_code: null, available_at: 1_800_000_000_000,
    });
    assert.equal(requeue(), 0);
  } finally { db.close(); }
});

test("stale broadcast recovery cannot pass once receipt, hash, or intent exists", async () => {
  for (const mutation of [
    "UPDATE automation_jobs SET updated_at=CURRENT_TIMESTAMP WHERE id='job_1'",
    "UPDATE automation_jobs SET attempt=2 WHERE id='job_1'",
    "UPDATE automation_jobs SET tx_hash='0xabc' WHERE id='job_1'",
    "UPDATE automation_jobs SET leased_until=1 WHERE id='job_1'",
    "UPDATE automation_jobs SET payload_json='{\"reconciliationReceipt\":{}}' WHERE id='job_1'",
    "UPDATE automation_jobs SET state='reconciliation_required' WHERE id='job_1'",
  ]) {
    const db = fixture();
    try {
      arm(db);
      db.exec(`UPDATE automation_jobs SET updated_at=datetime('now','-10 minutes')
        WHERE id='job_1'`);
      db.exec(mutation);
      assert.equal(db.prepare(REQUEUE_STALE_UNPREPARED_CHILIZ_BROADCAST_SQL)
        .run("job_1", worker, 1_800_000_000_000).changes, 0, mutation);
    } finally { db.close(); }
  }
  const signedDb = fixture();
  try {
    arm(signedDb);
    unpause(signedDb);
    assert.equal(insert(signedDb, await purchase()), 1);
    assert.equal(reserve(signedDb), 1);
    signedDb.exec(`UPDATE automation_jobs SET updated_at=datetime('now','-10 minutes')
      WHERE id='job_1'`);
    assert.equal(signedDb.prepare(REQUEUE_STALE_UNPREPARED_CHILIZ_BROADCAST_SQL)
      .run("job_1", worker, 1_800_000_000_000).changes, 0);
  } finally { signedDb.close(); }
});
