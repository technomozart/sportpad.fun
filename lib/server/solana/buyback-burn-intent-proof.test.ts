import assert from "node:assert/strict";
import test from "node:test";

import { createBurnCheckedInstruction, getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction, type SignatureStatus } from "@solana/web3.js";
import bs58 from "bs58";

import type { SolanaAutomationReceipt } from "./automation-receipt.ts";
import { inspectPreparedAutomaticBuybackBurn,
  verifyPersistedAutomaticBuybackBurnIntent } from "./buyback-burn-intent-proof.ts";

function fixture() {
  const signer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const source = getAssociatedTokenAddressSync(mint, signer.publicKey);
  const transaction = new Transaction({ feePayer: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(
    createBurnCheckedInstruction(source, mint, signer.publicKey, 100n, 6),
  );
  transaction.sign(signer);
  const signature = bs58.encode(transaction.signature!);
  const terms = { treasury: signer.publicKey.toBase58(), mint: mint.toBase58(),
    amountAtomic: "100", decimals: 6, tokenProgram: TOKEN_PROGRAM_ID.toBase58() };
  return { signer, mint, transaction, signature, terms };
}

test("signed buyback burn is bound to one mint and exact amount", async () => {
  const { signer, transaction, signature, terms } = fixture();
  const signed = Buffer.from(transaction.serialize()).toString("base64");
  assert.equal((await inspectPreparedAutomaticBuybackBurn(signed, terms)).txSignature, signature);
  await assert.rejects(inspectPreparedAutomaticBuybackBurn(signed,
    { ...terms, amountAtomic: "101" }), /buyback_burn_intent_message_mismatch/);
  await assert.rejects(inspectPreparedAutomaticBuybackBurn(signed,
    { ...terms, mint: Keypair.generate().publicKey.toBase58() }), /buyback_burn_intent_message_mismatch/);
  const changed = Transaction.from(transaction.serialize());
  changed.add(SystemProgram.transfer({ fromPubkey: signer.publicKey,
    toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  changed.sign(signer);
  await assert.rejects(inspectPreparedAutomaticBuybackBurn(Buffer.from(changed.serialize()).toString("base64"), terms),
    /buyback_burn_intent_message_mismatch/);
});

test("burn completion requires the persisted signature and finalized message", async () => {
  const { transaction, signature, terms } = fixture();
  const signed = Buffer.from(transaction.serialize()).toString("base64");
  const prepared = await inspectPreparedAutomaticBuybackBurn(signed, terms);
  const expected = { ...terms, settlementId: "settlement-1", signature };
  const intent = {
    idempotency_key: "automation:buyback:burn:settlement-1", settlement_id: "settlement-1",
    signer_role: "buyback_treasury", signer_address: terms.treasury,
    action: "sportpad_burn_automation", state: "prepared",
    expected_programs_json: JSON.stringify([terms.tokenProgram]),
    expected_mints_json: JSON.stringify([terms.mint]),
    maximum_spend_lamports: "500000", provider_request_id: transaction.recentBlockhash!,
    unsigned_transaction_base64: signed, transaction_message_hash: prepared.transactionMessageHash,
    last_valid_block_height: 1234, input_mint: terms.mint,
    input_amount_atomic: "100", tx_signature: signature,
  };
  const receipt = { slot: 42, transaction: { signatures: [signature],
    message: transaction.compileMessage() }, meta: { err: null } } as unknown as SolanaAutomationReceipt;
  const status = { slot: 42, err: null, confirmationStatus: "finalized" } as SignatureStatus;
  assert.equal((await verifyPersistedAutomaticBuybackBurnIntent({ intent, expected, receipt, status })).txSignature,
    signature);
  await assert.rejects(verifyPersistedAutomaticBuybackBurnIntent({ intent, expected, receipt,
    status: { ...status, confirmationStatus: "confirmed" } }), /buyback_burn_intent_finalized_receipt_mismatch/);
  await assert.rejects(verifyPersistedAutomaticBuybackBurnIntent({ intent: { ...intent,
    tx_signature: Keypair.generate().publicKey.toBase58() }, expected, receipt, status }),
  /buyback_burn_intent_job_identity_mismatch/);
});
