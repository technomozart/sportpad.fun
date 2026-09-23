import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "buffer";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type SignatureStatus,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import bs58 from "bs58";

import {
  inspectPreparedAutomaticBuybackOrder,
  verifyPersistedAutomaticBuybackIntent,
  verifyPersistedAutomaticRewardChunkIntent,
  verifyPersistedAutomaticRewardIntent,
  type PersistedAutomaticBuybackIntent,
} from "./buyback-intent-proof.ts";
import type { SolanaAutomationReceipt } from "./automation-receipt.ts";

const METIS = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

async function fixture() {
  const treasuryKeypair = Keypair.generate();
  const treasury = treasuryKeypair.publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const settlementId = "settlement-1";
  const message = new TransactionMessage({
    payerKey: treasuryKeypair.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      SystemProgram.transfer({ fromPubkey: treasuryKeypair.publicKey,
        toPubkey: Keypair.generate().publicKey, lamports: 50_000_000 }),
      new TransactionInstruction({ programId: METIS,
        keys: [{ pubkey: treasuryKeypair.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([1, 2, 3]) }),
    ],
  }).compileToV0Message();
  const unsigned = new VersionedTransaction(message);
  const unsignedTransactionBase64 = Buffer.from(unsigned.serialize()).toString("base64");
  const signed = VersionedTransaction.deserialize(Buffer.from(unsignedTransactionBase64, "base64"));
  signed.sign([treasuryKeypair]);
  const signedTransactionBase64 = Buffer.from(signed.serialize()).toString("base64");
  const prepared = await inspectPreparedAutomaticBuybackOrder({
    unsignedTransactionBase64, signedTransactionBase64, treasury,
  });
  const expected = {
    settlementId, treasury, sportpadMint: mint, inputAmountLamports: "50000000",
    purchasedAmountAtomic: "995000", swapSignature: prepared.txSignature,
  };
  const intent: PersistedAutomaticBuybackIntent = {
    idempotency_key: `automation:buyback:swap:${settlementId}`,
    settlement_id: settlementId,
    signer_role: "buyback_treasury",
    signer_address: treasury,
    action: "sportpad_buyback_automation",
    state: "prepared",
    provider_request_id: "jupiter-order-123",
    unsigned_transaction_base64: unsignedTransactionBase64,
    transaction_message_hash: prepared.transactionMessageHash,
    tx_signature: prepared.txSignature,
    input_mint: NATIVE_MINT.toBase58(),
    output_mint: mint,
    input_amount_atomic: expected.inputAmountLamports,
    minimum_output_atomic: "990000",
    maximum_spend_lamports: expected.inputAmountLamports,
    expected_mints_json: JSON.stringify([NATIVE_MINT.toBase58(), mint]),
    expected_programs_json: JSON.stringify(["jupiter_v2_metis_pinned"]),
  };
  const swapReceipt = {
    slot: 501,
    transaction: { signatures: [prepared.txSignature], message },
    meta: { err: null },
  } as unknown as SolanaAutomationReceipt;
  const swapStatus = { slot: 501, err: null, confirmations: null, confirmationStatus: "finalized" } as SignatureStatus;
  return { treasuryKeypair, unsignedTransactionBase64, signedTransactionBase64,
    expected, intent, swapReceipt, swapStatus };
}

test("binds a finalized swap to one persisted signed Jupiter message", async () => {
  const input = await fixture();
  const proof = await verifyPersistedAutomaticBuybackIntent(input);
  assert.equal(proof.txSignature, input.expected.swapSignature);
  assert.equal(proof.providerRequestId, "jupiter-order-123");
});

test("binds a Solana reward purchase to its own persisted signer and mint", async () => {
  const input = await fixture();
  const reward = {
    ...input,
    expected: { settlementId: input.expected.settlementId, treasury: input.expected.treasury,
      rewardMint: input.expected.sportpadMint, inputAmountLamports: input.expected.inputAmountLamports,
      purchasedAmountAtomic: input.expected.purchasedAmountAtomic, swapSignature: input.expected.swapSignature },
    intent: { ...input.intent,
      idempotency_key: `automation:reward:swap:${input.expected.settlementId}`,
      signer_role: "reward_treasury", action: "solana_reward_purchase_automation" },
  };
  const proof = await verifyPersistedAutomaticRewardIntent(reward);
  assert.equal(proof.txSignature, reward.expected.swapSignature);
  await assert.rejects(verifyPersistedAutomaticRewardIntent({ ...reward,
    intent: { ...reward.intent, signer_role: "buyback_treasury" },
  }), /job_identity_mismatch/);
  await assert.rejects(verifyPersistedAutomaticRewardIntent({ ...reward,
    expected: { ...reward.expected, rewardMint: Keypair.generate().publicKey.toBase58() },
  }), /swap_terms_mismatch/);
});

test("a reward chunk proof binds the step ID as well as its parent settlement", async () => {
  const input = await fixture();
  const chunk = {
    ...input,
    expected: { settlementId: input.expected.settlementId, stepId: "step-1",
      treasury: input.expected.treasury, rewardMint: input.expected.sportpadMint,
      inputAmountLamports: input.expected.inputAmountLamports,
      purchasedAmountAtomic: input.expected.purchasedAmountAtomic,
      swapSignature: input.expected.swapSignature },
    intent: { ...input.intent, idempotency_key: "automation:reward:swap:step-1",
      signer_role: "reward_treasury", action: "solana_reward_purchase_automation" },
  };
  assert.equal((await verifyPersistedAutomaticRewardChunkIntent(chunk)).txSignature,
    input.expected.swapSignature);
  await assert.rejects(verifyPersistedAutomaticRewardChunkIntent({ ...chunk,
    expected: { ...chunk.expected, stepId: "step-2" },
  }), /job_identity_mismatch/);
});

test("rejects a missing pre-broadcast intent", async () => {
  const input = await fixture();
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input, intent: null }),
    /not_persisted_before_broadcast/);
});

