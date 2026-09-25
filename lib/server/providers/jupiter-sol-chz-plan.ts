import {
  ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackAccount, unpackMint,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram,
  PublicKey, SystemInstruction, SystemProgram, TransactionMessage,
  VersionedTransaction, type AccountInfo, type Connection,
  type SimulatedTransactionAccountInfo, type TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import { inspectSolanaChzFundingOrder, MAX_CHZ_FUNDING_LAMPORTS } from
  "../../protocol/replenishment-swap-inspection.ts";
import { prepareJupiterSwap, type JupiterSwapPlan } from "./jupiter-swap.ts";

const METIS_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const CHZ_MINT = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const MAX_LOOKUP_TABLES = 4;
const MAX_WRITABLE_ACCOUNTS = 64;
const MAX_TRANSACTION_BYTES = 1_232;
const MAX_COMPUTE_UNITS = 600_000;
const MAX_PRIORITY_MICROLAMPORTS = 1_000_000n;
const MAX_OVERHEAD_LAMPORTS = 5_500_000n; // fee plus transient WSOL ATA rent.

export type SolChzReadConnection = Pick<Connection,
  "getMultipleAccountsInfoAndContext" | "getBlockHeight" | "simulateTransaction">;

export type UnsignedSolToChzPlan = JupiterSwapPlan & {
  readonly sourceWallet: string;
  readonly outputTokenProgram: string;
  readonly outputAta: string;
  readonly wrappedSolAta: string;
  readonly lookupTableAddresses: readonly string[];
  readonly topLevelPrograms: readonly string[];
  readonly accountSlot: number;
  readonly simulationSlot: number;
  readonly simulationUnitsConsumed: number | null;
  readonly simulatedSolBeforeLamports: string;
  readonly simulatedSolAfterLamports: string;
  readonly simulatedSolDebitLamports: string;
  readonly simulatedOverheadLamports: string;
  readonly simulatedChzBeforeAtomic: string;
  readonly simulatedChzAfterAtomic: string;
  readonly simulatedChzCreditAtomic: string;
  readonly recentBlockhash: string;
  /** Ledger provenance and signed/finalized execution are separate checks. */
  readonly executionReady: false;
};

function fail(code: string): never { throw new Error(`sol_chz_plan_${code}`); }

function exactUnsignedOrder(plan: JupiterSwapPlan, sourceWallet: string): VersionedTransaction {
  if (plan.transactionBase64.length > 4_096 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(plan.transactionBase64)) fail("transaction_encoding_invalid");
  const bytes = Buffer.from(plan.transactionBase64, "base64");
  if (bytes.length > MAX_TRANSACTION_BYTES || bytes.toString("base64") !== plan.transactionBase64) {
    fail("transaction_size_or_encoding_invalid");
  }
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bytes); }
  catch { return fail("transaction_unreadable"); }
  if (!Buffer.from(tx.serialize()).equals(bytes) || tx.version !== 0 ||
      tx.message.header.numRequiredSignatures !== 1 ||
      tx.message.staticAccountKeys[0]?.toBase58() !== sourceWallet ||
      tx.signatures.length !== 1 || tx.signatures[0].some((byte) => byte !== 0)) {
    fail("transaction_signer_or_version_invalid");
  }
  return tx;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}

function systemTransferLamports(ix: TransactionInstruction, payer: PublicKey,
  wrappedSolAta: PublicKey): bigint {
  try {
    if (SystemInstruction.decodeInstructionType(ix) !== "Transfer") fail("system_instruction_invalid");
    const transfer = SystemInstruction.decodeTransfer(ix);
    if (!transfer.fromPubkey.equals(payer) || !transfer.toPubkey.equals(wrappedSolAta)) {
      fail("system_transfer_not_exact_wsol_funding");
    }
    return BigInt(transfer.lamports);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("sol_chz_plan_")) throw error;
    return fail("system_instruction_invalid");
  }
}

function assertAtaInstruction(ix: TransactionInstruction, payer: PublicKey,
  wrappedSolAta: PublicKey, outputAta: PublicKey): void {
  if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) fail("ata_instruction_invalid");
  const [feePayer, ata, owner, mint, system, tokenProgram] = ix.keys.map((key) => key.pubkey);
  const wrapped = ata.equals(wrappedSolAta) && mint.equals(NATIVE_MINT);
  const output = ata.equals(outputAta) && mint.equals(CHZ_MINT);
  if (!feePayer.equals(payer) || !owner.equals(payer) ||
      !system.equals(SystemProgram.programId) || !tokenProgram.equals(TOKEN_PROGRAM_ID) ||
      !wrapped && !output) fail("ata_identity_invalid");
}

