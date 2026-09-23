import { Buffer } from "buffer";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, VersionedTransaction, type SignatureStatus } from "@solana/web3.js";

import type { SolanaAutomationReceipt } from "./automation-receipt.ts";
import { inspectPersistedPreparedRewardSwap,
  type PersistedAutomaticRewardIntent } from "./buyback-intent-proof.ts";

/** A failed Solana transaction still charges its fee payer. Keep this within
 * the same 500,000-lamport fee allowance as successful reward receipts. */
export const MAX_FAILED_REWARD_SWAP_FEE_LAMPORTS = 500_000n;
const MAX_U64 = 18_446_744_073_709_551_615n;

function reject(code: string): never {
  throw new Error(`reward_swap_failure_${code}`);
}

function outputBalance(receipt: SolanaAutomationReceipt, side: "pre" | "post",
  index: number, mint: string, treasury: string, tokenProgram: string, decimals: number) {
  const rows = side === "pre" ? receipt.meta?.preTokenBalances : receipt.meta?.postTokenBalances;
  if (!Array.isArray(rows)) reject("token_balances_unavailable");
  const matches = rows.filter((row) => row.accountIndex === index);
  if (matches.length !== 1) reject("output_balance_missing_or_ambiguous");
  const row = matches[0];
  const amount = row.uiTokenAmount?.amount;
  if (row.mint !== mint || row.owner !== treasury || row.programId !== tokenProgram ||
    row.uiTokenAmount.decimals !== decimals ||
    typeof amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(amount) ||
    BigInt(amount) > MAX_U64) reject("output_balance_identity_invalid");
  return BigInt(amount);
}

/** Proof only: the caller must perform its own atomic intent/job transition.
 * Null or incomplete finalized RPC evidence cannot authorize replacement. */
export async function proveFinalizedFailedRewardSwap(input: {
  intent: PersistedAutomaticRewardIntent | null;
  expected: {
    idempotencyKey: string; treasury: string; rewardMint: string;
    inputAmountLamports: string; tokenProgram: string; decimals: number;
    rewardBatchId?: string | null;
  };
  receipt: SolanaAutomationReceipt | null;
  status: SignatureStatus | null;
}) {
  const { expected, receipt, status } = input;
  const persisted = await inspectPersistedPreparedRewardSwap(input.intent, expected);
  if (!status || status.confirmationStatus !== "finalized" || status.err == null ||
    !receipt?.meta || receipt.meta.err == null ||
    !Number.isSafeInteger(status.slot) || status.slot <= 0 ||
    receipt.slot !== status.slot ||
    receipt.transaction.signatures.length !== 1 ||
    receipt.transaction.signatures[0] !== persisted.txSignature) {
    reject("finalized_failure_unverified");
  }
  let persistedMessage: Uint8Array;
  let chainMessage: Uint8Array;
  try {
    persistedMessage = VersionedTransaction.deserialize(
      Buffer.from(persisted.unsignedTransactionBase64, "base64")).message.serialize();
    chainMessage = receipt.transaction.message.serialize();
  } catch { return reject("message_unavailable"); }
  if (!Buffer.from(persistedMessage).equals(Buffer.from(chainMessage))) {
    reject("onchain_message_mismatch");
  }
  let treasury: PublicKey;
  let mint: PublicKey;
  let tokenProgram: PublicKey;
  try {
    treasury = new PublicKey(expected.treasury);
    mint = new PublicKey(expected.rewardMint);
    tokenProgram = new PublicKey(expected.tokenProgram);
  } catch { return reject("token_identity_invalid"); }
  if ((!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) ||
    !Number.isInteger(expected.decimals) || expected.decimals < 0 || expected.decimals > 255) {
    reject("token_identity_invalid");
  }
  const message = receipt.transaction.message as unknown as {
    staticAccountKeys?: PublicKey[]; accountKeys?: PublicKey[];
  };
  const staticKeys = message.staticAccountKeys ?? message.accountKeys;
  const loaded = receipt.meta.loadedAddresses;
  if (!Array.isArray(staticKeys) || !staticKeys[0]?.equals(treasury)) {
    reject("fee_payer_mismatch");
  }
  const keys = [...staticKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
  if (!keys.every((key) => key instanceof PublicKey)) reject("account_keys_invalid");
  const outputAta = getAssociatedTokenAddressSync(mint, treasury, false, tokenProgram);
  const outputIndices = keys.flatMap((key, index) => key.equals(outputAta) ? [index] : []);
  if (outputIndices.length !== 1) reject("output_account_missing_or_ambiguous");
  const fee = receipt.meta.fee;
  const before = receipt.meta.preBalances?.[0];
  const after = receipt.meta.postBalances?.[0];
  if (!Number.isSafeInteger(fee) || fee <= 0 || BigInt(fee) > MAX_FAILED_REWARD_SWAP_FEE_LAMPORTS ||
    !Number.isSafeInteger(before) || before < 0 ||
    !Number.isSafeInteger(after) || after < 0 ||
    BigInt(before) - BigInt(after) !== BigInt(fee)) {
    reject("fee_payer_loss_mismatch_or_unbounded");
  }
  const preOutput = outputBalance(receipt, "pre", outputIndices[0],
    mint.toBase58(), treasury.toBase58(), tokenProgram.toBase58(), expected.decimals);
  const postOutput = outputBalance(receipt, "post", outputIndices[0],
    mint.toBase58(), treasury.toBase58(), tokenProgram.toBase58(), expected.decimals);
  if (preOutput !== postOutput) reject("output_balance_changed");
  return {
    signature: persisted.txSignature,
    slot: receipt.slot,
    feeLamports: fee.toString(),
    outputTokenAccount: outputAta.toBase58(),
    outputBalanceAtomic: postOutput.toString(),
  };
}
