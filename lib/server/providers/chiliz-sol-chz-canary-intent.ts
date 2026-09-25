import { ed25519 } from "@noble/curves/ed25519";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram,
  PublicKey, SystemInstruction, SystemProgram, TransactionMessage,
  VersionedTransaction, type Connection, type TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import { verifyJupiterMetisEmbeddedMinOut } from "./jupiter-metis-min-out.ts";
import type { UnsignedSolToChzPlan } from "./jupiter-sol-chz-plan.ts";
import type { UnsignedOfficialChzAtaProvision } from "./chiliz-ata-provision.ts";
import type { SignedSolanaPlan } from "./chiliz-solana-signing.ts";

const CHZ_MINT = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const METIS = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const CANARY_SWAP_LAMPORTS = 1_000_000n;
const MAX_SWAP_SPEND_LAMPORTS = 1_500_000n;
const MIN_CANARY_CHZ_ATOMIC = 400_000_000n; // Fixed one-shot price floor: 4 CHZ.
const HEX64 = /^[0-9a-f]{64}$/;

export type CanaryOperation = "ata_setup" | "sol_chz_swap";
export type CanarySignedInput = {
  operation: CanaryOperation;
  signed: SignedSolanaPlan<UnsignedOfficialChzAtaProvision | UnsignedSolToChzPlan>;
};
export type VerifiedCanaryIntent = {
  id: string;
  operation: CanaryOperation;
  sourceWallet: string;
  outputAta: string;
  inputLamports: number;
  maximumSpendLamports: number;
  minimumOutputAtomic: string;
  providerRequestId: string | null;
  lastValidBlockHeight: number;
  unsignedTransactionBase64: string;
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  transactionMessageHash: string;
  sourceSignature: string;
};
export type CanaryReadConnection = Pick<Connection,
  "getBlockHeight" | "getMultipleAccountsInfoAndContext">;

function fail(code: string): never { throw new Error(`chz_canary_intent_${code}`); }
async function sha256(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}
function canonicalBytes(value: string): Buffer {
  if (typeof value !== "string" || value.length > 4_096 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("base64_invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 100 || bytes.length > 1_232 || bytes.toString("base64") !== value) {
    fail("transaction_bytes_invalid");
  }
  return bytes;
}
function positiveBigInt(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) fail("atomic_value_invalid");
  return BigInt(value);
}

function validateSwapInstructions(instructions: readonly TransactionInstruction[],
  source: PublicKey, outputAta: PublicKey, input: bigint): TransactionInstruction {
  const wrapped = getAssociatedTokenAddressSync(NATIVE_MINT, source);
  let funding = 0n;
  let route: TransactionInstruction | null = null;
  let computeUnits: number | null = null;
  let priorityMicrolamports: bigint | null = null;
  for (const ix of instructions) {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      if (ix.data[0] === 2 && ix.data.length === 5 && computeUnits === null) {
        const units = new DataView(ix.data.buffer, ix.data.byteOffset,
          ix.data.byteLength).getUint32(1, true);
        if (units <= 0 || units > 600_000) fail("compute_units_out_of_bounds");
        computeUnits = units;
      } else if (ix.data[0] === 3 && ix.data.length === 9 &&
          priorityMicrolamports === null) {
        const price = new DataView(ix.data.buffer, ix.data.byteOffset,
          ix.data.byteLength).getBigUint64(1, true);
        if (price > 1_000_000n) fail("priority_price_out_of_bounds");
        priorityMicrolamports = price;
      } else fail("compute_instruction_unapproved");
    } else if (ix.programId.equals(SystemProgram.programId)) {
      let transfer;
      try { transfer = SystemInstruction.decodeTransfer(ix); }
      catch { return fail("system_instruction_unapproved"); }
      if (!transfer.fromPubkey.equals(source) || !transfer.toPubkey.equals(wrapped)) {
        fail("unexpected_sol_destination");
      }
      funding += BigInt(transfer.lamports);
    } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6 ||
          !ix.keys[0].pubkey.equals(source) || !ix.keys[1].pubkey.equals(wrapped) ||
          !ix.keys[2].pubkey.equals(source) || !ix.keys[3].pubkey.equals(NATIVE_MINT) ||
          !ix.keys[4].pubkey.equals(SystemProgram.programId) ||
          !ix.keys[5].pubkey.equals(TOKEN_PROGRAM_ID)) fail("ata_instruction_unapproved");
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      const sync = ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1 &&
        ix.keys[0].pubkey.equals(wrapped);
      const close = ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3 &&
        ix.keys[0].pubkey.equals(wrapped) && ix.keys[1].pubkey.equals(source) &&
        ix.keys[2].pubkey.equals(source);
      if (!sync && !close) fail("token_instruction_unapproved");
    } else if (ix.programId.equals(METIS)) {
      if (route || !ix.keys.some((key) => key.pubkey.equals(source) && key.isSigner) ||
          !ix.keys.some((key) => key.pubkey.equals(outputAta) && key.isWritable)) {
        fail("route_accounts_unapproved");
      }
      route = ix;
    } else fail("program_unapproved");
  }
  if (!route || funding !== input) fail("route_or_exact_funding_missing");
  if (computeUnits !== null && priorityMicrolamports !== null &&
      (BigInt(computeUnits) * priorityMicrolamports + 999_999n) / 1_000_000n > 495_000n) {
    fail("priority_fee_out_of_bounds");
  }
  return route;
}