function assertTokenInstruction(ix: TransactionInstruction, payer: PublicKey,
  wrappedSolAta: PublicKey): void {
  const sync = ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1 &&
    ix.keys[0].pubkey.equals(wrappedSolAta);
  const close = ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3 &&
    ix.keys[0].pubkey.equals(wrappedSolAta) &&
    ix.keys[1].pubkey.equals(payer) && ix.keys[2].pubkey.equals(payer);
  if (!sync && !close) fail("token_instruction_invalid");
}

function inspectResolvedInstructions(instructions: readonly TransactionInstruction[],
  payer: PublicKey, outputAta: PublicKey, wrappedSolAta: PublicKey, input: bigint): string[] {
  let metis = 0;
  let wrappedTransfers = 0n;
  let computeUnits: number | null = null;
  let priorityPrice: bigint | null = null;
  const programs: string[] = [];
  for (const ix of instructions) {
    programs.push(ix.programId.toBase58());
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      if (ix.data[0] === 2 && ix.data.length === 5 && computeUnits === null) {
        const units = ix.data[1] + ix.data[2] * 256 + ix.data[3] * 65_536 +
          ix.data[4] * 16_777_216;
        if (units <= 0 || units > MAX_COMPUTE_UNITS) fail("compute_limit_exceeded");
        computeUnits = units;
      } else if (ix.data[0] === 3 && ix.data.length === 9 && priorityPrice === null) {
        let price = 0n;
        for (let index = 8; index >= 1; index--) price = price * 256n + BigInt(ix.data[index]);
        if (price > MAX_PRIORITY_MICROLAMPORTS) fail("priority_price_exceeded");
        priorityPrice = price;
      } else fail("compute_instruction_invalid");
    } else if (ix.programId.equals(SystemProgram.programId)) {
      wrappedTransfers += systemTransferLamports(ix, payer, wrappedSolAta);
      if (wrappedTransfers > input) fail("wrapped_sol_transfer_exceeds_input");
    } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      assertAtaInstruction(ix, payer, wrappedSolAta, outputAta);
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      assertTokenInstruction(ix, payer, wrappedSolAta);
    } else if (ix.programId.equals(METIS_PROGRAM_ID)) {
      metis++;
      if (metis > 1 || !ix.keys.some((key) => key.isSigner && key.pubkey.equals(payer)) ||
          !ix.keys.some((key) => key.isWritable && key.pubkey.equals(outputAta))) {
        fail("metis_identity_or_output_invalid");
      }
    } else fail("unapproved_program");
  }
  if (metis !== 1) fail("metis_route_missing");
  if (wrappedTransfers !== input) fail("wrapped_sol_funding_not_exact_input");
  if (priorityPrice !== null &&
      (BigInt(computeUnits ?? MAX_COMPUTE_UNITS) * priorityPrice + 999_999n) / 1_000_000n > 500_000n) {
    fail("priority_fee_exceeded");
  }
  return programs;
}

function accountAt(values: readonly (AccountInfo<Buffer> | null)[], index: number,
  label: string): AccountInfo<Buffer> {
  const value = values[index];
  if (!value || value.executable) fail(`${label}_account_missing_or_executable`);
  return value;
}

function simulatedAccountAt(values: readonly (SimulatedTransactionAccountInfo | null)[],
  index: number, label: string): AccountInfo<Buffer> {
  const value = values[index];
  if (!value || value.executable || !Array.isArray(value.data) ||
      value.data.length !== 2 || value.data[1] !== "base64" ||
      typeof value.data[0] !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data[0])) {
    fail(`${label}_account_missing_or_malformed`);
  }
  const bytes = Buffer.from(value.data[0], "base64");
  if (bytes.toString("base64") !== value.data[0]) fail(`${label}_data_encoding_invalid`);
  return { ...value, owner: new PublicKey(value.owner), data: bytes, rentEpoch: value.rentEpoch ?? 0 };
}

/**
 * Resolve every Jupiter ALT, independently inspect the exact SOL/CHZ accounts,
 * then simulate one unsigned order. This remains inspection-only: fee source
 * provenance, signing, broadcast, and finalized receipt checks are not here.
 */
