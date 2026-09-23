import assert from "node:assert/strict";
import test from "node:test";

import { createTransferCheckedInstruction, getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction,
  type SignatureStatus } from "@solana/web3.js";
import bs58 from "bs58";

import type { SolanaAutomationReceipt } from "./automation-receipt.ts";
import { inspectPreparedAutomaticClaimPayout,
  verifyPersistedAutomaticClaimIntent } from "./claim-intent-proof.ts";

function fixture() {
  const signer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;
  const source = getAssociatedTokenAddressSync(mint, signer.publicKey);
  const destination = getAssociatedTokenAddressSync(mint, recipient);
  const transaction = new Transaction({ feePayer: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(
    createTransferCheckedInstruction(source, mint, destination,
      signer.publicKey, 100n, 6),
  );
  transaction.sign(signer);
  const signature = bs58.encode(transaction.signature!);
  const terms = { treasury: signer.publicKey.toBase58(), mint: mint.toBase58(),
    recipient: recipient.toBase58(), amountAtomic: "100", decimals: 6,
    tokenProgram: TOKEN_PROGRAM_ID.toBase58() };
  return { signer, mint, recipient, transaction, signature, terms };
}

test("signed claim is bound to one destination and one amount", async () => {
  const { signer, transaction, signature, terms } = fixture();
  const signed = Buffer.from(transaction.serialize()).toString("base64");
  const prepared = await inspectPreparedAutomaticClaimPayout(signed, terms);
  assert.equal(prepared.txSignature, signature);
  await assert.rejects(inspectPreparedAutomaticClaimPayout(signed,
    { ...terms, recipient: Keypair.generate().publicKey.toBase58() }), /claim_intent_message_mismatch/);
  const changed = Transaction.from(transaction.serialize());
  changed.add(SystemProgram.transfer({ fromPubkey: signer.publicKey,
    toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  changed.sign(signer);
  await assert.rejects(inspectPreparedAutomaticClaimPayout(Buffer.from(changed.serialize()).toString("base64"), terms),
    /claim_intent_message_mismatch/);
});

test("completion requires the persisted claim signature and finalized on-chain message", async () => {
  const { transaction, signature, terms } = fixture();
  const signed = Buffer.from(transaction.serialize()).toString("base64");
  const prepared = await inspectPreparedAutomaticClaimPayout(signed, terms);
  const expected = { ...terms, claimId: "claim-1", jobId: "job-1", attempt: 2,
    signature };
  const intent = {
    idempotency_key: "automation:claim:payout:job-1:2", claim_id: "claim-1",
    signer_role: "reward_treasury", signer_address: terms.treasury,
    action: "solana_claim_payout_automation", state: "prepared",
    expected_programs_json: JSON.stringify([terms.tokenProgram]),
    expected_mints_json: JSON.stringify([terms.mint]),
    maximum_spend_lamports: "500000", provider_request_id: transaction.recentBlockhash!,
    unsigned_transaction_base64: signed, transaction_message_hash: prepared.transactionMessageHash,
    last_valid_block_height: 1234, input_mint: terms.mint,
    claim_history_anchor_signature: "finalized-prior-source-transfer",
    input_amount_atomic: "100", tx_signature: signature,
  };
  const receipt = { slot: 42, transaction: { signatures: [signature],
    message: transaction.compileMessage() }, meta: { err: null } } as unknown as SolanaAutomationReceipt;
  const status = { slot: 42, err: null, confirmationStatus: "finalized" } as SignatureStatus;
  assert.equal((await verifyPersistedAutomaticClaimIntent({ intent, expected, receipt, status })).txSignature,
    signature);
  await assert.rejects(verifyPersistedAutomaticClaimIntent({ intent, expected, receipt,
    status: { ...status, confirmationStatus: "confirmed" } }), /claim_intent_finalized_receipt_mismatch/);
  await assert.rejects(verifyPersistedAutomaticClaimIntent({ intent: { ...intent,
    tx_signature: Keypair.generate().publicKey.toBase58() }, expected, receipt, status }),
    /claim_intent_job_identity_mismatch/);
});
