import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type SignatureStatus,
  type TransactionResponse,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/** Pure checks over finalized RPC evidence. The caller must fetch both the
 * transaction at `finalized` commitment and its signature status from a
 * trusted Solana RPC, then compare the returned evidence to the persisted job.
 * No worker-reported amount or transaction hash is accepted on its own. */
export type SolanaAutomationReceipt = TransactionResponse | VersionedTransactionResponse;

type ReceiptEvidence = {
  signature: string;
  receipt: SolanaAutomationReceipt | null;
  status: SignatureStatus | null;
};

type ExpectedToken = {
  mint: string;
  tokenProgram: string;
  decimals: number;
};

type AccountKey = { key: PublicKey; signer: boolean; writable: boolean };
type Instruction = { program: PublicKey; accounts: PublicKey[]; data: Uint8Array };

const METIS_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const MAX_BUYBACK_INPUT_LAMPORTS = 100_000_000n;
const MAX_BUYBACK_FEE_LAMPORTS = 500_000n;
const MAX_U64 = 18_446_744_073_709_551_615n;

function reject(code: string): never {
  throw new Error(`solana_receipt_${code}`);
}

function key(value: string, code: string): PublicKey {
  try { return new PublicKey(value); }
  catch { return reject(code); }
}

function positiveAtomic(value: string, code: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) return reject(code);
  const parsed = BigInt(value);
  if (parsed > MAX_U64) return reject(code);
  return parsed;
}

function tokenContext(input: ExpectedToken) {
  const mint = key(input.mint, "mint_invalid");
  const tokenProgram = key(input.tokenProgram, "token_program_invalid");
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    reject("token_program_unsupported");
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 255) {
    reject("decimals_invalid");
  }
  return { mint, tokenProgram };
}

function finalized(evidence: ReceiptEvidence): SolanaAutomationReceipt {
  const { signature, receipt, status } = evidence;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature)) reject("signature_invalid");
  if (!status || status.err !== null || status.confirmationStatus !== "finalized") reject("not_finalized");
  if (!receipt || !receipt.meta || receipt.meta.err !== null ||
    receipt.transaction.signatures[0] !== signature || receipt.slot !== status.slot) {
    reject("transaction_mismatch_or_failed");
  }
  return receipt;
}

