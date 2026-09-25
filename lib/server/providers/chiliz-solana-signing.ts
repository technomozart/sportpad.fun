import { ed25519 } from "@noble/curves/ed25519";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, PublicKey,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import {
  prepareUnsignedSolToChzSwap, type SolChzReadConnection,
  type UnsignedSolToChzPlan,
} from "./jupiter-sol-chz-plan.ts";
import {
  prepareUnsignedOfficialChzAtaProvision, type ChzAtaProvisionReadConnection,
  type UnsignedOfficialChzAtaProvision,
} from "./chiliz-ata-provision.ts";
import { verifyJupiterMetisEmbeddedMinOut } from "./jupiter-metis-min-out.ts";

const MAX_TRANSACTION_BYTES = 1_232;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const METIS_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/** A treasury-owned signing service or HSM. Never pass a secret into a plan. */
export type SolanaMessageSigner = {
  readonly publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array> | Uint8Array;
};

export type SignedSolanaPlan<T> = {
  readonly plan: T;
  readonly signedTransactionBase64: string;
  readonly signedTransactionSha256: string;
  readonly transactionMessageHash: string;
  readonly sourceSignature: string;
  /** Signature preparation alone never authorizes broadcasting or public launches. */
  readonly executionReady: false;
};

function fail(code: string): never { throw new Error(`chz_solana_signing_${code}`); }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}

function canonicalBase64(value: string): Buffer {
  if (typeof value !== "string" || value.length > 4_096 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("unsigned_encoding_invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 100 || bytes.length > MAX_TRANSACTION_BYTES ||
      bytes.toString("base64") !== value) fail("unsigned_bytes_invalid");
  return bytes;
}

async function assertEmbeddedSwapMinimum(plan: UnsignedSolToChzPlan,
  connection: SolChzReadConnection): Promise<void> {
  const unsigned = VersionedTransaction.deserialize(canonicalBase64(plan.transactionBase64));
  const lookupKeys = unsigned.message.addressTableLookups.map((entry) => entry.accountKey);
  const tables: AddressLookupTableAccount[] = [];
  if (lookupKeys.length > 0) {
    const snapshot = await connection.getMultipleAccountsInfoAndContext(lookupKeys,
      { commitment: "finalized", minContextSlot: plan.accountSlot });
    if (snapshot.context.slot < plan.accountSlot || snapshot.value.length !== lookupKeys.length) {
      fail("metis_lookup_snapshot_invalid");
    }
    for (let index = 0; index < lookupKeys.length; index++) {
      const info = snapshot.value[index];
      if (!info || !info.owner.equals(AddressLookupTableProgram.programId)) {
        fail("metis_lookup_table_missing_or_wrong_owner");
      }
      const table = new AddressLookupTableAccount({
        key: lookupKeys[index], state: AddressLookupTableAccount.deserialize(info.data),
      });
      if (!table.isActive()) fail("metis_lookup_table_inactive");
      tables.push(table);
    }
  }
  let instructions;
  try { instructions = TransactionMessage.decompile(unsigned.message,
    { addressLookupTableAccounts: tables }).instructions; }
  catch { return fail("metis_instruction_resolution_failed"); }
  const metis = instructions.filter((ix) => ix.programId.equals(METIS_PROGRAM_ID));
  if (metis.length !== 1) fail("metis_instruction_count_invalid");
  verifyJupiterMetisEmbeddedMinOut({
    instruction: metis[0],
    configuredRewardTreasury: plan.sourceWallet,
    inputAmountAtomic: plan.inputAmountAtomic,
    quotedOutputAtomic: plan.outputAmountAtomic,
    journalMinimumOutputAtomic: plan.minimumOutputAtomic,
  });
}

async function signExactUnsignedTransaction<T>(input: {
  plan: T;
  unsignedTransactionBase64: string;
  plannedMessageHash: string;
  plannedBlockhash: string;
  lastValidBlockHeight: number;
  configuredRewardTreasury: string;
  signer: SolanaMessageSigner;
  getBlockHeight: SolChzReadConnection["getBlockHeight"];
}): Promise<SignedSolanaPlan<T>> {
  let treasury: PublicKey;
  try { treasury = new PublicKey(input.configuredRewardTreasury); }
  catch { return fail("configured_treasury_invalid"); }
  if (treasury.toBase58() !== input.configuredRewardTreasury ||
      !treasury.equals(input.signer.publicKey)) fail("signer_not_configured_reward_treasury");
  if (!SHA256_HEX.test(input.plannedMessageHash) ||
      !Number.isSafeInteger(input.lastValidBlockHeight) || input.lastValidBlockHeight <= 0) {
    fail("plan_digest_or_expiry_invalid");
  }
  const unsignedBytes = canonicalBase64(input.unsignedTransactionBase64);
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(unsignedBytes); }
  catch { return fail("unsigned_transaction_unreadable"); }
  if (!Buffer.from(transaction.serialize()).equals(unsignedBytes) || transaction.version !== 0 ||
      transaction.message.header.numRequiredSignatures !== 1 ||
      transaction.message.staticAccountKeys[0]?.toBase58() !== treasury.toBase58() ||
      transaction.message.recentBlockhash !== input.plannedBlockhash ||
      transaction.signatures.length !== 1 ||
      transaction.signatures[0].some((byte) => byte !== 0)) {
    fail("unsigned_transaction_shape_invalid");
  }
  const messageBytes = new Uint8Array(transaction.message.serialize());
  if (await sha256Hex(messageBytes) !== input.plannedMessageHash) fail("plan_message_digest_mismatch");
  const beforeHeight = await input.getBlockHeight("finalized");
  if (!Number.isSafeInteger(beforeHeight) || beforeHeight >= input.lastValidBlockHeight) {
    fail("blockhash_expired_before_signing");
  }
  const signedMessage = new Uint8Array(messageBytes);
  const signature = new Uint8Array(await input.signer.signMessage(signedMessage));
  if (signature.length !== 64 || signature.every((byte) => byte === 0) ||
      !ed25519.verify(signature, messageBytes, treasury.toBytes())) {
    fail("signature_invalid_or_wrong_message");
  }
  // A signer is allowed to consume a copy, never the message that is serialized.
  transaction.addSignature(treasury, signature);
  const signedBytes = Buffer.from(transaction.serialize());
  if (signedBytes.length > MAX_TRANSACTION_BYTES ||
      !Buffer.from(transaction.message.serialize()).equals(messageBytes) ||
      !ed25519.verify(transaction.signatures[0], messageBytes, treasury.toBytes())) {
    fail("signed_transaction_mutated");
  }
  const afterHeight = await input.getBlockHeight("finalized");
  if (!Number.isSafeInteger(afterHeight) || afterHeight >= input.lastValidBlockHeight) {
    fail("blockhash_expired_after_signing");
  }
  return {
    plan: input.plan,
    signedTransactionBase64: signedBytes.toString("base64"),
    signedTransactionSha256: await sha256Hex(signedBytes),
    transactionMessageHash: input.plannedMessageHash,
    sourceSignature: bs58.encode(signature),
    executionReady: false,
  };
}