export async function inspectUnsignedSolToChzSwap(input: {
  plan: JupiterSwapPlan;
  sourceWallet: string;
  connection: SolChzReadConnection;
}): Promise<UnsignedSolToChzPlan> {
  const { plan, connection } = input;
  const source = new PublicKey(input.sourceWallet);
  const sourceWallet = source.toBase58();
  inspectSolanaChzFundingOrder(plan, sourceWallet);
  const amount = BigInt(plan.inputAmountAtomic);
  if (amount > MAX_CHZ_FUNDING_LAMPORTS || plan.router !== "metis") fail("route_or_input_cap_invalid");
  const unsigned = exactUnsignedOrder(plan, sourceWallet);
  if (await sha256Hex(unsigned.message.serialize()) !== plan.transactionMessageHash) {
    fail("transaction_message_digest_mismatch");
  }
  const outputAta = getAssociatedTokenAddressSync(CHZ_MINT, source, false, TOKEN_PROGRAM_ID);
  const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, source, false, TOKEN_PROGRAM_ID);
  const lookupAddresses = unsigned.message.addressTableLookups.map((entry) => entry.accountKey);
  if (lookupAddresses.length > MAX_LOOKUP_TABLES ||
      new Set(lookupAddresses.map((key) => key.toBase58())).size !== lookupAddresses.length) {
    fail("lookup_table_count_or_duplicate_invalid");
  }
  const initialKeys = [source, CHZ_MINT, outputAta, wrappedSolAta, ...lookupAddresses];
  const initial = await connection.getMultipleAccountsInfoAndContext(initialKeys, "finalized");
  if (!Number.isSafeInteger(initial.context.slot) || initial.context.slot <= 0 ||
      initial.value.length !== initialKeys.length) fail("account_snapshot_invalid");
  const sourceInfo = accountAt(initial.value, 0, "source");
  const mintInfo = accountAt(initial.value, 1, "mint");
  const outputInfo = accountAt(initial.value, 2, "output");
  if (initial.value[3] !== null) fail("preexisting_wrapped_sol_ata_not_allowed");
  if (!sourceInfo.owner.equals(SystemProgram.programId) || sourceInfo.data.length !== 0 ||
      BigInt(sourceInfo.lamports) < amount + MAX_OVERHEAD_LAMPORTS) {
    fail("source_balance_or_owner_invalid");
  }
  if (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) || !outputInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    fail("official_chz_mint_or_token_program_invalid");
  }
  const officialMint = unpackMint(CHZ_MINT, mintInfo, TOKEN_PROGRAM_ID);
  if (!officialMint.isInitialized || officialMint.decimals !== 8) {
    fail("official_chz_mint_invalid");
  }
  const output = unpackAccount(outputAta, outputInfo, TOKEN_PROGRAM_ID);
  if (!output.mint.equals(CHZ_MINT) || !output.owner.equals(source) ||
      !output.isInitialized || output.isFrozen) {
    fail("output_ata_uninitialized_or_wrong_owner");
  }
  const tables = lookupAddresses.map((address, index) => {
    const info = accountAt(initial.value, 4 + index, "lookup_table");
    if (!info.owner.equals(AddressLookupTableProgram.programId)) fail("lookup_table_owner_invalid");
    const table = new AddressLookupTableAccount({
      key: address, state: AddressLookupTableAccount.deserialize(info.data),
    });
    if (!table.isActive()) fail("lookup_table_inactive");
    return table;
  });
  let decompiled: TransactionMessage;
  try { decompiled = TransactionMessage.decompile(unsigned.message, { addressLookupTableAccounts: tables }); }
  catch { return fail("lookup_resolution_failed"); }
  const programs = inspectResolvedInstructions(decompiled.instructions, source, outputAta,
    wrappedSolAta, amount);
  // Identify all writable token accounts owned by the treasury. The only
  // allowed ones are the official output ATA and the temporary WSOL ATA.
  const writable = new Map<string, PublicKey>();
  for (const ix of decompiled.instructions) for (const key of ix.keys) {
    if (key.isWritable) writable.set(key.pubkey.toBase58(), key.pubkey);
  }
  if (writable.size > MAX_WRITABLE_ACCOUNTS) fail("writable_account_count_exceeded");
  const writableAddresses = [...writable.values()];
  const writableInfo = await connection.getMultipleAccountsInfoAndContext(writableAddresses,
    { commitment: "finalized", minContextSlot: initial.context.slot });
  if (writableInfo.context.slot < initial.context.slot ||
      writableInfo.value.length !== writableAddresses.length) fail("writable_snapshot_stale");
  for (let index = 0; index < writableAddresses.length; index++) {
    const info = writableInfo.value[index];
    const address = writableAddresses[index];
    if (!info || address.equals(outputAta) || address.equals(wrappedSolAta)) continue;
    if (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      const token = unpackAccount(address, info, info.owner);
      if (token.owner.equals(source)) fail("unapproved_treasury_token_account_writable");
    }
  }
  const blockHeight = await connection.getBlockHeight("finalized");
  if (!Number.isSafeInteger(blockHeight) || plan.lastValidBlockHeight <= blockHeight) {
    fail("order_blockhash_expired");
  }
  const simulation = await connection.simulateTransaction(unsigned, {
    commitment: "finalized", minContextSlot: writableInfo.context.slot,
    sigVerify: false, replaceRecentBlockhash: false,
    accounts: { encoding: "base64", addresses: [sourceWallet, outputAta.toBase58(), wrappedSolAta.toBase58()] },
  });
  if (simulation.context.slot < writableInfo.context.slot || simulation.value.err !== null ||
      !simulation.value.accounts || simulation.value.accounts.length !== 3 ||
      simulation.value.accounts[2] !== null) fail("simulation_failed_or_wrapped_sol_left_open");
  const simulatedSource = simulatedAccountAt(simulation.value.accounts, 0, "simulated_source");
  const simulatedOutput = simulatedAccountAt(simulation.value.accounts, 1, "simulated_output");
  if (!simulatedSource.owner.equals(SystemProgram.programId) ||
      !simulatedOutput.owner.equals(TOKEN_PROGRAM_ID)) fail("simulation_account_owner_changed");
  const simulatedToken = unpackAccount(outputAta, simulatedOutput, TOKEN_PROGRAM_ID);
  if (!simulatedToken.owner.equals(source) || !simulatedToken.mint.equals(CHZ_MINT) ||
      !simulatedToken.isInitialized || simulatedToken.isFrozen) fail("simulation_chz_ata_changed");
  const solBefore = BigInt(sourceInfo.lamports);
  const solAfter = BigInt(simulatedSource.lamports);
  const chzBefore = output.amount;
  const chzAfter = simulatedToken.amount;
  const solDebit = solBefore - solAfter;
  const chzCredit = chzAfter - chzBefore;
  if (solDebit < amount || solDebit > amount + MAX_OVERHEAD_LAMPORTS ||
      chzCredit < BigInt(plan.minimumOutputAtomic) ||
      chzCredit > BigInt(plan.outputAmountAtomic) * 2n ||
      simulation.value.unitsConsumed != null && simulation.value.unitsConsumed > MAX_COMPUTE_UNITS) {
    fail("simulation_balance_delta_out_of_bounds");
  }
  return {
    ...plan,
    sourceWallet,
    outputTokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    outputAta: outputAta.toBase58(),
    wrappedSolAta: wrappedSolAta.toBase58(),
    lookupTableAddresses: lookupAddresses.map((key) => key.toBase58()),
    topLevelPrograms: programs,
    accountSlot: initial.context.slot,
    simulationSlot: simulation.context.slot,
    simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
    simulatedSolBeforeLamports: solBefore.toString(),
    simulatedSolAfterLamports: solAfter.toString(),
    simulatedSolDebitLamports: solDebit.toString(),
    simulatedOverheadLamports: (solDebit - amount).toString(),
    simulatedChzBeforeAtomic: chzBefore.toString(),
    simulatedChzAfterAtomic: chzAfter.toString(),
    simulatedChzCreditAtomic: chzCredit.toString(),
    recentBlockhash: unsigned.message.recentBlockhash,
    executionReady: false,
  };
}

/** Request the Jupiter order and immediately inspect it against Solana RPC. */
export async function prepareUnsignedSolToChzSwap(input: {
  apiKey: string;
  inputLamports: string;
  sourceWallet: string;
  connection: SolChzReadConnection;
  fetcher?: typeof fetch;
}): Promise<UnsignedSolToChzPlan> {
  if (!/^[1-9][0-9]*$/.test(input.inputLamports) ||
      BigInt(input.inputLamports) > MAX_CHZ_FUNDING_LAMPORTS) fail("input_cap_exceeded");
  const plan = await prepareJupiterSwap({
    apiKey: input.apiKey,
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    amountAtomic: input.inputLamports,
    taker: input.sourceWallet,
    fetcher: input.fetcher,
  });
  return inspectUnsignedSolToChzSwap({
    plan, sourceWallet: input.sourceWallet, connection: input.connection,
  });
}
