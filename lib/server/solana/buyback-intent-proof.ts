import { Buffer } from "buffer";
import { ed25519 } from "@noble/curves/ed25519";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey, VersionedTransaction, type SignatureStatus } from "@solana/web3.js";
import bs58 from "bs58";

import type { SolanaAutomationReceipt } from "./automation-receipt.ts";

/** A transaction_intents row persisted before the first Jupiter /execute call.
 * This is intentionally a distinct action/idempotency namespace from the
 * operator's manually signed `sportpad_buyback` intents. */
export type PersistedAutomaticBuybackIntent = {
  idempotency_key: string;
  settlement_id: string;
  reward_batch_id?: string | null;
  signer_role: string;
  signer_address: string;
  action: string;
  state: string;
  provider_request_id: string | null;
  unsigned_transaction_base64: string | null;
  transaction_message_hash: string | null;
  last_valid_block_height?: number | null;
  tx_signature: string | null;
  input_mint: string | null;
  output_mint: string | null;
  input_amount_atomic: string | null;
  minimum_output_atomic: string | null;
  maximum_spend_lamports: string;
  expected_mints_json: string;
  expected_programs_json: string;
};

export type PersistedAutomaticRewardIntent = PersistedAutomaticBuybackIntent;

type ExpectedAutomaticSwap = {
  settlementId: string;
  treasury: string;
  outputMint: string;
  inputAmountLamports: string;
  purchasedAmountAtomic: string;
  swapSignature: string;
};

const PROGRAM_POLICY = "jupiter_v2_metis_pinned";
const MAX_INPUT_LAMPORTS = 100_000_000n;

function reject(code: string): never {
  throw new Error(`buyback_intent_${code}`);
}

function positive(value: string | null, code: string) {
  if (!value || !/^[1-9][0-9]*$/.test(value)) reject(code);
  return BigInt(value);
}

function exactBase64(value: string | null) {
  if (!value || value.length > 20_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) reject("unsigned_order_missing");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) reject("unsigned_order_encoding_invalid");
  return bytes;
}

function decodeUnsignedOrder(value: string | null, signer: PublicKey) {
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(exactBase64(value)); }
  catch { return reject("unsigned_order_invalid"); }
  if (transaction.message.header.numRequiredSignatures !== 1 ||
    !transaction.message.staticAccountKeys[0]?.equals(signer) ||
    transaction.signatures.length !== 1 ||
    transaction.signatures[0].some((byte) => byte !== 0)) {
    reject("unsigned_order_signer_mismatch");
  }
  return transaction;
}

function parseExactArray(value: string, expected: string[], code: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { reject(code); }
  if (!Array.isArray(parsed) || parsed.length !== expected.length ||
    parsed.some((entry, index) => entry !== expected[index])) reject(code);
}

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Before /execute: ensure the zero-signature Jupiter order is the exact
 * message that the dedicated treasury signed. Persist the returned signature
 * and hash atomically with the order and request ID before broadcasting. */
export async function inspectPreparedAutomaticBuybackOrder({
  unsignedTransactionBase64,
  signedTransactionBase64,
  treasury,
}: {
  unsignedTransactionBase64: string;
  signedTransactionBase64: string;
  treasury: string;
}) {
  let signer: PublicKey;
  try { signer = new PublicKey(treasury); } catch { return reject("treasury_invalid"); }
  const unsigned = decodeUnsignedOrder(unsignedTransactionBase64, signer);
  let signed: VersionedTransaction;
  try { signed = VersionedTransaction.deserialize(exactBase64(signedTransactionBase64)); }
  catch { return reject("signed_order_invalid"); }
  const message = unsigned.message.serialize();
  if (!Buffer.from(signed.message.serialize()).equals(Buffer.from(message))) reject("signed_message_mismatch");
  const signature = signed.signatures[0];
  if (!signature || signature.every((byte) => byte === 0) ||
    !ed25519.verify(signature, message, signer.toBytes())) reject("treasury_signature_invalid");
  return { transactionMessageHash: await sha256Hex(message), txSignature: bs58.encode(signature) };
}

/** Recover the *same* prepared swap before its blockhash expires. This never
 * authorizes a new quote or signature; the worker must reproduce this exact
 * signed message and Jupiter request ID. */
