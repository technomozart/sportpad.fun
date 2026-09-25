import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import { verifyFinalizedSolToChzSwapReceipt } from "./jupiter-sol-chz-receipt.ts";
import {
  verifyCanarySignedIntent, type CanaryOperation, type CanarySignedInput,
  type VerifiedCanaryIntent,
} from "./chiliz-sol-chz-canary-intent.ts";
import type { SignedSolanaPlan } from "./chiliz-solana-signing.ts";
import type { UnsignedSolToChzPlan } from "./jupiter-sol-chz-plan.ts";

type D1 = Pick<D1Database, "prepare">;
type Row = VerifiedCanaryIntent & {
  readonly signedPlanJson: string;
  readonly state: string;
  readonly broadcastAttemptedAtMs: number | null;
  readonly finalizedSlot: number | null;
  readonly actualOutputAtomic: string | null;
};
const CHZ_MINT = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);

function fail(code: string): never { throw new Error(`chz_canary_journal_${code}`); }
function id(operation: CanaryOperation): string { return `sportpad-chz-canary:${operation}`; }
function isOperation(value: unknown): value is CanaryOperation {
  return value === "ata_setup" || value === "sol_chz_swap";
}
function rowFromDb(raw: Record<string, unknown> | null): Row | null {
  if (!raw) return null;
  return {
    id: String(raw.id), operation: raw.operation as CanaryOperation,
    sourceWallet: String(raw.source_wallet), outputAta: String(raw.output_ata),
    inputLamports: Number(raw.input_lamports),
    maximumSpendLamports: Number(raw.maximum_spend_lamports),
    minimumOutputAtomic: String(raw.minimum_output_atomic),
    providerRequestId: raw.provider_request_id === null ? null : String(raw.provider_request_id),
    lastValidBlockHeight: Number(raw.last_valid_block_height),
    unsignedTransactionBase64: String(raw.unsigned_transaction_base64),
    signedTransactionBase64: String(raw.signed_transaction_base64),
    signedPlanJson: String(raw.signed_plan_json),
    signedTransactionSha256: String(raw.signed_transaction_sha256),
    transactionMessageHash: String(raw.transaction_message_hash),
    sourceSignature: String(raw.source_signature),
    state: String(raw.state),
    broadcastAttemptedAtMs: raw.broadcast_attempted_at_ms === null ? null : Number(raw.broadcast_attempted_at_ms),
    finalizedSlot: raw.finalized_slot === null ? null : Number(raw.finalized_slot),
    actualOutputAtomic: raw.actual_output_atomic === null ? null : String(raw.actual_output_atomic),
  };
}
async function read(db: D1, operation: CanaryOperation): Promise<Row | null> {
  const raw = await db.prepare(
    "SELECT * FROM chiliz_sol_chz_canary_journal WHERE id = ? LIMIT 1",
  ).bind(id(operation)).first<Record<string, unknown>>();
  return rowFromDb(raw);
}

/** Durable insert only. The DB trigger enforces one operation each and an
 * aggregate 5m-lamport authorization ceiling, even across worker restarts. */
export async function prepareCanaryJournal(input: {
  db: D1;
  connection: Connection;
  configuredRewardTreasury: string;
  request: CanarySignedInput;
}): Promise<{ operation: CanaryOperation; signature: string; state: "prepared" }> {
  if (!isOperation(input.request.operation)) fail("operation_invalid");
  const verified = await verifyCanarySignedIntent({
    configuredRewardTreasury: input.configuredRewardTreasury,
    operation: input.request.operation,
    signed: input.request.signed,
    connection: input.connection,
  });
  const signedPlanJson = JSON.stringify(input.request.signed);
  if (signedPlanJson.length > 20_000) fail("signed_plan_too_large");
  await input.db.prepare(`INSERT INTO chiliz_sol_chz_canary_journal (
    id, operation, source_wallet, output_ata, input_lamports,
    maximum_spend_lamports, minimum_output_atomic, provider_request_id,
    last_valid_block_height, unsigned_transaction_base64,
    signed_transaction_base64, signed_plan_json, signed_transaction_sha256,
    transaction_message_hash, source_signature, state
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared')`).bind(
    verified.id, verified.operation, verified.sourceWallet, verified.outputAta,
    verified.inputLamports, verified.maximumSpendLamports,
    verified.minimumOutputAtomic, verified.providerRequestId,
    verified.lastValidBlockHeight, verified.unsignedTransactionBase64,
    verified.signedTransactionBase64, signedPlanJson,
    verified.signedTransactionSha256, verified.transactionMessageHash,
    verified.sourceSignature,
  ).run();
  const persisted = await read(input.db, verified.operation);
  if (!persisted || persisted.state !== "prepared" ||
      persisted.sourceSignature !== verified.sourceSignature ||
      persisted.signedTransactionSha256 !== verified.signedTransactionSha256) {
    fail("durable_insert_not_confirmed");
  }
  return { operation: verified.operation, signature: verified.sourceSignature,
    state: "prepared" };
}

