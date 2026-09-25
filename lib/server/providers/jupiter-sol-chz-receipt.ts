import { ed25519 } from "@noble/curves/ed25519";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram, PublicKey, SystemInstruction, SystemProgram,
  TransactionMessage, VersionedTransaction, type Connection,
  type SignatureStatus, type TokenBalance, type TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import type { UnsignedSolToChzPlan } from "./jupiter-sol-chz-plan.ts";
import type { SignedSolanaPlan } from "./chiliz-solana-signing.ts";

const CHZ_MINT = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const METIS = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const MAX_INPUT_LAMPORTS = 100_000_000n;
const MAX_OVERHEAD_LAMPORTS = 5_500_000n;
const MAX_NETWORK_FEE_LAMPORTS = 500_000n;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type SolChzReceiptRpc = Pick<Connection, "getTransaction" | "getSignatureStatuses">;

/** Values in this object must come from trusted, durable reservation/journal rows. */
export type ExpectedSolChzSwapReceipt = {
  readonly rewardTreasury: string;
  readonly reservedInputLamports: string;
  readonly maximumSolDebitLamports: string;
  readonly minimumChzCreditAtomic: string;
  readonly providerRequestId: string;
  readonly transactionMessageHash: string;
  readonly signedTransactionSha256: string;
  readonly sourceSignature: string;
};

export type VerifiedSolChzSwapReceipt = {
  readonly signature: string;
  readonly finalizedSlot: number;
  readonly rewardTreasury: string;
  readonly officialChzMint: string;
  readonly outputAta: string;
  readonly inputLamports: string;
  readonly actualSolDebitLamports: string;
  readonly actualChzCreditAtomic: string;
  readonly transactionMessageHash: string;
  readonly signedTransactionSha256: string;
  readonly providerRequestId: string;
};

function fail(code: string): never { throw new Error(`sol_chz_receipt_${code}`); }

function positive(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) fail(`${label}_invalid`);
  return BigInt(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}

function canonicalBase64(value: string, label: string): Buffer {
  if (typeof value !== "string" || value.length > 4_096 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(`${label}_encoding_invalid`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 100 || bytes.length > 1_232 || bytes.toString("base64") !== value) {
    fail(`${label}_size_invalid`);
  }
  return bytes;
}

function canonicalSignature(value: string): Uint8Array {
  let bytes: Uint8Array;
  try { bytes = bs58.decode(value); }
  catch { return fail("signature_encoding_invalid"); }
  if (bytes.length !== 64 || bs58.encode(bytes) !== value) fail("signature_invalid");
  return bytes;
}

function requireFinalized(status: SignatureStatus | null,
  receipt: VersionedTransactionResponse | null, signature: string): VersionedTransactionResponse {
  if (!status || status.confirmationStatus !== "finalized" || status.err !== null ||
      !receipt || receipt.version !== 0 || !receipt.meta || receipt.meta.err !== null ||
      !Number.isSafeInteger(receipt.slot) || receipt.slot <= 0 || receipt.slot !== status.slot ||
      receipt.transaction.signatures.length !== 1 ||
      receipt.transaction.signatures[0] !== signature) fail("not_exact_finalized_transaction");
  return receipt;
}

function assertAta(ix: TransactionInstruction, source: PublicKey,
  outputAta: PublicKey, wrappedAta: PublicKey): void {
  if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6 ||
      !ix.keys[0].pubkey.equals(source) || !ix.keys[2].pubkey.equals(source) ||
      !ix.keys[4].pubkey.equals(SystemProgram.programId) ||
      !ix.keys[5].pubkey.equals(TOKEN_PROGRAM_ID)) fail("ata_instruction_invalid");
  const output = ix.keys[1].pubkey.equals(outputAta) && ix.keys[3].pubkey.equals(CHZ_MINT);
  const wrapped = ix.keys[1].pubkey.equals(wrappedAta) && ix.keys[3].pubkey.equals(NATIVE_MINT);
  if (!output && !wrapped) fail("ata_destination_unexpected");
}