export async function inspectPersistedPreparedBuybackSwap(intent: PersistedAutomaticBuybackIntent | null,
  expected: { settlementId: string; stepId: string; treasury: string;
    sportpadMint: string; inputAmountLamports: string }) {
  if (!intent || intent.idempotency_key !== `automation:buyback:swap:${expected.stepId}` ||
    intent.settlement_id !== expected.settlementId || intent.signer_role !== "buyback_treasury" ||
    intent.signer_address !== expected.treasury || intent.action !== "sportpad_buyback_automation" ||
    intent.state !== "prepared" || intent.input_mint !== NATIVE_MINT.toBase58() ||
    intent.output_mint !== expected.sportpadMint ||
    intent.input_amount_atomic !== expected.inputAmountLamports ||
    intent.maximum_spend_lamports !== expected.inputAmountLamports ||
    !intent.provider_request_id || !/^[\x21-\x7e]{1,200}$/.test(intent.provider_request_id) ||
    !Number.isSafeInteger(intent.last_valid_block_height) ||
    (intent.last_valid_block_height ?? 0) <= 0) reject("recovery_identity_mismatch");
  parseExactArray(intent.expected_mints_json,
    [NATIVE_MINT.toBase58(), expected.sportpadMint], "recovery_mints_mismatch");
  parseExactArray(intent.expected_programs_json, [PROGRAM_POLICY], "recovery_program_mismatch");
  positive(intent.minimum_output_atomic, "recovery_minimum_output_invalid");
  let signer: PublicKey;
  try { signer = new PublicKey(expected.treasury); } catch { return reject("treasury_invalid"); }
  const unsigned = decodeUnsignedOrder(intent.unsigned_transaction_base64, signer);
  const message = unsigned.message.serialize();
  let signature: Uint8Array;
  try { signature = bs58.decode(intent.tx_signature ?? ""); }
  catch { return reject("recovery_signature_invalid"); }
  if (signature.length !== 64 ||
    !/^[0-9a-f]{64}$/.test(intent.transaction_message_hash ?? "") ||
    await sha256Hex(message) !== intent.transaction_message_hash ||
    !ed25519.verify(signature, message, signer.toBytes())) reject("recovery_message_mismatch");
  return { txSignature: intent.tx_signature!,
    unsignedTransactionBase64: intent.unsigned_transaction_base64!,
    providerRequestId: intent.provider_request_id!,
    lastValidBlockHeight: intent.last_valid_block_height!,
    blockhash: unsigned.message.recentBlockhash };
}

/** Return only the original, cryptographically bound reward order for an
 * exact-signature retry. A new quote is never authorized by this proof. */
export async function inspectPersistedPreparedRewardSwap(intent: PersistedAutomaticRewardIntent | null,
  expected: { idempotencyKey: string; treasury: string; rewardMint: string;
    inputAmountLamports: string; rewardBatchId?: string | null }) {
  if (!intent || intent.idempotency_key !== expected.idempotencyKey ||
    !intent.settlement_id ||
    (intent.reward_batch_id ?? null) !== (expected.rewardBatchId ?? null) ||
    intent.signer_role !== "reward_treasury" || intent.signer_address !== expected.treasury ||
    intent.action !== "solana_reward_purchase_automation" || intent.state !== "prepared" ||
    intent.input_mint !== NATIVE_MINT.toBase58() || intent.output_mint !== expected.rewardMint ||
    intent.input_amount_atomic !== expected.inputAmountLamports ||
    intent.maximum_spend_lamports !== expected.inputAmountLamports ||
    !intent.provider_request_id || !/^[\x21-\x7e]{1,200}$/.test(intent.provider_request_id) ||
    !Number.isSafeInteger(intent.last_valid_block_height) ||
    (intent.last_valid_block_height ?? 0) <= 0) reject("reward_recovery_identity_mismatch");
  parseExactArray(intent.expected_mints_json,
    [NATIVE_MINT.toBase58(), expected.rewardMint], "reward_recovery_mints_mismatch");
  parseExactArray(intent.expected_programs_json, [PROGRAM_POLICY], "reward_recovery_program_mismatch");
  positive(intent.minimum_output_atomic, "reward_recovery_minimum_output_invalid");
  let signer: PublicKey;
  try { signer = new PublicKey(expected.treasury); } catch { return reject("treasury_invalid"); }
  const unsigned = decodeUnsignedOrder(intent.unsigned_transaction_base64, signer);
  const message = unsigned.message.serialize();
  let signature: Uint8Array;
  try { signature = bs58.decode(intent.tx_signature ?? ""); }
  catch { return reject("reward_recovery_signature_invalid"); }
  if (signature.length !== 64 ||
    !/^[0-9a-f]{64}$/.test(intent.transaction_message_hash ?? "") ||
    await sha256Hex(message) !== intent.transaction_message_hash ||
    !ed25519.verify(signature, message, signer.toBytes())) reject("reward_recovery_message_mismatch");
  return { txSignature: intent.tx_signature!,
    unsignedTransactionBase64: intent.unsigned_transaction_base64!,
    providerRequestId: intent.provider_request_id!,
    lastValidBlockHeight: intent.last_valid_block_height!,
    blockhash: unsigned.message.recentBlockhash };
}

