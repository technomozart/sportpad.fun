import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { REPLENISHMENT_ASSETS } from "./replenishment.ts";
import type { JupiterSwapPlan } from "../server/providers/jupiter-swap.ts";

// Match the reward batch lane's per-order limit. This is only a static,
// read-only filter: it cannot establish the source of any treasury SOL.
export const MAX_CHZ_FUNDING_LAMPORTS = 100_000_000n;
const MAX_COMPUTE_UNITS = 600_000;
const MAX_PRIORITY_MICROLAMPORTS = 1_000_000n;
const MAX_PRIORITY_FEE_LAMPORTS = 500_000n;
const METIS_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

function fail(reason: string): never {
  throw new Error(`chz_swap_${reason}`);
}

function same(first: PublicKey | undefined, second: PublicKey) {
  return first?.equals(second) ?? false;
}

function instruction(message: VersionedTransaction["message"], compiled: { programIdIndex: number; accountKeyIndexes: number[] | Uint8Array; data: Uint8Array }) {
  const keys = message.staticAccountKeys;
  const programId = keys[compiled.programIdIndex];
  if (!programId || [...compiled.accountKeyIndexes].some((index) => !keys[index])) return null;
  return new TransactionInstruction({
    programId,
    keys: [...compiled.accountKeyIndexes].map((index) => ({
      pubkey: keys[index],
      isSigner: message.isAccountSigner(index),
      isWritable: message.isAccountWritable(index),
    })),
    data: Buffer.from(compiled.data),
  });
}

/** Inspect an unsigned SOL -> official Solana CHZ Jupiter order without RPC,
 * signing, simulation or execution. Even a passing static inspection is never
 * an authorization to spend; the returned report is always executionReady=false.
 */
