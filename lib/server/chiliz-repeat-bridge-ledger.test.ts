import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const treasury = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const destination = `0x${"a".repeat(40)}`;
const chzMint = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

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
  `);
  for (const migration of ["0024_freezing_black_crow", "0027_glossy_agent_zero",
    "0028_confused_epoch", "0029_living_calypso"]) {
    db.exec(readFileSync(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", ""));
  }
  return db;
}

function swap(db: DatabaseSync, suffix: string, outputAtomic: string, finalize = true) {
  const feeSignature = suffix.repeat(64);
  const eventId = `${feeSignature}:0`;
  const reservationId = `chiliz:fee:${eventId}`;
  const intentId = `chiliz:sol-chz:${reservationId}:0:0`;
  const swapSignature = `${suffix === "1" ? "3" : "4"}`.repeat(64);
  db.prepare(`INSERT INTO launch_drafts VALUES
    (?1,'chiliz',8000,2000,'mainnet_published','2026-09-25',?2,?3,99)`)
    .run(`launch-${suffix}`, `mint-${suffix}`, treasury);
  db.prepare(`INSERT INTO fee_events VALUES (?1,?2,?3,0,100,'1250000','reconciled')`)
    .run(eventId, `launch-${suffix}`, feeSignature);
  db.prepare(`INSERT INTO settlements VALUES (?1,?2,'1000000','250000','0',NULL,'reconciled')`)
    .run(`settlement:${eventId}`, eventId);
  db.prepare(`INSERT INTO chiliz_fee_reservations
    (id,fee_event_id,settlement_id,launch_id,reward_treasury,source_signature,
     source_slot,gross_amount_lamports,reward_amount_lamports)
    VALUES (?1,?2,?3,?4,?5,?6,100,'1250000','1000000')`)
    .run(reservationId, eventId, `settlement:${eventId}`, `launch-${suffix}`,
      treasury, feeSignature);
  db.prepare(`INSERT INTO chiliz_sol_chz_swap_journal
    (id,reservation_id,chunk_sequence,attempt_sequence,chunk_offset_lamports,
     source_wallet,input_mint,output_mint,output_token_program,output_ata,
     input_amount_lamports,minimum_output_atomic,provider_request_id,
     last_valid_block_height,unsigned_transaction_base64,signed_transaction_base64,
     signed_transaction_sha256,transaction_message_hash,source_signature)
    VALUES (?1,?2,0,0,'0',?3,'So11111111111111111111111111111111111111112',
      ?4,?5,?6,'1000000','1',?7,200,?8,?9,?10,?11,?12)`)
    .run(intentId, reservationId, treasury, chzMint, tokenProgram, `ata-${suffix}`,
      `quote-${suffix}`, "A".repeat(100), "B".repeat(100), suffix.repeat(64),
      "a".repeat(64), swapSignature);
  if (finalize) {
    db.prepare(`UPDATE chiliz_sol_chz_swap_journal SET state='broadcast_unknown',
      broadcast_attempted_at_ms=1000 WHERE id=?1`).run(intentId);
    const evidence = JSON.stringify({ finalized: true, status: "finalized_success",
      signature: swapSignature, slot: 200, sourceWallet: treasury,
      outputAta: `ata-${suffix}`, sourceBalanceBeforeLamports: "500000000",
      sourceBalanceAfterLamports: "498995000", outputBalanceBeforeAtomic: "0",
      outputBalanceAfterAtomic: outputAtomic, outputAmountAtomic: outputAtomic,
      receiptErrorCode: null });
    db.prepare(`UPDATE chiliz_sol_chz_swap_journal SET state='finalized_success',
      finalized_slot=200,source_balance_before_lamports='500000000',
      source_balance_after_lamports='498995000', output_balance_before_atomic='0',
      output_balance_after_atomic=?2,output_amount_atomic=?2,
      receipt_evidence_json=?3 WHERE id=?1`).run(intentId, outputAtomic, evidence);
  }
  return { intentId, reservationId, eventId, launchId: `launch-${suffix}` };
}

function transfer(db: DatabaseSync, id: string, amount: string,
  minimumWei = `${(BigInt(amount) * 99n + 99n) / 100n}0000000000`) {
  db.prepare(`INSERT INTO chiliz_bridge_transfers
    (id,source_wallet,destination_treasury,source_mint,destination_chain_id,
     source_amount_atomic,minimum_destination_wei)
    VALUES (?1,?2,?3,?4,88888,?5,?6)`)
    .run(id, treasury, destination, chzMint, amount, minimumWei);
}

function allocate(db: DatabaseSync, id: string, bridgeId: string,
  source: ReturnType<typeof swap>, offset: string, amount: string) {
  db.prepare(`INSERT INTO chiliz_bridge_allocations
    (id,bridge_id,swap_intent_id,reservation_id,fee_event_id,launch_id,
     swap_output_offset_atomic,amount_atomic)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`)
    .run(id, bridgeId, source.intentId, source.reservationId, source.eventId,
      source.launchId, offset, amount);
}

function seal(db: DatabaseSync, id: string, suffix: string) {
  db.prepare(`UPDATE chiliz_bridge_transfers SET state='prepared',
    quote_id=?2,quote_expires_at_ms=2000000,
    signed_transaction_base64=?3,signed_transaction_sha256=?4,
    source_signature=?5 WHERE id=?1`)
    .run(id, `bridge-quote-${suffix}`, "C".repeat(100), suffix.repeat(64),
      `${suffix === "a" ? "5" : suffix === "b" ? "6" : "7"}`.repeat(64));
}

test("splits a >10 CHZ swap output into repeatable 10 CHZ transfers without reuse", () => {
  const db = fixture();
  const first = swap(db, "1", "2500000000");
  const second = swap(db, "2", "500000000");
  transfer(db, "bridge-a", "1000000000");
  allocate(db, "allocation-a", "bridge-a", first, "0", "1000000000");
  seal(db, "bridge-a", "a");
  transfer(db, "bridge-b", "1000000000");
  allocate(db, "allocation-b", "bridge-b", first, "1000000000", "1000000000");
  seal(db, "bridge-b", "b");
  transfer(db, "bridge-c", "1000000000");
  allocate(db, "allocation-c1", "bridge-c", first, "2000000000", "500000000");
  allocate(db, "allocation-c2", "bridge-c", second, "0", "500000000");
  seal(db, "bridge-c", "c");
  assert.equal((db.prepare(`SELECT SUM(CAST(amount_atomic AS INTEGER)) AS n
    FROM chiliz_bridge_allocations WHERE swap_intent_id=?`).get(first.intentId) as { n: number }).n,
  2_500_000_000);
  assert.throws(() => { transfer(db, "bridge-d", "1");
    allocate(db, "allocation-d", "bridge-d", first, "2500000000", "1"); },
  /chiliz_bridge_allocation_unbacked/);
  assert.throws(() => allocate(db, "overlap", "bridge-d", second, "0", "1"),
    /chiliz_bridge_allocation_unbacked|UNIQUE constraint failed/);
  db.close();
});

test("cannot seal unbacked transfer, allocate pending output, or rewrite provenance", () => {
  const db = fixture();
  const final = swap(db, "1", "1000000000");
  const pending = swap(db, "2", "1000000000", false);
  transfer(db, "bridge-a", "1000000000");
  assert.throws(() => allocate(db, "pending", "bridge-a", pending, "0", "1000000000"),
    /chiliz_bridge_allocation_unbacked/);
  allocate(db, "partial", "bridge-a", final, "0", "500000000");
  assert.throws(() => seal(db, "bridge-a", "a"), /chiliz_bridge_transfer_invalid_transition/);
  assert.throws(() => allocate(db, "false-fee", "bridge-a",
    { ...final, eventId: pending.eventId }, "500000000", "500000000"),
  /chiliz_bridge_allocation_unbacked/);
  allocate(db, "remainder", "bridge-a", final, "500000000", "500000000");
  seal(db, "bridge-a", "a");
  assert.throws(() => db.exec("DELETE FROM chiliz_bridge_allocations"),
    /chiliz_bridge_allocation_immutable/);
  assert.throws(() => db.exec("UPDATE chiliz_bridge_allocations SET amount_atomic='1'"),
    /chiliz_bridge_allocation_immutable/);
  assert.throws(() => db.exec("UPDATE chiliz_bridge_transfers SET source_amount_atomic='1'"),
    /chiliz_bridge_transfer_identity_immutable|chiliz_bridge_transfer_invalid_transition/);
  db.close();
});

test("broadcast ambiguity is one-way and globally unique signed source identities", () => {
  const db = fixture();
  const source = swap(db, "1", "2000000000");
  transfer(db, "bridge-a", "1000000000");
  allocate(db, "allocation-a", "bridge-a", source, "0", "1000000000");
  seal(db, "bridge-a", "a");
  db.exec("UPDATE chiliz_bridge_transfers SET state='broadcast_unknown', broadcast_attempted_at_ms=1000 WHERE id='bridge-a'");
  assert.throws(() => db.exec("UPDATE chiliz_bridge_transfers SET state='prepared' WHERE id='bridge-a'"),
    /chiliz_bridge_transfer_invalid_transition/);
  transfer(db, "bridge-b", "1000000000");
  allocate(db, "allocation-b", "bridge-b", source, "1000000000", "1000000000");
  assert.throws(() => db.prepare(`UPDATE chiliz_bridge_transfers SET state='prepared',
    quote_id='another-quote',quote_expires_at_ms=2000000,
    signed_transaction_base64=?2,signed_transaction_sha256=?3,
    source_signature=?4 WHERE id=?1`).run("bridge-b", "C".repeat(100), "b".repeat(64),
      "5".repeat(64)), /UNIQUE constraint failed/);
  seal(db, "bridge-b", "b");
  db.close();
});

test("finalized source GUID and destination hash remain unique, including the 20-digit 10 CHZ denomination", () => {
  const db = fixture();
  const source = swap(db, "1", "2000000000");
  for (const [index, offset] of [["a", "0"], ["b", "1000000000"]]) {
    transfer(db, `bridge-${index}`, "1000000000", "10000000000000000000");
    allocate(db, `allocation-${index}`, `bridge-${index}`, source, offset,
      "1000000000");
    seal(db, `bridge-${index}`, index);
    db.prepare(`UPDATE chiliz_bridge_transfers SET state='broadcast_unknown',
      broadcast_attempted_at_ms=1000 WHERE id=?`).run(`bridge-${index}`);
  }
  const guid = `0x${"a".repeat(64)}`;
  const sourceProof = (signature: string, message: string) => JSON.stringify({
    finalized: true, sourceSignature: signature, sourceWallet: treasury,
    sourceAmountAtomic: "1000000000", finalizedSlot: 200,
    bridgeMessageId: message,
  });
  db.prepare(`UPDATE chiliz_bridge_transfers SET state='source_finalized',
    source_finalized_slot=200,bridge_message_id=?2,source_evidence_json=?3
    WHERE id=?1`).run("bridge-a", guid, sourceProof("5".repeat(64), guid));
  assert.throws(() => db.prepare(`UPDATE chiliz_bridge_transfers SET state='source_finalized',
    source_finalized_slot=200,bridge_message_id=?2,source_evidence_json=?3
    WHERE id=?1`).run("bridge-b", guid, sourceProof("6".repeat(64), guid)),
  /UNIQUE constraint failed/);
  const hash = `0x${"b".repeat(64)}`;
  const destinationProof = JSON.stringify({ finalized: true, chainId: 88888,
    bridgeMessageId: guid, destinationTreasury: destination, transactionHash: hash,
    finalizedBlock: 300, receivedWei: "10000000000000000000" });
  db.prepare(`UPDATE chiliz_bridge_transfers SET state='destination_finalized',
    destination_tx_hash=?2,destination_finalized_block=300,
    destination_received_wei='10000000000000000000', destination_evidence_json=?3
    WHERE id=?1`).run("bridge-a", hash, destinationProof);
  assert.equal((db.prepare("SELECT state FROM chiliz_bridge_transfers WHERE id='bridge-a'")
    .get() as { state: string }).state, "destination_finalized");
  db.close();
});

test("legacy canary cannot reuse a repeatable bridge signature", () => {
  const db = fixture();
  const source = swap(db, "1", "1000000000");
  transfer(db, "bridge-a", "1000000000");
  allocate(db, "allocation-a", "bridge-a", source, "0", "1000000000");
  seal(db, "bridge-a", "a");
  db.prepare(`INSERT INTO chiliz_bridge_policy
    (key,source_wallet,destination_treasury,max_source_amount_atomic)
    VALUES ('initial',?1,?2,'1000000000')`).run(treasury, destination);
  assert.throws(() => db.prepare(`INSERT INTO chiliz_bridge_journal
    (id,policy_key,source_chain,destination_chain_id,source_mint,
     destination_asset,source_wallet,destination_treasury,source_amount_atomic,
     minimum_destination_wei,quote_id,quote_expires_at_ms,route_type,
     signed_transaction_base64,signed_transaction_sha256,source_signature)
    VALUES ('legacy','initial','solana',88888,?1,
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',?2,?3,'1000000000',
      '1','legacy-quote',2000000,'OFT',?4,?5,?6)`)
    .run(chzMint, treasury, destination, "C".repeat(100), "d".repeat(64),
      "5".repeat(64)), /chiliz_bridge_legacy_repeat_reuse/);
  db.close();
});

test("destination minimum must be exactly scaled and 95%-100% of source CHZ", () => {
  const db = fixture();
  const invalid = [
    "1", // near-zero payout for 10 CHZ
    "9499999990000000000", // below 95%
    "9500000000000000001", // not an 8-to-18 decimal parity amount
    "10000000010000000000", // above 100%
  ];
  for (const [index, minimum] of invalid.entries()) {
    assert.throws(() => transfer(db, `bad-${index}`, "1000000000", minimum),
      /chk_chiliz_bridge_transfers_parity|CHECK constraint failed/);
  }
  transfer(db, "lower-bound", "1000000000", "9500000000000000000");
  transfer(db, "upper-bound", "1000000000", "10000000000000000000");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chiliz_bridge_transfers")
    .get() as { n: number }).n, 2);
  db.close();
});