/** Completion: cryptographically bind a finalized on-chain swap to the exact
 * Jupiter message and deterministic signature persisted before broadcast.
 * Call this *after* verifySportpadBuybackReceipts has checked actual SOL/token
 * deltas and the linked burn. No such persisted intent currently exists for
 * the disabled automation worker, so missing records MUST fail closed. */
async function verifyPersistedAutomaticSwapIntent({
  intent,
  expected,
  swapReceipt,
  swapStatus,
  action,
  signerRole,
  idempotencyKey,
}: {
  intent: PersistedAutomaticBuybackIntent | null;
  expected: ExpectedAutomaticSwap;
  swapReceipt: SolanaAutomationReceipt | null;
  swapStatus: SignatureStatus | null;
  action: string;
  signerRole: string;
  idempotencyKey: string;
}) {
  if (!intent) reject("not_persisted_before_broadcast");
  let signer: PublicKey;
  try { signer = new PublicKey(expected.treasury); } catch { return reject("treasury_invalid"); }
  if (intent.idempotency_key !== idempotencyKey ||
    intent.settlement_id !== expected.settlementId || intent.signer_role !== signerRole ||
    intent.signer_address !== signer.toBase58() || intent.action !== action ||
    !["prepared", "broadcasting", "submitted", "submission_unknown", "confirmed"].includes(intent.state)) {
    reject("job_identity_mismatch");
  }
  if (!intent.provider_request_id || intent.provider_request_id.length > 200 ||
    !/^[\x21-\x7e]+$/.test(intent.provider_request_id)) reject("provider_request_missing");
  if (intent.input_mint !== NATIVE_MINT.toBase58() ||
    intent.output_mint !== expected.outputMint ||
    intent.input_amount_atomic !== expected.inputAmountLamports ||
    positive(intent.maximum_spend_lamports, "spend_cap_invalid") !==
      positive(expected.inputAmountLamports, "input_amount_invalid") ||
    BigInt(expected.inputAmountLamports) > MAX_INPUT_LAMPORTS) reject("swap_terms_mismatch");
  parseExactArray(intent.expected_mints_json, [NATIVE_MINT.toBase58(), expected.outputMint], "mint_policy_mismatch");
  parseExactArray(intent.expected_programs_json, [PROGRAM_POLICY], "program_policy_mismatch");
  const minimum = positive(intent.minimum_output_atomic, "minimum_output_invalid");
  if (minimum > positive(expected.purchasedAmountAtomic, "purchased_amount_invalid")) reject("output_below_persisted_minimum");
  if (!swapStatus || swapStatus.err !== null || swapStatus.confirmationStatus !== "finalized" ||
    !swapReceipt || !swapReceipt.meta || swapReceipt.meta.err !== null ||
    swapReceipt.slot !== swapStatus.slot ||
    swapReceipt.transaction.signatures[0] !== expected.swapSignature ||
    intent.tx_signature !== expected.swapSignature) reject("finalized_signature_mismatch");
  const unsigned = decodeUnsignedOrder(intent.unsigned_transaction_base64, signer);
  const message = unsigned.message.serialize();
  if (!/^[0-9a-f]{64}$/.test(intent.transaction_message_hash ?? "") ||
    await sha256Hex(message) !== intent.transaction_message_hash) reject("persisted_message_hash_mismatch");
  const chainMessage = swapReceipt.transaction.message.serialize();
  if (!Buffer.from(message).equals(Buffer.from(chainMessage))) reject("onchain_message_mismatch");
  let signatureBytes: Uint8Array;
  try { signatureBytes = bs58.decode(expected.swapSignature); } catch { return reject("signature_encoding_invalid"); }
  if (!ed25519.verify(signatureBytes, message, signer.toBytes())) reject("treasury_signature_invalid");
  return { txSignature: expected.swapSignature, transactionMessageHash: intent.transaction_message_hash,
    providerRequestId: intent.provider_request_id, minimumOutputAtomic: minimum.toString() };
}

