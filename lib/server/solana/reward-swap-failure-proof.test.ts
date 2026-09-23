import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "buffer";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction, type SignatureStatus } from "@solana/web3.js";

import type { SolanaAutomationReceipt } from "./automation-receipt.ts";
import { inspectPreparedAutomaticBuybackOrder,
  type PersistedAutomaticRewardIntent } from "./buyback-intent-proof.ts";
import { proveFinalizedFailedRewardSwap } from "./reward-swap-failure-proof.ts";

const METIS = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const BATCH_ID = "11111111-1111-4111-8111-111111111111";

async function fixture() {
  const signer = Keypair.generate();
  const treasury = signer.publicKey.toBase58();
  const mint = Keypair.generate().publicKey;
  const outputAta = getAssociatedTokenAddressSync(mint, signer.publicKey);
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [new TransactionInstruction({ programId: METIS, keys: [
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: outputAta, isSigner: false, isWritable: true },
    ], data: Buffer.from([1]) })],
  }).compileToV0Message();
  const unsignedTransactionBase64 = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
  const signed = VersionedTransaction.deserialize(Buffer.from(unsignedTransactionBase64, "base64"));
  signed.sign([signer]);
  const prepared = await inspectPreparedAutomaticBuybackOrder({
    unsignedTransactionBase64,
    signedTransactionBase64: Buffer.from(signed.serialize()).toString("base64"),
    treasury,
  });
  const intent: PersistedAutomaticRewardIntent = {
    idempotency_key: `automation:reward:batch:${BATCH_ID}`,
    settlement_id: "settlement-1",
    reward_batch_id: BATCH_ID,
    signer_role: "reward_treasury",
    signer_address: treasury,
    action: "solana_reward_purchase_automation",
    state: "prepared",
    provider_request_id: "jupiter-order-1",
    unsigned_transaction_base64: unsignedTransactionBase64,
    transaction_message_hash: prepared.transactionMessageHash,
    last_valid_block_height: 200,
    tx_signature: prepared.txSignature,
    input_mint: NATIVE_MINT.toBase58(),
    output_mint: mint.toBase58(),
    input_amount_atomic: "50000000",
    minimum_output_atomic: "1",
    maximum_spend_lamports: "50000000",
    expected_mints_json: JSON.stringify([NATIVE_MINT.toBase58(), mint.toBase58()]),
    expected_programs_json: JSON.stringify(["jupiter_v2_metis_pinned"]),
  };
  const outputIndex = message.staticAccountKeys.findIndex((key) => key.equals(outputAta));
  const tokenBalance = (amount: string) => ({
    accountIndex: outputIndex,
    mint: mint.toBase58(), owner: treasury, programId: TOKEN_PROGRAM_ID.toBase58(),
    uiTokenAmount: { amount, decimals: 6 },
  });
  const receipt = {
    slot: 501,
    transaction: { signatures: [prepared.txSignature], message },
    meta: {
      err: { InstructionError: [0, { Custom: 1 }] },
      fee: 5_000,
      preBalances: [1_000_000_000, ...Array(message.staticAccountKeys.length - 1).fill(0)],
      postBalances: [999_995_000, ...Array(message.staticAccountKeys.length - 1).fill(0)],
      preTokenBalances: [tokenBalance("100")],
      postTokenBalances: [tokenBalance("100")],
      loadedAddresses: { writable: [], readonly: [] },
    },
  } as unknown as SolanaAutomationReceipt;
  const status = { slot: 501, err: { InstructionError: [0, { Custom: 1 }] },
    confirmations: null, confirmationStatus: "finalized" } as SignatureStatus;
  return {
    intent,
    expected: { idempotencyKey: intent.idempotency_key, treasury,
      rewardMint: mint.toBase58(), inputAmountLamports: "50000000",
      rewardBatchId: BATCH_ID, tokenProgram: TOKEN_PROGRAM_ID.toBase58(), decimals: 6 },
    receipt, status, outputAta,
  };
}

test("proves a persisted failed reward swap lost only its bounded network fee", async () => {
  const input = await fixture();
  const proof = await proveFinalizedFailedRewardSwap(input);
  assert.deepEqual(proof, { signature: input.intent.tx_signature, slot: 501,
    feeLamports: "5000", outputTokenAccount: input.outputAta.toBase58(),
    outputBalanceAtomic: "100" });
});

test("requires a matching finalized failed status and failed receipt", async () => {
  const input = await fixture();
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input, status: null }), /finalized_failure_unverified/);
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    status: { ...input.status, confirmationStatus: "confirmed" } }), /finalized_failure_unverified/);
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    status: { ...input.status, err: null } }), /finalized_failure_unverified/);
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    status: { ...input.status, slot: 502 } }), /finalized_failure_unverified/);
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    receipt: { ...input.receipt, meta: { ...input.receipt.meta!, err: null } } as SolanaAutomationReceipt }),
  /finalized_failure_unverified/);
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    receipt: { ...input.receipt, transaction: { ...input.receipt.transaction,
      signatures: [Keypair.generate().publicKey.toBase58()] } } as SolanaAutomationReceipt }),
  /finalized_failure_unverified/);
});

test("binds the failed receipt to the persisted treasury-signed message", async () => {
  const input = await fixture();
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    intent: { ...input.intent, tx_signature: Keypair.generate().publicKey.toBase58() } }),
  /reward_recovery_message_mismatch/);
  const otherMessage = new TransactionMessage({ payerKey: new PublicKey(input.expected.treasury),
    recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [],
  }).compileToV0Message();
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    receipt: { ...input.receipt, transaction: { ...input.receipt.transaction,
      message: otherMessage } } as SolanaAutomationReceipt }), /onchain_message_mismatch/);
});

test("rejects unbounded or unexplained treasury lamport loss", async () => {
  const input = await fixture();
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    receipt: { ...input.receipt, meta: { ...input.receipt.meta!, fee: 500_001,
      postBalances: [999_499_999, ...input.receipt.meta!.postBalances.slice(1)] } } as SolanaAutomationReceipt }),
  /fee_payer_loss_mismatch_or_unbounded/);
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    receipt: { ...input.receipt, meta: { ...input.receipt.meta!,
      postBalances: [999_994_999, ...input.receipt.meta!.postBalances.slice(1)] } } as SolanaAutomationReceipt }),
  /fee_payer_loss_mismatch_or_unbounded/);
});

test("rejects output gain or missing output token balance evidence", async () => {
  const input = await fixture();
  const post = input.receipt.meta!.postTokenBalances![0];
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    receipt: { ...input.receipt, meta: { ...input.receipt.meta!, postTokenBalances: [
      { ...post, uiTokenAmount: { ...post.uiTokenAmount, amount: "101" } },
    ] } } as SolanaAutomationReceipt }), /output_balance_changed/);
  await assert.rejects(proveFinalizedFailedRewardSwap({ ...input,
    receipt: { ...input.receipt, meta: { ...input.receipt.meta!, postTokenBalances: [] } } as SolanaAutomationReceipt }),
  /output_balance_missing_or_ambiguous/);
});
