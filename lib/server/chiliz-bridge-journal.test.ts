import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Keypair, SystemProgram, TransactionMessage,
  VersionedTransaction } from "@solana/web3.js";
import { ARM_CHILIZ_BRIDGE_POLICY_SQL,
  PAUSE_CHILIZ_BRIDGE_POLICY_SQL, INSERT_PAUSED_CHILIZ_BRIDGE_POLICY_SQL,
  INSERT_PREPARED_CHILIZ_BRIDGE_SQL, RESERVE_CHILIZ_BRIDGE_POLICY_SQL,
  SELECT_CHILIZ_BRIDGE_SQL, MARK_CHILIZ_BRIDGE_BROADCAST_SQL,
  HOLD_CHILIZ_BRIDGE_SQL, FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL,
  FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL, chilizBridgeJournalInsertBindings,
  createChilizBridgeJournalInsert } from "./chiliz-bridge-journal.ts";

const source = Keypair.generate();
const destination = "0x42c40359da463b480c3dc9e7a4d9c1ac2ef45c21";
const sourceAmount = "100000000"; // 1 CHZ, eight source decimals
const minimumDestination = "990000000000000000";
const nowMs = 1_800_000_000_000;

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(readFileSync(new URL("../../drizzle/0024_freezing_black_crow.sql",
    import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  return db;
}

function quoteResponse() {
  return { quotes: [{ id: "quote-verified-1", srcAmount: sourceAmount,
    dstAmount: "995000000000000000", dstAmountMin: minimumDestination,
    feePercent: "1", expiresAt: new Date(nowMs + 90_000).toISOString(),
    routeSteps: [{ type: "OFT_V2", srcChainKey: "solana" }] }] };
}

function signedTransaction(keypair = source) {
  // These harmless instruction bytes prove signature parsing, not a LayerZero
  // bridge route. The future execution verifier must reject such a message.
  const message = new TransactionMessage({ payerKey: keypair.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: keypair.publicKey,
      toPubkey: keypair.publicKey, lamports: 1 })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
}

async function intent() {
  return createChilizBridgeJournalInsert({ id: "bridge_1",
    sourceWallet: source.publicKey.toBase58(), destinationTreasury: destination,
    expectedSourceAmountAtomic: sourceAmount,
    quoteResponse: quoteResponse(), signedTransactionBase64: signedTransaction(), nowMs });
}

function arm(db: DatabaseSync) {
  assert.equal(db.prepare(INSERT_PAUSED_CHILIZ_BRIDGE_POLICY_SQL)
    .run(source.publicKey.toBase58(), destination, "1000000000").changes, 1);
  assert.equal(db.prepare(ARM_CHILIZ_BRIDGE_POLICY_SQL).run().changes, 1);
}

test("signed Solana bytes, fee payer and fresh bounded quote are validated", async () => {
  const prepared = await intent();
  assert.equal(prepared.sourceWallet, source.publicKey.toBase58());
  assert.equal(prepared.destinationTreasury, destination);
  assert.equal(prepared.sourceAmountAtomic, sourceAmount);
  assert.equal(prepared.minimumDestinationWei, minimumDestination);
  assert.equal(prepared.signedTransactionSha256.length, 64);
  assert.ok(prepared.sourceSignature.length >= 64);
  await assert.rejects(() => createChilizBridgeJournalInsert({ id: "bridge_1",
    sourceWallet: source.publicKey.toBase58(), destinationTreasury: destination,
    expectedSourceAmountAtomic: sourceAmount, quoteResponse: quoteResponse(),
    signedTransactionBase64: signedTransaction(Keypair.generate()), nowMs }),
  /bridge_source_signature_invalid/);
  await assert.rejects(() => createChilizBridgeJournalInsert({ id: "bridge_1",
    sourceWallet: source.publicKey.toBase58(), destinationTreasury: destination,
    expectedSourceAmountAtomic: sourceAmount, quoteResponse: quoteResponse(),
    signedTransactionBase64: signedTransaction(), nowMs: nowMs + 120_000 }),
  /expiry/);
  const redirected = { quotes: [{ ...quoteResponse().quotes[0],
    dstWalletAddress: "0x1111111111111111111111111111111111111111" }] };
  await assert.rejects(() => createChilizBridgeJournalInsert({ id: "bridge_1",
    sourceWallet: source.publicKey.toBase58(), destinationTreasury: destination,
    expectedSourceAmountAtomic: sourceAmount, quoteResponse: redirected,
    signedTransactionBase64: signedTransaction(), nowMs }),
  /bridge_quote_dstWalletAddress_mismatch/);
});

test("one-shot policy, exact addresses, amount cap, quote and signed bytes are frozen", async () => {
  const db = fixture();
  try {
    const prepared = await intent();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chiliz_bridge_policy").get()?.n, 0);
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .run(...chilizBridgeJournalInsertBindings(prepared)).changes, 0);
    assert.throws(() => db.prepare(INSERT_PAUSED_CHILIZ_BRIDGE_POLICY_SQL)
      .run(prepared.sourceWallet, destination, "1000000001"), /CHECK constraint failed/);
    arm(db);
    const mismatch = { ...prepared, destinationTreasury:
      "0x1111111111111111111111111111111111111111" };
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .run(...chilizBridgeJournalInsertBindings(mismatch)).changes, 0);
    const excess = { ...prepared, sourceAmountAtomic: "1000000001" };
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .run(...chilizBridgeJournalInsertBindings(excess)).changes, 0);
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .run(...chilizBridgeJournalInsertBindings(prepared)).changes, 1);
    assert.equal(db.prepare(RESERVE_CHILIZ_BRIDGE_POLICY_SQL)
      .run(prepared.id).changes, 1);
    assert.equal(db.prepare(RESERVE_CHILIZ_BRIDGE_POLICY_SQL)
      .run(prepared.id).changes, 0);
    assert.equal(db.prepare(ARM_CHILIZ_BRIDGE_POLICY_SQL).run().changes, 0);
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .run(...chilizBridgeJournalInsertBindings(prepared)).changes, 0);
    assert.throws(() => db.exec("UPDATE chiliz_bridge_journal SET quote_id='replacement'"),
      /chiliz_bridge_intent_immutable/);
    assert.throws(() => db.exec("UPDATE chiliz_bridge_journal SET signed_transaction_base64='x'"),
      /chiliz_bridge_intent_immutable/);
    assert.throws(() => db.exec("DELETE FROM chiliz_bridge_journal"), /chiliz_bridge_no_delete/);
    assert.throws(() => db.exec("UPDATE chiliz_bridge_policy SET reserved_bridge_id=NULL"),
      /chiliz_bridge_policy_reservation_immutable/);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});

