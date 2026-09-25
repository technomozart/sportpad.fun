import { Buffer } from "buffer";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type Account,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  type Commitment,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";

import { REPLENISHMENT_ASSETS } from "../protocol/replenishment.ts";
import { inspectSolanaChzFundingOrder } from "../protocol/replenishment-swap-inspection.ts";
import type { JupiterSwapPlan } from "./providers/jupiter-swap.ts";
import { inspectPreparedAutomaticBuybackOrder } from "./solana/buyback-intent-proof.ts";
import type { ChilizFeeReservation } from "./chiliz-fee-reservations.ts";

const MAX_INPUT_LAMPORTS = 100_000_000n;
const MAX_FEE_LAMPORTS = 500_000n;

export const INSERT_PREPARED_CHILIZ_SOL_CHZ_SWAP_SQL = `
  INSERT INTO chiliz_sol_chz_swap_journal
    (id, reservation_id, chunk_sequence, attempt_sequence, chunk_offset_lamports,
      source_wallet, input_mint, output_mint,
      output_token_program, output_ata, input_amount_lamports,
      minimum_output_atomic, provider_request_id, last_valid_block_height,
      unsigned_transaction_base64, signed_transaction_base64,
      signed_transaction_sha256, transaction_message_hash, source_signature)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
`;

/** Only a finalized block height beyond the signed blockhash validity can
 * retire an intent that was never marked for broadcast. An unknown broadcast
 * cannot use this transition and always requires exact-signature resolution. */
export const EXPIRE_UNBROADCAST_CHILIZ_SOL_CHZ_SWAP_SQL = `
  UPDATE chiliz_sol_chz_swap_journal
  SET state = 'expired_unbroadcast', expiry_finalized_block_height = ?3,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2 AND state = 'prepared'
    AND broadcast_attempted_at_ms IS NULL AND ?3 > last_valid_block_height
`;

/** This marker must commit before the first Jupiter execute or RPC send.
 * A timeout leaves one immutable signature in broadcast_unknown, not a new
 * quote/retry authorization. Bind ID, signature, observed time, block height. */
export const MARK_CHILIZ_SOL_CHZ_BROADCAST_UNKNOWN_SQL = `
  UPDATE chiliz_sol_chz_swap_journal
  SET state = 'broadcast_unknown', broadcast_attempted_at_ms = ?3,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2 AND state = 'prepared'
    AND ?3 > 0 AND ?4 > 0 AND ?4 <= last_valid_block_height
`;

/** Only the exact signed signature may resolve an ambiguous broadcast. The
 * SQL migration independently enforces the one-way transition, identities,
 * finality-evidence fields, and SOL/CHZ balance arithmetic. */
export const FINALIZE_CHILIZ_SOL_CHZ_SWAP_SQL = `
  UPDATE chiliz_sol_chz_swap_journal
  SET state = ?3, finalized_slot = ?4,
    source_balance_before_lamports = ?5, source_balance_after_lamports = ?6,
    output_balance_before_atomic = ?7, output_balance_after_atomic = ?8,
    output_amount_atomic = ?9, receipt_error_code = ?10,
    receipt_evidence_json = ?11, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND source_signature = ?2 AND state = 'broadcast_unknown'
`;

export type PreparedChilizSolChzSwap = {
  id: string;
  reservationId: string;
  chunkSequence: number;
  attemptSequence: number;
  chunkOffsetLamports: string;
  sourceWallet: string;
  inputMint: typeof REPLENISHMENT_ASSETS.solMint;
  outputMint: typeof REPLENISHMENT_ASSETS.solanaChzMint;
  outputTokenProgram: string;
  outputAta: string;
  inputAmountLamports: string;
  minimumOutputAtomic: string;
  providerRequestId: string;
  lastValidBlockHeight: number;
  unsignedTransactionBase64: string;
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  transactionMessageHash: string;
  sourceSignature: string;
};

export type PersistedChilizSolChzSwap = PreparedChilizSolChzSwap & {
  state: "prepared" | "expired_unbroadcast" | "broadcast_unknown" | "finalized_success" | "finalized_failure";
};

export type FinalizedChilizSolChzSwap = {
  state: "finalized_success" | "finalized_failure";
  slot: number;
  sourceBalanceBeforeLamports: string;
  sourceBalanceAfterLamports: string;
  outputBalanceBeforeAtomic: string;
  outputBalanceAfterAtomic: string;
  outputAmountAtomic: string;
  receiptErrorCode: string | null;
  evidenceJson: string;
};

function fail(code: string): never { throw new Error(`chiliz_sol_chz_swap_${code}`); }