/**
 * Obtain a fresh Jupiter exact-in order, inspect its on-chain accounts and
 * simulated deltas, then sign that exact message. inputLamports must come from
 * a separately verified fee reservation; this helper cannot prove provenance.
 * It never broadcasts or writes a journal.
 */
export async function prepareAndSignSolToChzSwap(input: {
  apiKey: string;
  inputLamports: string;
  configuredRewardTreasury: string;
  connection: SolChzReadConnection;
  signer: SolanaMessageSigner;
  fetcher?: typeof fetch;
}): Promise<SignedSolanaPlan<UnsignedSolToChzPlan>> {
  if (input.signer.publicKey.toBase58() !== input.configuredRewardTreasury) {
    fail("signer_not_configured_reward_treasury");
  }
  const plan = await prepareUnsignedSolToChzSwap({
    apiKey: input.apiKey,
    inputLamports: input.inputLamports,
    sourceWallet: input.configuredRewardTreasury,
    connection: input.connection,
    fetcher: input.fetcher,
  });
  if (plan.sourceWallet !== input.configuredRewardTreasury ||
      plan.inputAmountAtomic !== input.inputLamports || plan.executionReady !== false) {
    fail("swap_plan_treasury_amount_invalid");
  }
  await assertEmbeddedSwapMinimum(plan, input.connection);
  return signExactUnsignedTransaction({
    plan,
    unsignedTransactionBase64: plan.transactionBase64,
    plannedMessageHash: plan.transactionMessageHash,
    plannedBlockhash: plan.recentBlockhash,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    configuredRewardTreasury: input.configuredRewardTreasury,
    signer: input.signer,
    getBlockHeight: input.connection.getBlockHeight.bind(input.connection),
  });
}

/** Separately sign the one-time ATA setup. This is never charged to a fee reservation. */
export async function prepareAndSignOfficialChzAta(input: {
  configuredRewardTreasury: string;
  connection: ChzAtaProvisionReadConnection;
  signer: SolanaMessageSigner;
}): Promise<SignedSolanaPlan<UnsignedOfficialChzAtaProvision>> {
  if (input.signer.publicKey.toBase58() !== input.configuredRewardTreasury) {
    fail("signer_not_configured_reward_treasury");
  }
  const plan = await prepareUnsignedOfficialChzAtaProvision({
    configuredRewardTreasury: input.configuredRewardTreasury,
    connection: input.connection,
  });
  if (plan.rewardTreasury !== input.configuredRewardTreasury || plan.executionReady !== false) {
    fail("ata_plan_treasury_invalid");
  }
  return signExactUnsignedTransaction({
    plan,
    unsignedTransactionBase64: plan.unsignedTransactionBase64,
    plannedMessageHash: plan.transactionMessageHash,
    plannedBlockhash: plan.recentBlockhash,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    configuredRewardTreasury: input.configuredRewardTreasury,
    signer: input.signer,
    getBlockHeight: input.connection.getBlockHeight.bind(input.connection),
  });
}