/** Commit `broadcast_unknown` before returning the exact persisted signed
 * bytes. The caller gets one send attempt, no automatic replay. */
export async function claimCanaryBroadcast(input: {
  db: D1;
  connection: Pick<Connection, "getBlockHeight">;
  operation: CanaryOperation;
  signature: string;
}): Promise<{ signedTransactionBase64: string; sourceSignature: string; state: "broadcast_unknown" }> {
  const prior = await read(input.db, input.operation);
  if (!prior || prior.state !== "prepared" || prior.sourceSignature !== input.signature) {
    fail("claim_not_prepared");
  }
  const height = await input.connection.getBlockHeight("finalized");
  if (!Number.isSafeInteger(height) || height >= prior.lastValidBlockHeight) fail("blockhash_expired");
  const result = await input.db.prepare(`UPDATE chiliz_sol_chz_canary_journal
    SET state = 'broadcast_unknown', broadcast_attempted_at_ms = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND state = 'prepared' AND source_signature = ?
      AND broadcast_attempted_at_ms IS NULL`).bind(
    Date.now(), prior.id, prior.sourceSignature,
  ).run();
  if (result.meta.changes !== 1) fail("claim_conflict_or_unknown");
  const persisted = await read(input.db, input.operation);
  if (!persisted || persisted.state !== "broadcast_unknown" ||
      persisted.sourceSignature !== prior.sourceSignature ||
      persisted.signedTransactionBase64 !== prior.signedTransactionBase64) {
    fail("broadcast_state_not_durable");
  }
  return { signedTransactionBase64: persisted.signedTransactionBase64,
    sourceSignature: persisted.sourceSignature, state: "broadcast_unknown" };
}