async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function canonicalAmount(value: string, label: string, allowZero = false): bigint {
  if (typeof value !== "string" ||
      !(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) fail(`${label}_invalid`);
  const amount = BigInt(value);
  if (amount > 999_999_999_999_999_999n) fail(`${label}_too_large`);
  return amount;
}

export async function inspectPreparedSwapExpiry(input: {
  intent: PersistedChilizSolChzSwap;
  connection: Connection;
  readFinalizedBlockHeight?: (connection: Connection) => Promise<number>;
}) {
  if (input.intent.state !== "prepared") fail("expiry_requires_unbroadcast_intent");
  const height = await (input.readFinalizedBlockHeight ??
    ((connection: Connection) => connection.getBlockHeight("finalized")))(input.connection);
  if (!Number.isSafeInteger(height) || height <= input.intent.lastValidBlockHeight) {
    fail("expiry_not_finalized");
  }
  return height;
}

/** A snapshot for the next sequential quote. The INSERT trigger performs the
 * authoritative sum/sequence check again in the write transaction, so two
 * workers that read the same snapshot cannot reserve the same source twice. */
export async function nextChilizSolChzSwapChunk(database: D1Database,
  reservation: ChilizFeeReservation) {
  const row = await database.prepare(`
    SELECT COALESCE(SUM(CASE WHEN state = 'finalized_success' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN state = 'finalized_success'
        THEN CAST(input_amount_lamports AS INTEGER) ELSE 0 END), 0) AS total,
      COALESCE(SUM(CASE WHEN state IN ('prepared', 'broadcast_unknown') THEN 1 ELSE 0 END), 0) AS unresolved
    FROM chiliz_sol_chz_swap_journal WHERE reservation_id = ?1
  `).bind(reservation.id).first<{ completed: number; total: number; unresolved: number }>();
  if (!row || !Number.isSafeInteger(row.completed) || !Number.isSafeInteger(row.total) ||
      !Number.isSafeInteger(row.unresolved) || row.completed < 0 || row.total < 0 ||
      row.unresolved < 0) fail("chunk_ledger_invalid");
  if (row.unresolved !== 0) fail("prior_chunk_unresolved");
  const attempt = await database.prepare(`
    SELECT COALESCE(MAX(attempt_sequence) + 1, 0) AS next_attempt
    FROM chiliz_sol_chz_swap_journal
    WHERE reservation_id = ?1 AND chunk_sequence = ?2
  `).bind(reservation.id, row.completed).first<{ next_attempt: number }>();
  if (!attempt || !Number.isSafeInteger(attempt.next_attempt) ||
      attempt.next_attempt < 0) fail("attempt_ledger_invalid");
  if (attempt.next_attempt > 2) fail("retry_budget_exhausted");
  const reserved = canonicalAmount(reservation.rewardAmountLamports, "reserved_input");
  const offset = BigInt(row.total);
  if (offset > reserved) fail("chunk_allocation_exceeded");
  if (offset === reserved) return null;
  const remaining = reserved - offset;
  return {
    sequence: row.completed,
    attempt: attempt.next_attempt,
    offsetLamports: offset.toString(),
    inputLamports: (remaining < MAX_INPUT_LAMPORTS ? remaining : MAX_INPUT_LAMPORTS).toString(),
  };
}

/** Read-only checks for a pre-existing finalized CHZ ATA. First-time ATA
 * provision is a separate operation; this swap journal does not pay rent. */
export async function prepareChilizSolChzSwapIntent(input: {
  reservation: ChilizFeeReservation;
  chunk: { sequence: number; attempt: number; offsetLamports: string; inputLamports: string };
  plan: JupiterSwapPlan;
  signedTransactionBase64: string;
  tokenProgram: PublicKey;
  connection: Connection;
  readAccount?: (connection: Connection, address: PublicKey,
    commitment: Commitment, programId: PublicKey) => Promise<Account>;
}): Promise<PreparedChilizSolChzSwap> {
  const { reservation, chunk, plan, tokenProgram, connection } = input;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    fail("token_program_invalid");
  }
  const reservedLamports = canonicalAmount(reservation.rewardAmountLamports, "reserved_input");
  const inputLamports = canonicalAmount(chunk.inputLamports, "chunk_input");
  const offsetLamports = canonicalAmount(chunk.offsetLamports, "chunk_offset", true);
  canonicalAmount(plan.minimumOutputAtomic, "minimum_output");
  if (!Number.isSafeInteger(chunk.sequence) || chunk.sequence < 0 ||
      chunk.sequence > 9_999_999 || inputLamports > MAX_INPUT_LAMPORTS ||
      !Number.isSafeInteger(chunk.attempt) || chunk.attempt < 0 || chunk.attempt > 2 ||
      offsetLamports >= reservedLamports ||
      inputLamports !== (reservedLamports - offsetLamports < MAX_INPUT_LAMPORTS
        ? reservedLamports - offsetLamports : MAX_INPUT_LAMPORTS) ||
      plan.inputAmountAtomic !== chunk.inputLamports ||
      plan.inputMint !== REPLENISHMENT_ASSETS.solMint ||
      plan.outputMint !== REPLENISHMENT_ASSETS.solanaChzMint) {
    fail("reservation_order_mismatch");
  }
  const wallet = new PublicKey(reservation.rewardTreasury);
  const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
  const outputAta = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram);
  const readAccount = input.readAccount ?? getAccount;
  let account: Account;
  try { account = await readAccount(connection, outputAta, "finalized", tokenProgram); }
  catch { fail("output_ata_not_preprovisioned"); }
  if (!account.address.equals(outputAta) || !account.owner.equals(wallet) ||
      !account.mint.equals(mint) || !account.isInitialized || account.isFrozen ||
      account.delegate !== null || account.closeAuthority !== null) {
    fail("output_ata_mismatch");
  }
  // Static instruction shape is necessary but intentionally not sufficient
  // to sign/broadcast. The live worker must also resolve ALTs, inspect
  // writable account owners, and simulate the precise SOL/CHZ deltas.
  inspectSolanaChzFundingOrder(plan, wallet.toBase58());
  const verified = await inspectPreparedAutomaticBuybackOrder({
    unsignedTransactionBase64: plan.transactionBase64,
    signedTransactionBase64: input.signedTransactionBase64,
    treasury: wallet.toBase58(),
  });
  if (verified.transactionMessageHash !== plan.transactionMessageHash ||
      !Number.isSafeInteger(plan.lastValidBlockHeight) || plan.lastValidBlockHeight <= 0) {
    fail("signed_quote_mismatch");
  }
  const signedBytes = Buffer.from(input.signedTransactionBase64, "base64");
  if (signedBytes.toString("base64") !== input.signedTransactionBase64 ||
      signedBytes.length > 1232) fail("signed_transaction_encoding_invalid");
  return {
    id: `chiliz:sol-chz:${reservation.id}:${chunk.sequence}:${chunk.attempt}`,
    reservationId: reservation.id,
    chunkSequence: chunk.sequence,
    attemptSequence: chunk.attempt,
    chunkOffsetLamports: chunk.offsetLamports,
    sourceWallet: wallet.toBase58(),
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    outputTokenProgram: tokenProgram.toBase58(),
    outputAta: outputAta.toBase58(),
    inputAmountLamports: chunk.inputLamports,
    minimumOutputAtomic: plan.minimumOutputAtomic,
    providerRequestId: plan.requestId,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    unsignedTransactionBase64: plan.transactionBase64,
    signedTransactionBase64: input.signedTransactionBase64,
    signedTransactionSha256: await sha256Hex(signedBytes),
    transactionMessageHash: verified.transactionMessageHash,
    sourceSignature: verified.txSignature,
  };
}