function assertAllowedInstructions(instructions: readonly TransactionInstruction[],
  source: PublicKey, outputAta: PublicKey, wrappedAta: PublicKey, input: bigint): void {
  let wrappedFunding = 0n;
  let metisCount = 0;
  for (const ix of instructions) {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      if (!(ix.data.length === 5 && ix.data[0] === 2) &&
          !(ix.data.length === 9 && ix.data[0] === 3)) fail("compute_instruction_unapproved");
      continue;
    }
    if (ix.programId.equals(SystemProgram.programId)) {
      let transfer;
      try { transfer = SystemInstruction.decodeTransfer(ix); }
      catch { return fail("system_instruction_unapproved"); }
      if (!transfer.fromPubkey.equals(source) || !transfer.toPubkey.equals(wrappedAta)) {
        fail("sol_transfer_destination_unexpected");
      }
      wrappedFunding += BigInt(transfer.lamports);
      continue;
    }
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      assertAta(ix, source, outputAta, wrappedAta);
      continue;
    }
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      const sync = ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1 &&
        ix.keys[0].pubkey.equals(wrappedAta);
      const close = ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3 &&
        ix.keys[0].pubkey.equals(wrappedAta) && ix.keys[1].pubkey.equals(source) &&
        ix.keys[2].pubkey.equals(source);
      if (!sync && !close) fail("token_instruction_unapproved");
      continue;
    }
    if (ix.programId.equals(METIS)) {
      metisCount++;
      if (metisCount > 1 || !ix.keys.some((key) => key.pubkey.equals(source) && key.isSigner) ||
          !ix.keys.some((key) => key.pubkey.equals(outputAta) && key.isWritable)) {
        fail("metis_accounts_unexpected");
      }
      continue;
    }
    fail("program_unapproved");
  }
  if (metisCount !== 1 || wrappedFunding !== input) fail("route_or_exact_input_missing");
}

function balanceRows(rows: readonly TokenBalance[] | null | undefined, count: number,
  label: string): Map<number, TokenBalance> {
  if (!Array.isArray(rows)) fail(`${label}_metadata_missing`);
  const found = new Map<number, TokenBalance>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.accountIndex) || row.accountIndex < 0 ||
        row.accountIndex >= count || found.has(row.accountIndex) ||
        !row.owner || !row.programId || !/^[0-9]+$/.test(row.uiTokenAmount.amount)) {
      fail(`${label}_metadata_invalid`);
    }
    found.set(row.accountIndex, row);
  }
  return found;
}

function tokenAmount(row: TokenBalance | undefined): bigint {
  return row ? BigInt(row.uiTokenAmount.amount) : 0n;
}

/**
 * Fetch finalized RPC evidence and bind it to a separately persisted swap
 * reservation/journal. This proves actual source debit and CHZ ATA credit, not
 * route quality or future cross-chain delivery. Never broadcasts anything.
 */