function accountKeys(receipt: SolanaAutomationReceipt): AccountKey[] {
  const message = receipt.transaction.message as unknown as {
    accountKeys?: PublicKey[];
    staticAccountKeys?: PublicKey[];
    header: { numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number };
  };
  const staticKeys = message.staticAccountKeys ?? message.accountKeys;
  if (!Array.isArray(staticKeys) || !staticKeys.length) reject("account_keys_missing");
  const loaded = receipt.meta?.loadedAddresses;
  const all = [...staticKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
  if (!all.every((entry) => entry instanceof PublicKey)) reject("account_keys_invalid");
  return all.map((entry, index) => ({
    key: entry,
    signer: index < message.header.numRequiredSignatures,
    writable: index < message.header.numRequiredSignatures - message.header.numReadonlySignedAccounts ||
      (index >= message.header.numRequiredSignatures && index < staticKeys.length - message.header.numReadonlyUnsignedAccounts) ||
      (index >= staticKeys.length && index < staticKeys.length + (loaded?.writable.length ?? 0)),
  }));
}

function onlySigner(keys: AccountKey[], signer: PublicKey) {
  if (!keys[0]?.key.equals(signer) || !keys[0].signer || keys.filter((entry) => entry.signer).length !== 1) {
    reject("unexpected_signer");
  }
}

function instructions(receipt: SolanaAutomationReceipt, keys: AccountKey[]): Instruction[] {
  const message = receipt.transaction.message as unknown as {
    instructions?: Array<{ programIdIndex: number; accounts: number[]; data: string }>;
    compiledInstructions?: Array<{ programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array }>;
  };
  const compiled = message.compiledInstructions ?? message.instructions;
  if (!Array.isArray(compiled)) reject("instructions_missing");
  return compiled.map((item) => {
    const indices = "accountKeyIndexes" in item ? item.accountKeyIndexes : item.accounts;
    const program = keys[item.programIdIndex]?.key;
    const accounts = Array.from(indices, (index) => keys[index]?.key);
    if (!program || accounts.some((entry) => !entry)) reject("instruction_account_missing");
    let data: Uint8Array;
    try { data = typeof item.data === "string" ? bs58.decode(item.data) : Uint8Array.from(item.data); }
    catch { return reject("instruction_data_invalid"); }
    return { program, accounts: accounts as PublicKey[], data };
  });
}

function amountFromData(data: Uint8Array, discriminator: number, decimals: number) {
  if (data.length !== 10 || data[0] !== discriminator || data[9] !== decimals) reject("instruction_data_mismatch");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
}

function balanceAt(receipt: SolanaAutomationReceipt, side: "pre" | "post", index: number,
  mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey, decimals: number, allowMissing = false): bigint {
  const rows = side === "pre" ? receipt.meta?.preTokenBalances : receipt.meta?.postTokenBalances;
  if (!Array.isArray(rows)) reject("token_balance_metadata_missing");
  const matchingIndex = rows.filter((row) => row.accountIndex === index);
  if (matchingIndex.length === 0 && allowMissing) return 0n;
  if (matchingIndex.length !== 1) reject("token_balance_row_missing_or_ambiguous");
  const row = matchingIndex[0];
  if (row.mint !== mint.toBase58() || row.owner !== owner.toBase58() ||
    (row.programId && row.programId !== tokenProgram.toBase58()) ||
    row.uiTokenAmount.decimals !== decimals || !/^[0-9]+$/.test(row.uiTokenAmount.amount)) {
    reject("token_balance_identity_mismatch");
  }
  return BigInt(row.uiTokenAmount.amount);
}

function indexOf(keys: AccountKey[], value: PublicKey) {
  const index = keys.findIndex(({ key: candidate }) => candidate.equals(value));
  if (index < 0) reject("account_missing");
  return index;
}

function isCompute(instruction: Instruction) {
  return instruction.program.equals(ComputeBudgetProgram.programId);
}

function isExpectedAtaCreate(instruction: Instruction, payer: PublicKey, owner: PublicKey,
  mint: PublicKey, ata: PublicKey, tokenProgram: PublicKey) {
  return instruction.program.equals(ASSOCIATED_TOKEN_PROGRAM_ID) &&
    instruction.data.length === 1 && instruction.data[0] === 1 && instruction.accounts.length === 6 &&
    instruction.accounts[0].equals(payer) && instruction.accounts[1].equals(ata) &&
    instruction.accounts[2].equals(owner) && instruction.accounts[3].equals(mint) &&
    instruction.accounts[4].equals(SystemProgram.programId) && instruction.accounts[5].equals(tokenProgram);
}

export function verifySolanaClaimPayoutReceipt(input: ReceiptEvidence & ExpectedToken & {
  treasury: string;
  recipient: string;
  amountAtomic: string;
}) {
  const receipt = finalized(input);
  const { mint, tokenProgram } = tokenContext(input);
  const treasury = key(input.treasury, "treasury_invalid");
  const recipient = key(input.recipient, "recipient_invalid");
  if (!PublicKey.isOnCurve(recipient.toBytes()) || treasury.equals(recipient)) reject("recipient_invalid");
  const amount = positiveAtomic(input.amountAtomic, "amount_invalid");
  const source = getAssociatedTokenAddressSync(mint, treasury, false, tokenProgram);
  const destination = getAssociatedTokenAddressSync(mint, recipient, false, tokenProgram);
  const keys = accountKeys(receipt);
  onlySigner(keys, treasury);
  const ix = instructions(receipt, keys);
  let transferCount = 0;
  for (const instruction of ix) {
    if (isCompute(instruction) || isExpectedAtaCreate(instruction, treasury, recipient, mint, destination, tokenProgram)) continue;
    if (!instruction.program.equals(tokenProgram) || instruction.accounts.length !== 4 ||
      !instruction.accounts[0].equals(source) || !instruction.accounts[1].equals(mint) ||
      !instruction.accounts[2].equals(destination) || !instruction.accounts[3].equals(treasury) ||
      amountFromData(instruction.data, 12, input.decimals) !== amount) reject("payout_instruction_mismatch");
    transferCount += 1;
  }
  if (transferCount !== 1) reject("payout_instruction_count");
  const sourceIndex = indexOf(keys, source);
  const destinationIndex = indexOf(keys, destination);
  const sourcePre = balanceAt(receipt, "pre", sourceIndex, mint, treasury, tokenProgram, input.decimals);
  const sourcePost = balanceAt(receipt, "post", sourceIndex, mint, treasury, tokenProgram, input.decimals);
  const destinationPre = balanceAt(receipt, "pre", destinationIndex, mint, recipient, tokenProgram, input.decimals, true);
  const destinationPost = balanceAt(receipt, "post", destinationIndex, mint, recipient, tokenProgram, input.decimals);
  if (sourcePre - sourcePost !== amount || destinationPost - destinationPre !== amount) {
    reject("payout_balance_delta_mismatch");
  }
  return {
    signature: input.signature,
    slot: receipt.slot,
    amountAtomic: amount.toString(),
    sourceTokenAccount: source.toBase58(),
    destinationTokenAccount: destination.toBase58(),
  };
}

function verifySwap(input: ReceiptEvidence & ExpectedToken & {
  treasury: string;
  inputAmountLamports: string;
  purchasedAmountAtomic: string;
}) {
  const receipt = finalized(input);
  const { mint, tokenProgram } = tokenContext(input);
  const treasury = key(input.treasury, "treasury_invalid");
  const amount = positiveAtomic(input.inputAmountLamports, "swap_input_invalid");
  const purchased = positiveAtomic(input.purchasedAmountAtomic, "swap_output_invalid");
  if (amount > MAX_BUYBACK_INPUT_LAMPORTS) reject("swap_input_exceeds_cap");
  const outputAta = getAssociatedTokenAddressSync(mint, treasury, false, tokenProgram);
  const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, treasury);
  const keys = accountKeys(receipt);
  onlySigner(keys, treasury);
  const ix = instructions(receipt, keys);
  let wrappedAmount = 0n;
  let routes = 0;
  for (const instruction of ix) {
    if (isCompute(instruction)) continue;
    if (instruction.program.equals(METIS_PROGRAM_ID)) {
      if (!instruction.accounts.some((account) => account.equals(outputAta)) ||
        !instruction.accounts.some((account) => account.equals(treasury))) reject("swap_route_accounts_mismatch");
      routes += 1;
      continue;
    }
    if (instruction.program.equals(SystemProgram.programId)) {
      if (instruction.data.length !== 12 ||
        new DataView(instruction.data.buffer, instruction.data.byteOffset, 4).getUint32(0, true) !== 2 ||
        instruction.accounts.length !== 2 || !instruction.accounts[0].equals(treasury) ||
        !instruction.accounts[1].equals(wrappedSolAta)) reject("swap_sol_transfer_mismatch");
      wrappedAmount += new DataView(instruction.data.buffer, instruction.data.byteOffset, 12).getBigUint64(4, true);
      continue;
    }
    if (isExpectedAtaCreate(instruction, treasury, treasury, NATIVE_MINT, wrappedSolAta, TOKEN_PROGRAM_ID) ||
      isExpectedAtaCreate(instruction, treasury, treasury, mint, outputAta, tokenProgram)) continue;
    if (instruction.program.equals(TOKEN_PROGRAM_ID) &&
      ((instruction.data.length === 1 && instruction.data[0] === 17 && instruction.accounts.length === 1 &&
        instruction.accounts[0].equals(wrappedSolAta)) ||
       (instruction.data.length === 1 && instruction.data[0] === 9 && instruction.accounts.length === 3 &&
        instruction.accounts[0].equals(wrappedSolAta) && instruction.accounts[1].equals(treasury) &&
        instruction.accounts[2].equals(treasury)))) continue;
    reject("swap_instruction_unapproved");
  }
  if (routes !== 1 || wrappedAmount !== amount) reject("swap_route_or_input_mismatch");
  const preLamports = receipt.meta?.preBalances[0];
  const postLamports = receipt.meta?.postBalances[0];
  if (!Number.isSafeInteger(preLamports) || !Number.isSafeInteger(postLamports) ||
    preLamports! < 0 || postLamports! < 0) reject("swap_lamport_metadata_invalid");
  const debit = BigInt(preLamports!) - BigInt(postLamports!);
  if (debit < 0n || debit > amount + MAX_BUYBACK_FEE_LAMPORTS) reject("swap_sol_debit_exceeds_cap");
  const outputIndex = indexOf(keys, outputAta);
  const before = balanceAt(receipt, "pre", outputIndex, mint, treasury, tokenProgram, input.decimals);
  const after = balanceAt(receipt, "post", outputIndex, mint, treasury, tokenProgram, input.decimals);
  if (after - before !== purchased) reject("swap_output_delta_mismatch");
  return { slot: receipt.slot, purchased, debit, outputAta, mint, tokenProgram, treasury };
}