export function preparedChilizSolChzSwapBindings(intent: PreparedChilizSolChzSwap) {
  return [intent.id, intent.reservationId, intent.chunkSequence, intent.attemptSequence,
    intent.chunkOffsetLamports,
    intent.sourceWallet, intent.inputMint,
    intent.outputMint, intent.outputTokenProgram, intent.outputAta,
    intent.inputAmountLamports, intent.minimumOutputAtomic,
    intent.providerRequestId, intent.lastValidBlockHeight,
    intent.unsignedTransactionBase64, intent.signedTransactionBase64,
    intent.signedTransactionSha256, intent.transactionMessageHash,
    intent.sourceSignature] as const;
}

function tokenAmount(entries: NonNullable<NonNullable<VersionedTransactionResponse["meta"]>["preTokenBalances"]>,
  index: number, intent: PersistedChilizSolChzSwap) {
  const row = entries.find((item) => item.accountIndex === index);
  if (!row || row.mint !== intent.outputMint || row.owner !== intent.sourceWallet ||
      !/^(0|[1-9][0-9]*)$/.test(row.uiTokenAmount.amount)) fail("output_balance_identity_mismatch");
  return canonicalAmount(row.uiTokenAmount.amount, "output_balance", true);
}

/** Inspect independently fetched finalized RPC receipt + signature status.
 * A Jupiter execute response or treasury's global balance is not sufficient.
 * This function does not fetch the receipt, move funds, or authorize a retry. */