export function inspectSolanaChzFundingOrder(plan: JupiterSwapPlan, taker: string) {
  const signer = new PublicKey(taker);
  const input = BigInt(plan.inputAmountAtomic);
  if (input <= 0n || input > MAX_CHZ_FUNDING_LAMPORTS) fail("input_cap_exceeded");
  if (plan.inputMint !== REPLENISHMENT_ASSETS.solMint ||
      plan.outputMint !== REPLENISHMENT_ASSETS.solanaChzMint || plan.router !== "metis") {
    fail("route_mismatch");
  }
  if (BigInt(plan.minimumOutputAtomic) <= 0n ||
      BigInt(plan.minimumOutputAtomic) > BigInt(plan.outputAmountAtomic)) fail("output_mismatch");
  if (plan.transactionBase64.length > 4_096) fail("oversized_transaction");

  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64")); }
  catch { fail("unreadable_transaction"); }
  const message = transaction.message;
  if (message.version !== 0 || message.header.numRequiredSignatures !== 1 ||
      message.header.numReadonlySignedAccounts !== 0 ||
      !same(message.staticAccountKeys[0], signer) || transaction.signatures.length !== 1 ||
      transaction.signatures[0].some((byte) => byte !== 0)) fail("unexpected_signer");

  const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
  const outputAtas = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]
    .map((program) => getAssociatedTokenAddressSync(mint, signer, false, program));
  const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, signer);
  const lookupTableAddresses = message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58());
  const blockers = [
    "Source SOL has not been tied to reconciled 80% fee settlements and a durable allocation ledger.",
    "CHZ mint owner, token accounts, writable account owners, fees and on-chain balances have not been independently verified.",
    "Transaction effects have not been simulated against treasury SOL and CHZ balance changes.",
  ];
  if (lookupTableAddresses.length > 0) {
    blockers.push("Address lookup tables and their loaded instruction accounts have not been resolved.");
  }

  let metisInstructions = 0;
  let wrappedSolTransfers = 0n;
  let computeUnits: number | null = null;
  let priorityMicroLamports: bigint | null = null;
  const topLevelPrograms: string[] = [];
  for (const compiled of message.compiledInstructions) {
    const ix = instruction(message, compiled);
    if (!ix) {
      // A loaded program or account is unknowable without resolving its ALT.
      if (lookupTableAddresses.length === 0) fail("invalid_account_index");
      blockers.push("At least one instruction uses an unresolved address lookup table account.");
      topLevelPrograms.push("unresolved_lookup");
      continue;
    }
    topLevelPrograms.push(ix.programId.toBase58());
    if (same(ix.programId, ComputeBudgetProgram.programId)) {
      if (ix.data[0] === 2 && ix.data.length === 5 && computeUnits === null) {
        const units = ix.data[1] + ix.data[2] * 256 + ix.data[3] * 65_536 + ix.data[4] * 16_777_216;
        if (units <= 0 || units > MAX_COMPUTE_UNITS) fail("compute_limit_exceeded");
        computeUnits = units;
      } else if (ix.data[0] === 3 && ix.data.length === 9 && priorityMicroLamports === null) {
        let price = 0n;
        for (let index = 8; index >= 1; index -= 1) price = price * 256n + BigInt(ix.data[index]);
        if (price > MAX_PRIORITY_MICROLAMPORTS) fail("priority_price_exceeded");
        priorityMicroLamports = price;
      } else fail("unsupported_compute_instruction");
    } else if (same(ix.programId, SystemProgram.programId)) {
      try {
        if (SystemInstruction.decodeInstructionType(ix) !== "Transfer") fail("unsupported_system_instruction");
        const transfer = SystemInstruction.decodeTransfer(ix);
        if (!same(transfer.fromPubkey, signer) || !same(transfer.toPubkey, wrappedSolAta)) fail("unexpected_sol_transfer");
        wrappedSolTransfers += BigInt(transfer.lamports);
        if (wrappedSolTransfers > input) fail("sol_transfer_exceeded");
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("chz_swap_")) throw error;
        fail("unsupported_system_instruction");
      }
    } else if (same(ix.programId, ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) fail("unsupported_ata_instruction");
      const [payer, ata, owner, ataMint, system, tokenProgram] = ix.keys.map((key) => key.pubkey);
      const wrapped = same(ata, wrappedSolAta) && same(ataMint, NATIVE_MINT) && same(tokenProgram, TOKEN_PROGRAM_ID);
      const output = outputAtas.some((candidate, index) => same(ata, candidate) &&
        same(ataMint, mint) && same(tokenProgram, [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID][index]));
      if (!same(payer, signer) || !same(owner, signer) || !same(system, SystemProgram.programId) ||
          (!wrapped && !output)) fail("unexpected_ata");
    } else if (same(ix.programId, TOKEN_PROGRAM_ID)) {
      const syncNative = ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1 &&
        same(ix.keys[0].pubkey, wrappedSolAta);
      const closeWrapped = ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3 &&
        same(ix.keys[0].pubkey, wrappedSolAta) && same(ix.keys[1].pubkey, signer) &&
        same(ix.keys[2].pubkey, signer);
      if (!syncNative && !closeWrapped) fail("unsupported_token_instruction");
    } else if (same(ix.programId, METIS_PROGRAM_ID)) {
      metisInstructions += 1;
      if (metisInstructions > 1 || !ix.keys.some((key) => same(key.pubkey, signer))) fail("unexpected_metis_accounts");
      if (!ix.keys.some((key) => key.isWritable && outputAtas.some((ata) => same(key.pubkey, ata)))) {
        fail("missing_route_output");
      }
    } else fail("unapproved_program");
  }
  if (lookupTableAddresses.length === 0 && metisInstructions !== 1) fail("missing_metis_route");
  if (computeUnits !== null && priorityMicroLamports !== null &&
      (BigInt(computeUnits) * priorityMicroLamports + 999_999n) / 1_000_000n > MAX_PRIORITY_FEE_LAMPORTS - 5_000n) {
    fail("priority_fee_exceeded");
  }
  if (!message.staticAccountKeys.some((key, index) =>
    message.isAccountWritable(index) && outputAtas.some((ata) => same(key, ata)))) {
    blockers.push("The CHZ destination ATA is not statically writable; a resolved lookup table must prove it.");
  }

  return {
    executionReady: false as const,
    maximumInputLamports: MAX_CHZ_FUNDING_LAMPORTS.toString(),
    inputLamports: plan.inputAmountAtomic,
    officialChzMint: REPLENISHMENT_ASSETS.solanaChzMint,
    transactionMessageHash: plan.transactionMessageHash,
    instructionCount: message.compiledInstructions.length,
    topLevelPrograms,
    lookupTableAddresses,
    outputAtaCandidates: outputAtas.map((ata) => ata.toBase58()),
    blockers: [...new Set(blockers)],
  };
}