export function verifyPersistedAutomaticBuybackIntent(input: {
  intent: PersistedAutomaticBuybackIntent | null;
  expected: Omit<ExpectedAutomaticSwap, "outputMint"> & { sportpadMint: string };
  swapReceipt: SolanaAutomationReceipt | null;
  swapStatus: SignatureStatus | null;
}) {
  return verifyPersistedAutomaticSwapIntent({
    ...input,
    expected: { ...input.expected, outputMint: input.expected.sportpadMint },
    action: "sportpad_buyback_automation",
    signerRole: "buyback_treasury",
    idempotencyKey: `automation:buyback:swap:${input.expected.settlementId}`,
  });
}

export function verifyPersistedAutomaticBuybackChunkIntent(input: {
  intent: PersistedAutomaticBuybackIntent | null;
  expected: Omit<ExpectedAutomaticSwap, "outputMint"> & { sportpadMint: string; stepId: string };
  swapReceipt: SolanaAutomationReceipt | null;
  swapStatus: SignatureStatus | null;
}) {
  return verifyPersistedAutomaticSwapIntent({
    ...input,
    expected: { ...input.expected, outputMint: input.expected.sportpadMint },
    action: "sportpad_buyback_automation",
    signerRole: "buyback_treasury",
    idempotencyKey: `automation:buyback:swap:${input.expected.stepId}`,
  });
}

export function verifyPersistedAutomaticRewardIntent(input: {
  intent: PersistedAutomaticRewardIntent | null;
  expected: Omit<ExpectedAutomaticSwap, "outputMint"> & { rewardMint: string };
  swapReceipt: SolanaAutomationReceipt | null;
  swapStatus: SignatureStatus | null;
}) {
  return verifyPersistedAutomaticSwapIntent({
    ...input,
    expected: { ...input.expected, outputMint: input.expected.rewardMint },
    action: "solana_reward_purchase_automation",
    signerRole: "reward_treasury",
    idempotencyKey: `automation:reward:swap:${input.expected.settlementId}`,
  });
}

/** Chunked rewards share the parent settlement FK but require a unique
 * signed order per step. The exact step ID is part of the proof namespace. */
export function verifyPersistedAutomaticRewardChunkIntent(input: {
  intent: PersistedAutomaticRewardIntent | null;
  expected: Omit<ExpectedAutomaticSwap, "outputMint"> & { rewardMint: string; stepId: string };
  swapReceipt: SolanaAutomationReceipt | null;
  swapStatus: SignatureStatus | null;
}) {
  return verifyPersistedAutomaticSwapIntent({
    ...input,
    expected: { ...input.expected, outputMint: input.expected.rewardMint },
    action: "solana_reward_purchase_automation",
    signerRole: "reward_treasury",
    idempotencyKey: `automation:reward:swap:${input.expected.stepId}`,
  });
}

/** A single signed swap may fund multiple fee settlements. The persisted
 * batch ID is the authority; settlement_id anchors its first source only. */
export function verifyPersistedAutomaticRewardBatchIntent(input: {
  intent: PersistedAutomaticRewardIntent | null;
  expected: Omit<ExpectedAutomaticSwap, "outputMint"> & {
    rewardMint: string; batchId: string;
  };
  swapReceipt: SolanaAutomationReceipt | null;
  swapStatus: SignatureStatus | null;
}) {
  if (input.intent?.reward_batch_id !== input.expected.batchId) reject("reward_batch_identity_mismatch");
  return verifyPersistedAutomaticSwapIntent({
    ...input,
    expected: { ...input.expected, outputMint: input.expected.rewardMint },
    action: "solana_reward_purchase_automation",
    signerRole: "reward_treasury",
    idempotencyKey: `automation:reward:batch:${input.expected.batchId}`,
  });
}