export async function verifyFinalizedSolToChzSwapReceipt(input: {
  rpc: SolChzReceiptRpc;
  signedPlan: SignedSolanaPlan<UnsignedSolToChzPlan>;
  expected: ExpectedSolChzSwapReceipt;
}): Promise<VerifiedSolChzSwapReceipt> {
  const { signedPlan, expected } = input;
  let source: PublicKey;
  try { source = new PublicKey(expected.rewardTreasury); }
  catch { return fail("treasury_invalid"); }
  if (source.toBase58() !== expected.rewardTreasury ||
      !PublicKey.isOnCurve(source.toBytes())) fail("treasury_not_canonical_wallet");
  const inputAmount = positive(expected.reservedInputLamports, "reserved_input");
  const maxDebit = positive(expected.maximumSolDebitLamports, "maximum_debit");
  const minimumChz = positive(expected.minimumChzCreditAtomic, "minimum_chz");
  if (inputAmount > MAX_INPUT_LAMPORTS || maxDebit < inputAmount ||
      maxDebit > inputAmount + MAX_OVERHEAD_LAMPORTS ||
      !SHA256_HEX.test(expected.transactionMessageHash) ||
      !SHA256_HEX.test(expected.signedTransactionSha256) ||
      !expected.providerRequestId) fail("trusted_journal_terms_invalid");
  const outputAta = getAssociatedTokenAddressSync(CHZ_MINT, source, false, TOKEN_PROGRAM_ID);
  const wrappedAta = getAssociatedTokenAddressSync(NATIVE_MINT, source, false, TOKEN_PROGRAM_ID);
  const plan = signedPlan.plan;
  if (plan.executionReady !== false || signedPlan.executionReady !== false ||
      plan.sourceWallet !== expected.rewardTreasury ||
      plan.inputMint !== REPLENISHMENT_ASSETS.solMint ||
      plan.outputMint !== REPLENISHMENT_ASSETS.solanaChzMint ||
      plan.outputTokenProgram !== TOKEN_PROGRAM_ID.toBase58() ||
      plan.outputAta !== outputAta.toBase58() ||
      plan.wrappedSolAta !== wrappedAta.toBase58() ||
      plan.inputAmountAtomic !== expected.reservedInputLamports ||
      plan.minimumOutputAtomic !== expected.minimumChzCreditAtomic ||
      plan.router !== "metis" || plan.requestId !== expected.providerRequestId ||
      plan.transactionMessageHash !== expected.transactionMessageHash ||
      signedPlan.transactionMessageHash !== expected.transactionMessageHash ||
      signedPlan.signedTransactionSha256 !== expected.signedTransactionSha256 ||
      signedPlan.sourceSignature !== expected.sourceSignature) {
    fail("plan_not_bound_to_trusted_journal");
  }
  const signedBytes = canonicalBase64(signedPlan.signedTransactionBase64, "signed_transaction");
  const unsignedBytes = canonicalBase64(plan.transactionBase64, "unsigned_transaction");
  const signed = VersionedTransaction.deserialize(signedBytes);
  const unsigned = VersionedTransaction.deserialize(unsignedBytes);
  if (!Buffer.from(signed.serialize()).equals(signedBytes) ||
      !Buffer.from(unsigned.serialize()).equals(unsignedBytes) ||
      signed.version !== 0 || unsigned.version !== 0 ||
      signed.message.header.numRequiredSignatures !== 1 ||
      signed.message.staticAccountKeys[0]?.toBase58() !== expected.rewardTreasury ||
      signed.signatures.length !== 1 || unsigned.signatures.length !== 1 ||
      unsigned.signatures[0].some((byte) => byte !== 0) ||
      !Buffer.from(signed.message.serialize()).equals(unsigned.message.serialize()) ||
      signed.message.recentBlockhash !== plan.recentBlockhash ||
      signed.message.addressTableLookups.length !== plan.lookupTableAddresses.length ||
      signed.message.addressTableLookups.some((lookup, index) =>
        lookup.accountKey.toBase58() !== plan.lookupTableAddresses[index])) {
    fail("signed_message_or_lookup_mismatch");
  }
  const messageBytes = signed.message.serialize();
  const signatureBytes = canonicalSignature(expected.sourceSignature);
  if (!Buffer.from(signed.signatures[0]).equals(signatureBytes) ||
      !ed25519.verify(signatureBytes, messageBytes, source.toBytes()) ||
      await sha256Hex(messageBytes) !== expected.transactionMessageHash ||
      await sha256Hex(signedBytes) !== expected.signedTransactionSha256) {
    fail("signature_or_digest_mismatch");
  }
  const [statusResponse, transactionResponse] = await Promise.all([
    input.rpc.getSignatureStatuses([expected.sourceSignature], { searchTransactionHistory: true }),
    input.rpc.getTransaction(expected.sourceSignature, {
      commitment: "finalized", maxSupportedTransactionVersion: 0,
    }),
  ]);
  const receipt = requireFinalized(statusResponse.value[0] ?? null,
    transactionResponse as VersionedTransactionResponse | null, expected.sourceSignature);
  const chainMessage = receipt.transaction.message;
  if (!Buffer.from(chainMessage.serialize()).equals(messageBytes)) {
    fail("finalized_message_differs_from_signed_plan");
  }
  const loaded = receipt.meta!.loadedAddresses;
  const requiredLoadedWritable = signed.message.addressTableLookups.reduce(
    (total, lookup) => total + lookup.writableIndexes.length, 0);
  const requiredLoadedReadonly = signed.message.addressTableLookups.reduce(
    (total, lookup) => total + lookup.readonlyIndexes.length, 0);
  if (!loaded || loaded.writable.length !== requiredLoadedWritable ||
      loaded.readonly.length !== requiredLoadedReadonly) fail("loaded_addresses_missing_or_count_mismatch");
  const keys = [...signed.message.staticAccountKeys, ...loaded.writable, ...loaded.readonly];
  if (new Set(keys.map((key) => key.toBase58())).size !== keys.length) {
    fail("duplicate_finalized_account_keys");
  }
  let instructions: TransactionInstruction[];
  try { instructions = TransactionMessage.decompile(signed.message, {
    accountKeysFromLookups: loaded,
  }).instructions; }
  catch { return fail("finalized_lookup_resolution_invalid"); }
  assertAllowedInstructions(instructions, source, outputAta, wrappedAta, inputAmount);
  const outputIndex = keys.findIndex((key) => key.equals(outputAta));
  const wrappedIndex = keys.findIndex((key) => key.equals(wrappedAta));
  if (outputIndex < 0 || wrappedIndex < 0 ||
      !signed.message.isAccountWritable(outputIndex) ||
      !signed.message.isAccountWritable(wrappedIndex)) {
    fail("source_or_output_account_not_writable");
  }
  const meta = receipt.meta!;
  if (!Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances) ||
      meta.preBalances.length !== keys.length || meta.postBalances.length !== keys.length ||
      !Number.isSafeInteger(meta.fee) || meta.fee < 0 ||
      BigInt(meta.fee) > MAX_NETWORK_FEE_LAMPORTS ||
      [...meta.preBalances, ...meta.postBalances].some((value) =>
        !Number.isSafeInteger(value) || value < 0)) fail("lamport_metadata_invalid");
  const debit = BigInt(meta.preBalances[0]) - BigInt(meta.postBalances[0]);
  if (debit < inputAmount || debit > maxDebit || debit < inputAmount + BigInt(meta.fee)) {
    fail("treasury_sol_debit_out_of_bounds");
  }
  if (meta.preBalances[wrappedIndex] !== 0 || meta.postBalances[wrappedIndex] !== 0) {
    fail("wrapped_sol_account_not_temporary");
  }
  const before = balanceRows(meta.preTokenBalances, keys.length, "pre_token");
  const after = balanceRows(meta.postTokenBalances, keys.length, "post_token");
  const beforeChz = before.get(outputIndex);
  const afterChz = after.get(outputIndex);
  if (!beforeChz || !afterChz ||
      [beforeChz, afterChz].some((row) => row.mint !== CHZ_MINT.toBase58() ||
        row.owner !== expected.rewardTreasury ||
        row.programId !== TOKEN_PROGRAM_ID.toBase58() ||
        row.uiTokenAmount.decimals !== 8)) fail("official_chz_ata_balance_identity_invalid");
  const credit = tokenAmount(afterChz) - tokenAmount(beforeChz);
  if (credit < minimumChz || credit > BigInt(plan.outputAmountAtomic) * 2n) {
    fail("chz_credit_below_minimum_or_unbounded");
  }
  const tokenIndices = new Set([...before.keys(), ...after.keys()]);
  for (const index of tokenIndices) {
    const pre = before.get(index);
    const post = after.get(index);
    if (pre && post && (pre.mint !== post.mint || pre.owner !== post.owner ||
        pre.programId !== post.programId ||
        pre.uiTokenAmount.decimals !== post.uiTokenAmount.decimals)) {
      fail("token_balance_identity_changed");
    }
    const row = pre ?? post!;
    if (index === outputIndex || index === wrappedIndex) continue;
    if (row.owner === expected.rewardTreasury && signed.message.isAccountWritable(index)) {
      fail("other_treasury_token_account_writable");
    }
    if (row.mint === CHZ_MINT.toBase58() && tokenAmount(post) > tokenAmount(pre)) {
      fail("unexpected_other_chz_output");
    }
  }
  for (let index = 1; index < keys.length; index++) {
    if (!signed.message.isAccountWritable(index) || index === outputIndex ||
        index === wrappedIndex || tokenIndices.has(index)) continue;
    if (meta.preBalances[index] !== meta.postBalances[index]) {
      fail("unexpected_non_token_lamport_output");
    }
  }
  return {
    signature: expected.sourceSignature,
    finalizedSlot: receipt.slot,
    rewardTreasury: expected.rewardTreasury,
    officialChzMint: CHZ_MINT.toBase58(),
    outputAta: outputAta.toBase58(),
    inputLamports: inputAmount.toString(),
    actualSolDebitLamports: debit.toString(),
    actualChzCreditAtomic: credit.toString(),
    transactionMessageHash: expected.transactionMessageHash,
    signedTransactionSha256: expected.signedTransactionSha256,
    providerRequestId: expected.providerRequestId,
  };
}