test("broadcast is a one-way marker; ambiguity remains held without a new send", async () => {
  const db = fixture();
  try {
    const prepared = await intent();
    arm(db);
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .run(...chilizBridgeJournalInsertBindings(prepared)).changes, 1);
    assert.equal(db.prepare(RESERVE_CHILIZ_BRIDGE_POLICY_SQL).run(prepared.id).changes, 1);
    assert.equal(db.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs + 100_000).changes, 0);
    assert.equal(db.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs).changes, 1);
    assert.equal(db.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs).changes, 0);
    assert.equal(db.prepare(HOLD_CHILIZ_BRIDGE_SQL)
      .run(prepared.id, prepared.sourceSignature).changes, 1);
    assert.equal(db.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs).changes, 0);
    assert.throws(() => db.exec("UPDATE chiliz_bridge_journal SET state='prepared'"),
      /chiliz_bridge_state_(transition|shape)/);
    assert.equal(db.prepare(PAUSE_CHILIZ_BRIDGE_POLICY_SQL).run().changes, 1);
    assert.equal(db.prepare(ARM_CHILIZ_BRIDGE_POLICY_SQL).run().changes, 0);
    assert.equal(db.prepare(SELECT_CHILIZ_BRIDGE_SQL).get(prepared.id), undefined);
  } finally { db.close(); }
});

test("only matching source and destination proofs progress a held transaction", async () => {
  const db = fixture();
  try {
    const prepared = await intent();
    arm(db);
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL)
      .run(...chilizBridgeJournalInsertBindings(prepared)).changes, 1);
    assert.equal(db.prepare(RESERVE_CHILIZ_BRIDGE_POLICY_SQL).run(prepared.id).changes, 1);
    assert.equal(db.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .run(prepared.id, prepared.sourceSignature, nowMs).changes, 1);
    assert.equal(db.prepare(HOLD_CHILIZ_BRIDGE_SQL)
      .run(prepared.id, prepared.sourceSignature).changes, 1);
    const messageId = "lz-message-1";
    const sourceProof = JSON.stringify({ finalized: true,
      sourceSignature: prepared.sourceSignature, sourceWallet: prepared.sourceWallet,
      quoteId: prepared.quoteId, sourceAmountAtomic: prepared.sourceAmountAtomic,
      signedTransactionSha256: prepared.signedTransactionSha256,
      finalizedSlot: 1234, bridgeMessageId: messageId });
    assert.equal(db.prepare(FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL)
      .run(prepared.id, "wrong-signature", 1234, sourceProof, messageId).changes, 0);
    assert.equal(db.prepare(FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL)
      .run(prepared.id, prepared.sourceSignature, 1234,
        `${sourceProof.slice(0, -1)},"sourceWallet":"wrong"}`, messageId).changes, 0);
    assert.equal(db.prepare(FINALIZE_CHILIZ_BRIDGE_SOURCE_SQL)
      .run(prepared.id, prepared.sourceSignature, 1234, sourceProof, messageId).changes, 1);
    const txHash = `0x${"a".repeat(64)}`;
    const destinationProof = JSON.stringify({ finalized: true, chainId: 88888,
      bridgeMessageId: messageId, destinationTreasury: destination,
      destinationAsset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      transactionHash: txHash, finalizedBlock: 9000,
      receivedWei: minimumDestination });
    assert.equal(db.prepare(FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL)
      .run(prepared.id, messageId, txHash, 9000,
        "980000000000000000", destinationProof).changes, 0);
    assert.equal(db.prepare(FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL)
      .run(prepared.id, messageId, txHash, 9000,
        minimumDestination,
        `${destinationProof.slice(0, -1)},"destinationTreasury":"0x1111111111111111111111111111111111111111"}`).changes, 0);
    assert.equal(db.prepare(FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL)
      .run(prepared.id, messageId, txHash, 9000,
        minimumDestination, destinationProof).changes, 1);
    assert.equal(db.prepare(FINALIZE_CHILIZ_BRIDGE_DESTINATION_SQL)
      .run(prepared.id, messageId, txHash, 9000,
        minimumDestination, destinationProof).changes, 0);
    assert.equal(db.prepare(SELECT_CHILIZ_BRIDGE_SQL)
      .get(prepared.id)?.state, "destination_finalized");
  } finally { db.close(); }
});
