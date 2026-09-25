import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const solTreasury = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const chzTreasury = `0x${"a".repeat(40)}`;
const fanToken = `0x${"b".repeat(40)}`;
const chzMint = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const feeSignature = "3".repeat(64);
const eventId = `${feeSignature}:0`;
const reservationId = `chiliz:fee:${eventId}`;
const swapId = `chiliz:sol-chz:${reservationId}:0:0`;
const bridgeId = "bridge-canary";
const allocationId = "allocation-canary";
const creditId = `chiliz:v2-credit:${allocationId}`;
const destinationHash = `0x${"d".repeat(64)}`;
const purchaseHash = `0x${"e".repeat(64)}`;
const receivedWei = "5000000000000000000";
const reserveWei = "100000000000000000";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE launch_drafts (id TEXT PRIMARY KEY, reward_chain TEXT,
      reward_bps INTEGER, buyback_bps INTEGER, status TEXT,
      mainnet_verified_at TEXT, mainnet_mint TEXT,
      mainnet_reward_treasury TEXT, mainnet_fee_slot INTEGER,
      reward_mint TEXT, reward_symbol TEXT, reward_wrapped_contract TEXT);
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
    CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, job_type TEXT,
      entity_type TEXT, entity_id TEXT, chain TEXT, payload_json TEXT,
      state TEXT, attempt INTEGER, tx_hash TEXT, error_code TEXT);
  `);
  for (const migration of ["0023_green_ulik", "0024_freezing_black_crow",
    "0027_glossy_agent_zero", "0028_confused_epoch",
    "0029_living_calypso", "0031_cheerful_jasper_sitwell"]) {
    db.exec(readFileSync(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", ""));
  }
  db.prepare(`INSERT INTO launch_drafts VALUES
    ('launch','chiliz',8000,2000,'mainnet_published','2026-09-25',
     'coin-mint',?1,99,?2,'BAR',NULL)`).run(solTreasury, fanToken);
  db.prepare(`INSERT INTO fee_events VALUES (?1,'launch',?2,0,100,
    '1250000','reconciled')`).run(eventId, feeSignature);
  db.prepare(`INSERT INTO settlements VALUES ('settlement',?1,'1000000',
    '250000','0',NULL,'reconciled')`).run(eventId);
  db.prepare(`INSERT INTO chiliz_fee_reservations
    (id,fee_event_id,settlement_id,launch_id,reward_treasury,source_signature,
     source_slot,gross_amount_lamports,reward_amount_lamports)
    VALUES (?1,?2,'settlement','launch',?3,?4,100,'1250000','1000000')`)
    .run(reservationId, eventId, solTreasury, feeSignature);
  db.prepare(`INSERT INTO chiliz_sol_chz_swap_journal
    (id,reservation_id,chunk_sequence,attempt_sequence,chunk_offset_lamports,
     source_wallet,input_mint,output_mint,output_token_program,output_ata,
     input_amount_lamports,minimum_output_atomic,provider_request_id,
     last_valid_block_height,unsigned_transaction_base64,signed_transaction_base64,
     signed_transaction_sha256,transaction_message_hash,source_signature)
    VALUES (?1,?2,0,0,'0',?3,
      'So11111111111111111111111111111111111111112',?4,
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','chz-ata',
      '1000000','1','jupiter-request',200,?5,?6,?7,?8,?9)`)
    .run(swapId, reservationId, solTreasury, chzMint, "A".repeat(100),
      "B".repeat(100), "a".repeat(64), "b".repeat(64), "4".repeat(64));
  db.prepare(`UPDATE chiliz_sol_chz_swap_journal SET state='broadcast_unknown',
    broadcast_attempted_at_ms=1000 WHERE id=?`).run(swapId);
  const swapEvidence = JSON.stringify({ finalized: true, status: "finalized_success",
    signature: "4".repeat(64), slot: 200, sourceWallet: solTreasury,
    outputAta: "chz-ata", sourceBalanceBeforeLamports: "500000000",
    sourceBalanceAfterLamports: "498995000", outputBalanceBeforeAtomic: "0",
    outputBalanceAfterAtomic: "500000000", outputAmountAtomic: "500000000",
    receiptErrorCode: null });
  db.prepare(`UPDATE chiliz_sol_chz_swap_journal SET state='finalized_success',
    finalized_slot=200,source_balance_before_lamports='500000000',
    source_balance_after_lamports='498995000',output_balance_before_atomic='0',
    output_balance_after_atomic='500000000',output_amount_atomic='500000000',
    receipt_evidence_json=?2 WHERE id=?1`).run(swapId, swapEvidence);
  db.prepare(`INSERT INTO chiliz_bridge_transfers
    (id,source_wallet,destination_treasury,source_mint,destination_chain_id,
     source_amount_atomic,minimum_destination_wei)
    VALUES (?1,?2,?3,?4,88888,'500000000','4950000000000000000')`)
    .run(bridgeId, solTreasury, chzTreasury, chzMint);
  db.prepare(`INSERT INTO chiliz_bridge_allocations
    (id,bridge_id,swap_intent_id,reservation_id,fee_event_id,launch_id,
     swap_output_offset_atomic,amount_atomic)
    VALUES (?1,?2,?3,?4,?5,'launch','0','500000000')`)
    .run(allocationId, bridgeId, swapId, reservationId, eventId);
  db.prepare(`UPDATE chiliz_bridge_transfers SET state='prepared',
    quote_id='bridge-quote',quote_expires_at_ms=2000000,
    signed_transaction_base64=?2,signed_transaction_sha256=?3,
    source_signature=?4 WHERE id=?1`)
    .run(bridgeId, "C".repeat(100), "c".repeat(64), "5".repeat(64));
  db.prepare(`UPDATE chiliz_bridge_transfers SET state='broadcast_unknown',
    broadcast_attempted_at_ms=1000 WHERE id=?`).run(bridgeId);
  const guid = `0x${"c".repeat(64)}`;
  const sourceProof = JSON.stringify({ finalized: true,
    sourceSignature: "5".repeat(64), sourceWallet: solTreasury,
    sourceAmountAtomic: "500000000", finalizedSlot: 200,
    bridgeMessageId: guid });
  db.prepare(`UPDATE chiliz_bridge_transfers SET state='source_finalized',
    source_finalized_slot=200,bridge_message_id=?2,source_evidence_json=?3
    WHERE id=?1`).run(bridgeId, guid, sourceProof);
  const destProof = JSON.stringify({ finalized: true, chainId: 88888,
    bridgeMessageId: guid, destinationTreasury: chzTreasury,
    transactionHash: destinationHash, finalizedBlock: 300,
    receivedWei });
  db.prepare(`UPDATE chiliz_bridge_transfers SET state='destination_finalized',
    destination_tx_hash=?2,destination_finalized_block=300,
    destination_received_wei=?3,destination_evidence_json=?4
    WHERE id=?1`).run(bridgeId, destinationHash, receivedWei, destProof);
  const payload = JSON.stringify({ settlementId: "settlement", launchId: "launch",
    rewardAmountLamports: "1000000", rewardSymbol: "BAR",
    fanTokenContract: fanToken });
  db.prepare(`INSERT INTO automation_jobs VALUES
    ('purchase-job','chiliz_reward_purchase','settlement','settlement',
     'chiliz',?1,'queued',0,NULL,NULL)`).run(payload);
  return db;
}

function credit(db: DatabaseSync, id = creditId, received = receivedWei) {
  db.prepare(`INSERT INTO chiliz_v2_purchase_credits
    (id,bridge_id,allocation_id,reservation_id,fee_event_id,settlement_id,
     launch_id,job_id,destination_treasury,destination_tx_hash,
     destination_received_wei,gas_reserve_wei)
    VALUES (?1,?2,?3,?4,?5,'settlement','launch','purchase-job',
      ?6,?7,?8,?9)`)
    .run(id, bridgeId, allocationId, reservationId, eventId,
      chzTreasury, destinationHash, received, reserveWei);
}

function intent(db: DatabaseSync, totalWei = "4860000000000000000",
  principalWei = "4850000000000000000") {
  db.prepare(`INSERT INTO chiliz_signed_intents
    (id,job_id,attempt,chain_id,treasury_address,nonce,kind,
     fan_token_contract,tx_hash,raw_transaction,intent_json,
     maximum_principal_wei,maximum_network_fee_wei,maximum_total_spend_wei)
    VALUES ('intent','purchase-job',1,88888,?1,0,'purchase',?2,?3,
      '0x02','{}',?4,'10000000000000000',?5)`)
    .run(chzTreasury, fanToken, purchaseHash, principalWei, totalWei);
}

test("credit requires finalized, single-fee OFT proceeds and cannot be reused", () => {
  const db = fixture();
  assert.throws(() => credit(db, "wrong-id"), /chiliz_v2_credit_unbacked/);
  assert.throws(() => credit(db, creditId, "6000000000000000000"),
    /chiliz_v2_credit_unbacked/);
  credit(db);
  assert.throws(() => credit(db), /UNIQUE constraint failed/);
  assert.throws(() => db.exec("DELETE FROM chiliz_v2_purchase_credits"),
    /chiliz_v2_credit_immutable/);
  assert.throws(() => db.exec("UPDATE chiliz_v2_purchase_credits SET state='available'"),
    /chiliz_v2_credit_invalid_transition/);
  db.close();
});

test("signed buy is capped by exact credit less gas reserve and unknown is one-way", () => {
  const db = fixture();
  credit(db);
  db.exec("UPDATE automation_jobs SET state='broadcasting',attempt=1 WHERE id='purchase-job'");
  assert.throws(() => intent(db, "4910000000000000000", "4900000000000000000"),
    /chiliz_v2_purchase_unfunded/);
  assert.throws(() => intent(db, "1000000000000000000", "990000000000000000"),
    /chiliz_v2_purchase_unfunded/);
  intent(db);
  assert.equal((db.prepare(`SELECT state,signed_intent_id FROM chiliz_v2_purchase_credits`)
    .get() as { state: string; signed_intent_id: string }).state, "prepared");
  assert.throws(() => db.exec(`UPDATE chiliz_signed_intents SET state='finalized_success'
    WHERE id='intent'`), /chiliz_v2_purchase_intent_invalid_transition/);
  db.exec(`UPDATE chiliz_signed_intents SET state='broadcast_attempted',
    broadcast_attempted_at=1000 WHERE id='intent'`);
  assert.equal((db.prepare("SELECT state FROM chiliz_v2_purchase_credits")
    .get() as { state: string }).state, "broadcast_unknown");
  assert.throws(() => db.exec(`UPDATE chiliz_signed_intents SET state='prepared'
    WHERE id='intent'`), /chiliz_v2_purchase_intent_invalid_transition/);
  assert.throws(() => db.exec("UPDATE chiliz_v2_purchase_credits SET state='available'"),
    /chiliz_v2_credit_invalid_transition/);
  db.close();
});

test("only exact finalized buy can discharge reserved settlement", () => {
  const db = fixture();
  credit(db);
  db.exec("UPDATE automation_jobs SET state='broadcasting',attempt=1 WHERE id='purchase-job'");
  intent(db);
  db.exec(`UPDATE chiliz_signed_intents SET state='broadcast_attempted',
    broadcast_attempted_at=1000 WHERE id='intent'`);
  db.prepare(`UPDATE chiliz_signed_intents SET state='finalized_success',
    receipt_status='success',network_fee_wei='10000000000000000',
    principal_spent_wei='4850000000000000000',
    total_spent_wei='4860000000000000000' WHERE id='intent'`).run();
  assert.equal((db.prepare("SELECT state FROM chiliz_v2_purchase_credits")
    .get() as { state: string }).state, "finalized_success");
  assert.throws(() => db.exec(`UPDATE settlements SET
    reward_swap_signature='wrong' WHERE id='settlement'`),
  /chiliz_fee_already_reserved/);
  assert.throws(() => db.prepare(`UPDATE settlements SET
    reward_swap_signature=? WHERE id='settlement'`).run(purchaseHash),
  /chiliz_fee_already_reserved/);
  db.prepare(`UPDATE automation_jobs SET state='complete',tx_hash=?
    WHERE id='purchase-job'`).run(purchaseHash);
  db.prepare(`UPDATE settlements SET reward_swap_signature=?
    WHERE id='settlement'`).run(purchaseHash);
  assert.equal((db.prepare("SELECT reward_swap_signature FROM settlements")
    .get() as { reward_swap_signature: string }).reward_swap_signature, purchaseHash);
  assert.throws(() => db.exec(`UPDATE settlements SET reward_spent_atomic='1'
    WHERE id='settlement'`), /chiliz_fee_already_reserved/);
  db.close();
});

test("failed settlement CAS rolls purchase credit and job finalization back together", () => {
  const db = fixture();
  credit(db);
  db.exec("UPDATE automation_jobs SET state='broadcasting',attempt=1 WHERE id='purchase-job'");
  intent(db);
  db.exec(`UPDATE chiliz_signed_intents SET state='broadcast_attempted',
    broadcast_attempted_at=1000 WHERE id='intent'`);
  db.exec("BEGIN");
  db.prepare(`UPDATE automation_jobs SET state='complete',tx_hash=?
    WHERE id='purchase-job'`).run(purchaseHash);
  db.exec(`UPDATE chiliz_signed_intents SET state='finalized_success',
    receipt_status='success',network_fee_wei='10000000000000000',
    principal_spent_wei='4850000000000000000',
    total_spent_wei='4860000000000000000' WHERE id='intent'`);
  assert.throws(() => db.exec(`UPDATE settlements SET
    reward_swap_signature='wrong' WHERE id='settlement'`),
  /chiliz_fee_already_reserved/);
  db.exec("ROLLBACK");
  assert.deepEqual({ ...db.prepare(`SELECT j.state AS job_state,
    i.state AS intent_state,c.state AS credit_state,
    s.reward_swap_signature AS reward_signature
    FROM automation_jobs j JOIN chiliz_signed_intents i ON i.job_id=j.id
    JOIN chiliz_v2_purchase_credits c ON c.job_id=j.id
    JOIN settlements s ON s.id=c.settlement_id`).get() }, {
    job_state: "broadcasting", intent_state: "broadcast_attempted",
    credit_state: "broadcast_unknown", reward_signature: null,
  });
  db.close();
});
