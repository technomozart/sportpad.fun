import { Buffer } from "buffer";
import { ed25519 } from "@noble/curves/ed25519";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, type SignatureStatus } from "@solana/web3.js";
import bs58 from "bs58";

import type { SolanaAutomationReceipt } from "./automation-receipt.ts";

const MAX_U64 = 18_446_744_073_709_551_615n;

export type PersistedAutomaticBurnIntent = {
  idempotency_key: string; settlement_id: string; signer_role: string;
  signer_address: string; action: string; state: string;
  expected_programs_json: string; expected_mints_json: string;
  maximum_spend_lamports: string; provider_request_id: string | null;
  unsigned_transaction_base64: string | null;
  transaction_message_hash: string | null;
  last_valid_block_height: number | null;
  input_mint: string | null; input_amount_atomic: string | null;
  tx_signature: string | null;
};

type BurnTerms = {
  treasury: string; mint: string; amountAtomic: string;
  decimals: number; tokenProgram: string;
};

function reject(code: string): never { throw new Error(`buyback_burn_intent_${code}`); }

function exactBytes(value: string | null) {
  if (!value || value.length > 20_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    reject("transaction_encoding_invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) reject("transaction_encoding_invalid");
  return bytes;
}

async function messageHash(message: Uint8Array) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(message)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseSignedBurn(value: string | null, terms: BurnTerms) {
  let transaction: Transaction;
  try { transaction = Transaction.from(exactBytes(value)); }
  catch { return reject("transaction_invalid"); }
  let signer: PublicKey;
  let mint: PublicKey;
  let tokenProgram: PublicKey;
  try {
    signer = new PublicKey(terms.treasury);
    mint = new PublicKey(terms.mint);
    tokenProgram = new PublicKey(terms.tokenProgram);
  } catch { return reject("address_invalid"); }
  if ((!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) ||
    !/^[1-9][0-9]*$/.test(terms.amountAtomic) || BigInt(terms.amountAtomic) > MAX_U64 ||
    !Number.isInteger(terms.decimals) || terms.decimals < 0 || terms.decimals > 18) {
    reject("terms_invalid");
  }
  const source = getAssociatedTokenAddressSync(mint, signer, false, tokenProgram);
  const expected = createBurnCheckedInstruction(source, mint, signer,
    BigInt(terms.amountAtomic), terms.decimals, [], tokenProgram);
  const actual = transaction.instructions[0];
  const signerEntry = transaction.signatures[0];
  const message = transaction.serializeMessage();
  if (!transaction.feePayer?.equals(signer) || !transaction.recentBlockhash ||
    transaction.instructions.length !== 1 || transaction.signatures.length !== 1 ||
    !signerEntry?.publicKey.equals(signer) || !signerEntry.signature ||
    !ed25519.verify(signerEntry.signature, message, signer.toBytes()) ||
    !actual.programId.equals(expected.programId) ||
    !Buffer.from(actual.data).equals(Buffer.from(expected.data)) ||
    actual.keys.length !== expected.keys.length ||
    actual.keys.some((key, index) =>
      !key.pubkey.equals(expected.keys[index].pubkey) ||
      key.isSigner !== expected.keys[index].isSigner ||
      (key.isWritable !== expected.keys[index].isWritable &&
        !(key.pubkey.equals(signer) && key.isWritable)))) {
    reject("message_mismatch");
  }
  return { transaction, signature: bs58.encode(signerEntry.signature), message };
}

export async function inspectPreparedAutomaticBuybackBurn(value: string, terms: BurnTerms) {
  const parsed = parseSignedBurn(value, terms);
  return { txSignature: parsed.signature,
    transactionMessageHash: await messageHash(parsed.message),
    blockhash: parsed.transaction.recentBlockhash! };
}

export async function verifyPersistedAutomaticBuybackBurnIntent({ intent, expected, receipt, status }:
  { intent: PersistedAutomaticBurnIntent | null; expected: BurnTerms & {
    settlementId: string; signature: string;
  }; receipt: SolanaAutomationReceipt | null; status: SignatureStatus | null }) {
  if (!intent || intent.idempotency_key !== `automation:buyback:burn:${expected.settlementId}` ||
    intent.settlement_id !== expected.settlementId || intent.signer_role !== "buyback_treasury" ||
    intent.signer_address !== expected.treasury || intent.action !== "sportpad_burn_automation" ||
    !["prepared", "broadcasting", "submitted", "submission_unknown"].includes(intent.state) ||
    intent.input_mint !== expected.mint || intent.input_amount_atomic !== expected.amountAtomic ||
    intent.tx_signature !== expected.signature ||
    intent.expected_programs_json !== JSON.stringify([expected.tokenProgram]) ||
    intent.expected_mints_json !== JSON.stringify([expected.mint]) ||
    intent.maximum_spend_lamports !== "500000") {
    reject("job_identity_mismatch");
  }
  const parsed = parseSignedBurn(intent.unsigned_transaction_base64, expected);
  if (parsed.signature !== expected.signature ||
    intent.provider_request_id !== parsed.transaction.recentBlockhash ||
    await messageHash(parsed.message) !== intent.transaction_message_hash ||
    !Number.isSafeInteger(intent.last_valid_block_height) ||
    (intent.last_valid_block_height ?? 0) <= 0) reject("persisted_message_mismatch");
  if (!receipt?.meta || receipt.meta.err !== null ||
    receipt.transaction.signatures[0] !== expected.signature ||
    !status || status.err !== null || status.confirmationStatus !== "finalized" ||
    receipt.slot !== status.slot ||
    !Buffer.from(receipt.transaction.message.serialize()).equals(Buffer.from(parsed.message))) {
    reject("finalized_receipt_mismatch");
  }
  return { txSignature: expected.signature, transactionMessageHash: intent.transaction_message_hash };
}
