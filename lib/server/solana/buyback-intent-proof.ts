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
  signer_role: string;
  signer_address: string;
  action: string;
  state: string;
  provider_request_id: string | null;
  unsigned_transaction_base64: string | null;
  transaction_message_hash: string | null;
  tx_signature: string | null;
  input_mint: string | null;
  output_mint: string | null;
  input_amount_atomic: string | null;
  minimum_output_atomic: string | null;
  maximum_spend_lamports: string;
  expected_mints_json: string;
  expected_programs_json: string;
};

type ExpectedBuybackSwap = {
  settlementId: string;
  treasury: string;
  sportpadMint: string;
  inputAmountLamports: string;
  purchasedAmountAtomic: string;
  swapSignature: string;
};

const ACTION = "sportpad_buyback_automation";
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

/** Completion: cryptographically bind a finalized on-chain swap to the exact
 * Jupiter message and deterministic signature persisted before broadcast.
 * Call this *after* verifySportpadBuybackReceipts has checked actual SOL/token
 * deltas and the linked burn. No such persisted intent currently exists for
 * the disabled automation worker, so missing records MUST fail closed. */
export async function verifyPersistedAutomaticBuybackIntent({
  intent,
  expected,
  swapReceipt,
  swapStatus,
}: {
  intent: PersistedAutomaticBuybackIntent | null;
  expected: ExpectedBuybackSwap;
  swapReceipt: SolanaAutomationReceipt | null;
  swapStatus: SignatureStatus | null;
}) {
  if (!intent) reject("not_persisted_before_broadcast");
  let signer: PublicKey;
  try { signer = new PublicKey(expected.treasury); } catch { return reject("treasury_invalid"); }
  if (intent.idempotency_key !== `automation:buyback:swap:${expected.settlementId}` ||
    intent.settlement_id !== expected.settlementId || intent.signer_role !== "buyback_treasury" ||
    intent.signer_address !== signer.toBase58() || intent.action !== ACTION ||
    !["prepared", "broadcasting", "submitted", "submission_unknown"].includes(intent.state)) {
    reject("job_identity_mismatch");
  }
  if (!intent.provider_request_id || intent.provider_request_id.length > 200 ||
    !/^[A-Za-z0-9:_-]+$/.test(intent.provider_request_id)) reject("provider_request_missing");
  if (intent.input_mint !== NATIVE_MINT.toBase58() ||
    intent.output_mint !== expected.sportpadMint ||
    intent.input_amount_atomic !== expected.inputAmountLamports ||
    positive(intent.maximum_spend_lamports, "spend_cap_invalid") !==
      positive(expected.inputAmountLamports, "input_amount_invalid") ||
    BigInt(expected.inputAmountLamports) > MAX_INPUT_LAMPORTS) reject("swap_terms_mismatch");
  parseExactArray(intent.expected_mints_json, [NATIVE_MINT.toBase58(), expected.sportpadMint], "mint_policy_mismatch");
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