async function verifyFinalizedAta(row: Row, connection: Connection) {
  const [status, receipt] = await Promise.all([
    connection.getSignatureStatuses([row.sourceSignature], { searchTransactionHistory: true }),
    connection.getTransaction(row.sourceSignature,
      { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
  ]);
  const state = status.value[0];
  if (!state || state.confirmationStatus !== "finalized" || state.err !== null ||
      !receipt || receipt.version !== 0 || !receipt.meta || receipt.meta.err !== null ||
      receipt.slot !== state.slot || receipt.transaction.signatures.length !== 1 ||
      receipt.transaction.signatures[0] !== row.sourceSignature) fail("ata_not_finalized");
  const signed = VersionedTransaction.deserialize(Buffer.from(row.signedTransactionBase64, "base64"));
  if (!Buffer.from(receipt.transaction.message.serialize()).equals(
      Buffer.from(signed.message.serialize())) ||
      receipt.meta.preBalances.length !== receipt.meta.postBalances.length ||
      receipt.meta.preBalances[0] === undefined || receipt.meta.postBalances[0] === undefined) {
    fail("ata_finalized_message_or_balances_invalid");
  }
  const debit = receipt.meta.preBalances[0] - receipt.meta.postBalances[0];
  if (!Number.isSafeInteger(debit) || debit < 0 || debit > row.maximumSpendLamports ||
      !Number.isSafeInteger(receipt.meta.fee) || receipt.meta.fee <= 0 ||
      receipt.meta.fee > 50_000 || debit < receipt.meta.fee) fail("ata_spend_out_of_bounds");
  const source = new PublicKey(row.sourceWallet);
  const ata = getAssociatedTokenAddressSync(CHZ_MINT, source, false, TOKEN_PROGRAM_ID);
  if (ata.toBase58() !== row.outputAta) fail("ata_address_mismatch");
  const account = await connection.getAccountInfo(ata, "finalized");
  if (!account || !account.owner.equals(TOKEN_PROGRAM_ID)) fail("ata_not_initialized");
  const unpacked = unpackAccount(ata, account, TOKEN_PROGRAM_ID);
  if (!unpacked.isInitialized || !unpacked.owner.equals(source) ||
      !unpacked.mint.equals(CHZ_MINT)) fail("ata_identity_mismatch");
  return { signature: row.sourceSignature, slot: receipt.slot,
    operation: "ata_setup" as const, actualSpendLamports: debit,
    actualOutputAtomic: "0" };
}

/** Read the persisted plan, verify finalized chain effects, then one-way CAS.
 * A missing/uncertain receipt leaves the row `broadcast_unknown` forever. */
export async function finalizeCanaryJournal(input: {
  db: D1;
  connection: Connection;
  operation: CanaryOperation;
  signature: string;
}): Promise<{ state: "finalized_success"; signature: string; slot: number;
  actualSpendLamports: number; actualOutputAtomic: string }> {
  const row = await read(input.db, input.operation);
  if (!row || row.state !== "broadcast_unknown" || row.sourceSignature !== input.signature) {
    fail("finalization_not_broadcast_unknown");
  }
  let evidence: { signature: string; slot: number; operation: CanaryOperation;
    actualSpendLamports: number; actualOutputAtomic: string };
  if (row.operation === "ata_setup") {
    evidence = await verifyFinalizedAta(row, input.connection);
  } else {
    const signed = JSON.parse(row.signedPlanJson) as SignedSolanaPlan<UnsignedSolToChzPlan>;
    const verified = await verifyFinalizedSolToChzSwapReceipt({
      rpc: input.connection,
      signedPlan: signed,
      expected: {
        rewardTreasury: row.sourceWallet,
        reservedInputLamports: String(row.inputLamports),
        maximumSolDebitLamports: String(row.maximumSpendLamports),
        minimumChzCreditAtomic: row.minimumOutputAtomic,
        providerRequestId: row.providerRequestId ?? "",
        transactionMessageHash: row.transactionMessageHash,
        signedTransactionSha256: row.signedTransactionSha256,
        sourceSignature: row.sourceSignature,
      },
    });
    evidence = { signature: row.sourceSignature, slot: verified.finalizedSlot,
      operation: "sol_chz_swap", actualSpendLamports: Number(verified.actualSolDebitLamports),
      actualOutputAtomic: verified.actualChzCreditAtomic };
  }
  if (evidence.actualSpendLamports > row.maximumSpendLamports ||
      (row.operation === "sol_chz_swap" &&
        BigInt(evidence.actualOutputAtomic) < BigInt(row.minimumOutputAtomic))) {
    fail("receipt_exceeds_journal_bound");
  }
  const result = await input.db.prepare(`UPDATE chiliz_sol_chz_canary_journal
    SET state = 'finalized_success', finalized_slot = ?, actual_spend_lamports = ?,
      actual_output_atomic = ?, receipt_evidence_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND state = 'broadcast_unknown' AND source_signature = ?`).bind(
    evidence.slot, evidence.actualSpendLamports, evidence.actualOutputAtomic,
    JSON.stringify(evidence), row.id, row.sourceSignature,
  ).run();
  if (result.meta.changes !== 1) fail("finalization_conflict");
  return { state: "finalized_success", signature: row.sourceSignature,
    slot: evidence.slot, actualSpendLamports: evidence.actualSpendLamports,
    actualOutputAtomic: evidence.actualOutputAtomic };
}

export async function inspectCanaryJournal(db: D1, operation: CanaryOperation) {
  const row = await read(db, operation);
  return row ? {
    operation: row.operation, state: row.state, signature: row.sourceSignature,
    sourceWallet: row.sourceWallet, outputAta: row.outputAta,
    inputLamports: row.inputLamports,
    maximumSpendLamports: row.maximumSpendLamports,
    minimumOutputAtomic: row.minimumOutputAtomic,
    actualOutputAtomic: row.actualOutputAtomic,
  } : null;
}