function verifyBurn(input: ReceiptEvidence & ExpectedToken & {
  treasury: string;
  amountAtomic: string;
}) {
  const receipt = finalized(input);
  const { mint, tokenProgram } = tokenContext(input);
  const treasury = key(input.treasury, "treasury_invalid");
  const amount = positiveAtomic(input.amountAtomic, "burn_amount_invalid");
  const tokenAccount = getAssociatedTokenAddressSync(mint, treasury, false, tokenProgram);
  const keys = accountKeys(receipt);
  onlySigner(keys, treasury);
  const ix = instructions(receipt, keys);
  let burns = 0;
  for (const instruction of ix) {
    if (isCompute(instruction)) continue;
    if (!instruction.program.equals(tokenProgram) || instruction.accounts.length !== 3 ||
      !instruction.accounts[0].equals(tokenAccount) || !instruction.accounts[1].equals(mint) ||
      !instruction.accounts[2].equals(treasury) ||
      amountFromData(instruction.data, 15, input.decimals) !== amount) reject("burn_instruction_mismatch");
    burns += 1;
  }
  if (burns !== 1) reject("burn_instruction_count");
  const index = indexOf(keys, tokenAccount);
  const before = balanceAt(receipt, "pre", index, mint, treasury, tokenProgram, input.decimals);
  const after = balanceAt(receipt, "post", index, mint, treasury, tokenProgram, input.decimals);
  if (before - after !== amount) reject("burn_balance_delta_mismatch");
  return { slot: receipt.slot, amount, tokenAccount };
}

export function verifySportpadBuybackReceipts(input: ExpectedToken & {
  treasury: string;
  inputAmountLamports: string;
  purchasedAmountAtomic: string;
  swap: ReceiptEvidence;
  burn: ReceiptEvidence;
}) {
  if (input.swap.signature === input.burn.signature) reject("swap_and_burn_same_signature");
  const swap = verifySwap({ ...input, ...input.swap });
  const burn = verifyBurn({ ...input, ...input.burn, amountAtomic: input.purchasedAmountAtomic });
  if (burn.slot < swap.slot || burn.amount !== swap.purchased ||
    !burn.tokenAccount.equals(swap.outputAta)) reject("swap_burn_link_mismatch");
  return {
    swapSignature: input.swap.signature,
    burnSignature: input.burn.signature,
    swapSlot: swap.slot,
    burnSlot: burn.slot,
    inputDebitLamports: swap.debit.toString(),
    boughtAndBurnedAtomic: burn.amount.toString(),
    tokenAccount: burn.tokenAccount.toBase58(),
  };
}