test("rejects an intent bound to a different settlement or idempotency key", async () => {
  const input = await fixture();
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    intent: { ...input.intent, settlement_id: "another" },
  }), /job_identity_mismatch/);
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    intent: { ...input.intent, idempotency_key: "other" },
  }), /job_identity_mismatch/);
});

test("rejects a worker report that differs from the persisted order terms", async () => {
  const input = await fixture();
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    expected: { ...input.expected, inputAmountLamports: "49999999" },
  }), /swap_terms_mismatch/);
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    expected: { ...input.expected, purchasedAmountAtomic: "989999" },
  }), /output_below_persisted_minimum/);
});

test("rejects a changed or malformed persisted unsigned order", async () => {
  const input = await fixture();
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    intent: { ...input.intent, transaction_message_hash: "0".repeat(64) },
  }), /persisted_message_hash_mismatch/);
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    intent: { ...input.intent, unsigned_transaction_base64: "not_base64" },
  }), /unsigned_order_invalid|unsigned_order_encoding_invalid/);
});

test("rejects a finalized transaction with a different signed message", async () => {
  const input = await fixture();
  const unrelatedMessage = new TransactionMessage({
    payerKey: input.treasuryKeypair.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [],
  }).compileToV0Message();
  const swapReceipt = { ...input.swapReceipt,
    transaction: { ...input.swapReceipt.transaction, message: unrelatedMessage } } as SolanaAutomationReceipt;
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input, swapReceipt }),
    /onchain_message_mismatch/);
});

test("rejects a signature mismatch, failed status, or unfinalized receipt", async () => {
  const input = await fixture();
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    intent: { ...input.intent, tx_signature: bs58.encode(Uint8Array.from({ length: 64 }, () => 9)) },
  }), /finalized_signature_mismatch/);
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    swapStatus: { ...input.swapStatus, confirmationStatus: "confirmed" },
  }), /finalized_signature_mismatch/);
  await assert.rejects(verifyPersistedAutomaticBuybackIntent({ ...input,
    swapStatus: { ...input.swapStatus, err: { InstructionError: [0, "InvalidArgument"] } },
  }), /finalized_signature_mismatch/);
});

test("rejects a signed transaction whose message differs from the saved order", async () => {
  const input = await fixture();
  const wrongMessage = new TransactionMessage({ payerKey: input.treasuryKeypair.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [] }).compileToV0Message();
  const signed = new VersionedTransaction(wrongMessage);
  signed.sign([input.treasuryKeypair]);
  await assert.rejects(inspectPreparedAutomaticBuybackOrder({
    unsignedTransactionBase64: input.unsignedTransactionBase64,
    signedTransactionBase64: Buffer.from(signed.serialize()).toString("base64"),
    treasury: input.treasuryKeypair.publicKey.toBase58(),
  }), /signed_message_mismatch/);
});