export async function inspectFinalizedChilizSolChzSwap(input: {
  intent: PersistedChilizSolChzSwap;
  receipt: VersionedTransactionResponse | null;
  status: SignatureStatus | null;
}): Promise<FinalizedChilizSolChzSwap> {
  const { intent, receipt, status } = input;
  if (intent.state !== "broadcast_unknown" || !receipt?.meta || !status ||
      status.confirmationStatus !== "finalized" || status.slot !== receipt.slot ||
      receipt.transaction.signatures[0] !== intent.sourceSignature ||
      receipt.transaction.message.header.numRequiredSignatures !== 1 ||
      receipt.transaction.message.staticAccountKeys[0]?.toBase58() !== intent.sourceWallet ||
      await sha256Hex(receipt.transaction.message.serialize()) !== intent.transactionMessageHash) {
    fail("finality_or_identity_unverified");
  }
  const succeeded = status.err === null && receipt.meta.err === null;
  const failed = status.err !== null && receipt.meta.err !== null;
  if (!succeeded && !failed) fail("receipt_status_conflict");
  let keys;
  try {
    keys = receipt.transaction.message.getAccountKeys({
      accountKeysFromLookups: receipt.meta.loadedAddresses ?? { writable: [], readonly: [] },
    });
  } catch { fail("receipt_accounts_unavailable"); }
  const outputIndex = Array.from({ length: keys.length }, (_, index) => index)
    .find((index) => keys.get(index)?.toBase58() === intent.outputAta);
  if (outputIndex === undefined || !Array.isArray(receipt.meta.preBalances) ||
      !Array.isArray(receipt.meta.postBalances) ||
      !Array.isArray(receipt.meta.preTokenBalances) ||
      !Array.isArray(receipt.meta.postTokenBalances)) fail("receipt_balances_unavailable");
  const beforeSol = receipt.meta.preBalances[0];
  const afterSol = receipt.meta.postBalances[0];
  if (!Number.isSafeInteger(beforeSol) || !Number.isSafeInteger(afterSol) ||
      beforeSol < 0 || afterSol < 0) fail("source_balance_invalid");
  const debit = BigInt(beforeSol) - BigInt(afterSol);
  const beforeChz = tokenAmount(receipt.meta.preTokenBalances, outputIndex, intent);
  const afterChz = tokenAmount(receipt.meta.postTokenBalances, outputIndex, intent);
  const bought = afterChz - beforeChz;
  const expectedInput = canonicalAmount(intent.inputAmountLamports, "input");
  const minimum = canonicalAmount(intent.minimumOutputAtomic, "minimum_output");
  if (succeeded ? debit < expectedInput || debit > expectedInput + MAX_FEE_LAMPORTS || bought < minimum :
      debit < 0n || debit > MAX_FEE_LAMPORTS || bought !== 0n) {
    fail("finalized_balance_delta_mismatch");
  }
  const state = succeeded ? "finalized_success" : "finalized_failure";
  const receiptErrorCode = succeeded ? null : "transaction_failed";
  const evidence = {
    finalized: true,
    status: state,
    signature: intent.sourceSignature,
    slot: receipt.slot,
    sourceWallet: intent.sourceWallet,
    outputAta: intent.outputAta,
    sourceBalanceBeforeLamports: String(beforeSol),
    sourceBalanceAfterLamports: String(afterSol),
    outputBalanceBeforeAtomic: beforeChz.toString(),
    outputBalanceAfterAtomic: afterChz.toString(),
    outputAmountAtomic: bought.toString(),
    receiptErrorCode,
  };
  return {
    state,
    slot: receipt.slot,
    sourceBalanceBeforeLamports: evidence.sourceBalanceBeforeLamports,
    sourceBalanceAfterLamports: evidence.sourceBalanceAfterLamports,
    outputBalanceBeforeAtomic: evidence.outputBalanceBeforeAtomic,
    outputBalanceAfterAtomic: evidence.outputBalanceAfterAtomic,
    outputAmountAtomic: evidence.outputAmountAtomic,
    receiptErrorCode,
    evidenceJson: JSON.stringify(evidence),
  };
}

export function finalizedChilizSolChzSwapBindings(intent: PersistedChilizSolChzSwap,
  result: FinalizedChilizSolChzSwap) {
  return [intent.id, intent.sourceSignature, result.state, result.slot,
    result.sourceBalanceBeforeLamports, result.sourceBalanceAfterLamports,
    result.outputBalanceBeforeAtomic, result.outputBalanceAfterAtomic,
    result.outputAmountAtomic, result.receiptErrorCode, result.evidenceJson] as const;
}