/** Revalidate a signed one-shot intent at the journal boundary. A caller's
 * plan fields alone are insufficient: signature, message, canonical ATA and
 * actual JUP6 embedded minimum are checked again. No signing or broadcast. */
export async function verifyCanarySignedIntent(input: {
  configuredRewardTreasury: string;
  operation: CanaryOperation;
  signed: SignedSolanaPlan<UnsignedOfficialChzAtaProvision | UnsignedSolToChzPlan>;
  connection: CanaryReadConnection;
}): Promise<VerifiedCanaryIntent> {
  const { signed, operation } = input;
  let source: PublicKey;
  try { source = new PublicKey(input.configuredRewardTreasury); }
  catch { return fail("configured_treasury_invalid"); }
  if (source.toBase58() !== input.configuredRewardTreasury ||
      !PublicKey.isOnCurve(source.toBytes()) || signed.executionReady !== false ||
      !HEX64.test(signed.transactionMessageHash) ||
      !HEX64.test(signed.signedTransactionSha256)) fail("signed_fields_invalid");
  const ata = getAssociatedTokenAddressSync(CHZ_MINT, source, false, TOKEN_PROGRAM_ID);
  const signedBytes = canonicalBytes(signed.signedTransactionBase64);
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(signedBytes); }
  catch { return fail("signed_transaction_unreadable"); }
  if (!Buffer.from(transaction.serialize()).equals(signedBytes) || transaction.version !== 0 ||
      transaction.message.header.numRequiredSignatures !== 1 ||
      transaction.message.staticAccountKeys[0]?.toBase58() !== source.toBase58() ||
      transaction.signatures.length !== 1 ||
      !ed25519.verify(transaction.signatures[0], transaction.message.serialize(), source.toBytes()) ||
      bs58.encode(transaction.signatures[0]) !== signed.sourceSignature ||
      await sha256(signedBytes) !== signed.signedTransactionSha256 ||
      await sha256(transaction.message.serialize()) !== signed.transactionMessageHash) {
    fail("signed_message_identity_invalid");
  }
  const plan = signed.plan;
  const currentHeight = await input.connection.getBlockHeight("finalized");
  if (!plan || typeof plan !== "object" ||
      !Number.isSafeInteger(plan.lastValidBlockHeight) || plan.lastValidBlockHeight <= 0 ||
      !Number.isSafeInteger(currentHeight) || currentHeight <= 0 ||
      currentHeight >= plan.lastValidBlockHeight ||
      transaction.message.recentBlockhash !== plan.recentBlockhash ||
      plan.transactionMessageHash !== signed.transactionMessageHash) {
    fail("plan_blockhash_or_expiry_invalid");
  }
  let unsigned: VersionedTransaction;
  const unsignedBase64 = operation === "ata_setup"
    ? (plan as UnsignedOfficialChzAtaProvision).unsignedTransactionBase64
    : (plan as UnsignedSolToChzPlan).transactionBase64;
  try { unsigned = VersionedTransaction.deserialize(canonicalBytes(unsignedBase64)); }
  catch { return fail("unsigned_transaction_unreadable"); }
  if (!Buffer.from(unsigned.message.serialize()).equals(Buffer.from(transaction.message.serialize())) ||
      unsigned.signatures.length !== 1 || unsigned.signatures[0].some((byte) => byte !== 0)) {
    fail("unsigned_message_differs");
  }
  let maximumSpendLamports: bigint;
  let minimumOutputAtomic = "0";
  let providerRequestId: string | null = null;
  let inputLamports = 0n;
  if (operation === "ata_setup") {
    const setup = plan as UnsignedOfficialChzAtaProvision;
    const rent = positiveBigInt(setup.ataRentLamports);
    maximumSpendLamports = BigInt(setup.maximumSetupSpendLamports);
    if (setup.rewardTreasury !== source.toBase58() ||
        setup.officialChzMint !== CHZ_MINT.toBase58() ||
        setup.tokenProgram !== TOKEN_PROGRAM_ID.toBase58() ||
        setup.outputAta !== ata.toBase58() ||
        rent > 2_500_000n || maximumSpendLamports !== rent + 50_000n ||
        transaction.message.addressTableLookups.length !== 0) fail("ata_plan_invalid");
    const expected = new TransactionMessage({ payerKey: source,
      recentBlockhash: setup.recentBlockhash,
      instructions: [createAssociatedTokenAccountIdempotentInstruction(
        source, ata, source, CHZ_MINT, TOKEN_PROGRAM_ID)],
    }).compileToV0Message();
    if (!Buffer.from(expected.serialize()).equals(Buffer.from(transaction.message.serialize()))) {
      fail("ata_instruction_not_exact");
    }
  } else if (operation === "sol_chz_swap") {
    const swap = plan as UnsignedSolToChzPlan;
    inputLamports = positiveBigInt(swap.inputAmountAtomic);
    maximumSpendLamports = MAX_SWAP_SPEND_LAMPORTS;
    minimumOutputAtomic = swap.minimumOutputAtomic;
    providerRequestId = swap.requestId;
    if (inputLamports !== CANARY_SWAP_LAMPORTS ||
        swap.sourceWallet !== source.toBase58() ||
        swap.inputMint !== NATIVE_MINT.toBase58() ||
        swap.outputMint !== CHZ_MINT.toBase58() ||
        swap.outputTokenProgram !== TOKEN_PROGRAM_ID.toBase58() ||
        swap.outputAta !== ata.toBase58() ||
        swap.router !== "metis" || typeof providerRequestId !== "string" ||
        providerRequestId.length < 4 || providerRequestId.length > 160 ||
        positiveBigInt(minimumOutputAtomic) < MIN_CANARY_CHZ_ATOMIC ||
        positiveBigInt(swap.outputAmountAtomic) < positiveBigInt(minimumOutputAtomic) ||
        positiveBigInt(swap.simulatedSolDebitLamports) > maximumSpendLamports ||
        positiveBigInt(swap.simulatedChzCreditAtomic) < positiveBigInt(minimumOutputAtomic)) {
      fail("swap_plan_or_bound_invalid");
    }
    const accountSnapshot = await input.connection.getMultipleAccountsInfoAndContext(
      [CHZ_MINT, ata], "finalized");
    if (accountSnapshot.context.slot < swap.accountSlot ||
        accountSnapshot.value.length !== 2) fail("swap_ata_snapshot_invalid");
    const [mintInfo, ataInfo] = accountSnapshot.value;
    if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID) || !ataInfo ||
        !ataInfo.owner.equals(TOKEN_PROGRAM_ID)) fail("swap_ata_not_initialized");
    const mint = unpackMint(CHZ_MINT, mintInfo, TOKEN_PROGRAM_ID);
    const account = unpackAccount(ata, ataInfo, TOKEN_PROGRAM_ID);
    if (!mint.isInitialized || mint.decimals !== 8 || !account.isInitialized ||
        !account.owner.equals(source) || !account.mint.equals(CHZ_MINT)) {
      fail("swap_ata_identity_invalid");
    }
    const lookupKeys = transaction.message.addressTableLookups.map((entry) => entry.accountKey);
    const tables: AddressLookupTableAccount[] = [];
    if (lookupKeys.length > 4) fail("too_many_lookup_tables");
    if (lookupKeys.length > 0) {
      const snapshot = await input.connection.getMultipleAccountsInfoAndContext(lookupKeys,
        { commitment: "finalized", minContextSlot: swap.accountSlot });
      if (snapshot.context.slot < swap.accountSlot || snapshot.value.length !== lookupKeys.length) {
        fail("lookup_snapshot_invalid");
      }
      for (let index = 0; index < lookupKeys.length; index++) {
        const info = snapshot.value[index];
        if (!info || !info.owner.equals(AddressLookupTableProgram.programId)) {
          fail("lookup_table_invalid");
        }
        const table = new AddressLookupTableAccount({ key: lookupKeys[index],
          state: AddressLookupTableAccount.deserialize(info.data) });
        if (!table.isActive()) fail("lookup_table_inactive");
        tables.push(table);
      }
    }
    const instructions = TransactionMessage.decompile(transaction.message,
      { addressLookupTableAccounts: tables }).instructions;
    const route = validateSwapInstructions(instructions, source, ata, inputLamports);
    verifyJupiterMetisEmbeddedMinOut({ instruction: route,
      configuredRewardTreasury: source.toBase58(), inputAmountAtomic: swap.inputAmountAtomic,
      quotedOutputAtomic: swap.outputAmountAtomic,
      journalMinimumOutputAtomic: minimumOutputAtomic });
  } else fail("operation_invalid");
  if (maximumSpendLamports > 5_000_000n) fail("aggregate_cap_per_operation_exceeded");
  return {
    id: `sportpad-chz-canary:${operation}`, operation,
    sourceWallet: source.toBase58(), outputAta: ata.toBase58(),
    inputLamports: Number(inputLamports),
    maximumSpendLamports: Number(maximumSpendLamports),
    minimumOutputAtomic, providerRequestId,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    unsignedTransactionBase64: unsignedBase64,
    signedTransactionBase64: signed.signedTransactionBase64,
    signedTransactionSha256: signed.signedTransactionSha256,
    transactionMessageHash: signed.transactionMessageHash,
    sourceSignature: signed.sourceSignature,
  };
}
