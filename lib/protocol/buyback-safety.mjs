import {
  ComputeBudgetProgram,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";

// This is intentionally narrower than every route Jupiter can assemble. A route
// that needs another router, program, or writable account owner fails closed.
// Do not turn on the worker lane solely because this validator accepts a quote:
// the swap and burn also require a durable, replay-safe two-stage ledger.
const METIS_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const SOL_MINT = NATIVE_MINT.toBase58();
const MAX_TRADE_LAMPORTS = 100_000_000n;
const MAX_FEE_LAMPORTS = 500_000n;
const MAX_COMPUTE_UNITS = 600_000;

function fail(code) {
  throw new Error(`buyback_${code}`);
}

function atomic(value, code) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) fail(code);
  return BigInt(value);
}

function same(a, b) {
  return a?.toBase58() === b?.toBase58();
}

function instructionFor(message, keys, compiled) {
  const programId = keys.get(compiled.programIdIndex);
  if (!programId) fail("unknown_program_index");
  const ixKeys = [...compiled.accountKeyIndexes].map((index) => {
    const pubkey = keys.get(index);
    if (!pubkey) fail("unknown_account_index");
    return {
      pubkey,
      isSigner: message.isAccountSigner(index),
      isWritable: message.isAccountWritable(index),
    };
  });
  return new TransactionInstruction({ programId, keys: ixKeys, data: Buffer.from(compiled.data) });
}

function validateTopLevelInstruction(ix, context) {
  const { signer, outputAta, wrappedSolAta, maxInput, budget } = context;
  if (same(ix.programId, ComputeBudgetProgram.programId)) {
    const data = ix.data;
    if (data[0] === 2 && data.length === 5) {
      if (budget.units !== null) fail("duplicate_compute_limit");
      budget.units = data.readUInt32LE(1);
      if (budget.units === 0 || budget.units > MAX_COMPUTE_UNITS) fail("compute_limit_exceeded");
      return;
    }
    if (data[0] === 3 && data.length === 9) {
      if (budget.microLamports !== null) fail("duplicate_priority_price");
      budget.microLamports = data.readBigUInt64LE(1);
      if (budget.microLamports > 1_000_000n) fail("priority_price_exceeded");
      return;
    }
    fail("unsupported_compute_instruction");
  }

  if (same(ix.programId, SystemProgram.programId)) {
    if (SystemInstruction.decodeInstructionType(ix) !== "Transfer") fail("unsupported_system_instruction");
    const transfer = SystemInstruction.decodeTransfer(ix);
    if (!same(transfer.fromPubkey, signer) || !same(transfer.toPubkey, wrappedSolAta)) {
      fail("unexpected_sol_transfer");
    }
    const lamports = BigInt(transfer.lamports);
    if (lamports <= 0n || lamports > maxInput) fail("sol_transfer_exceeded");
    budget.solTransfers += lamports;
    if (budget.solTransfers > maxInput) fail("sol_transfer_exceeded");
    return;
  }

  if (same(ix.programId, ASSOCIATED_TOKEN_PROGRAM_ID)) {
    // Only idempotent creation of the signer's deterministic WSOL/output ATA.
    if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) fail("unsupported_ata_instruction");
    const [payer, ata, owner, mint, system, tokenProgram] = ix.keys.map((key) => key.pubkey);
    if (!same(payer, signer) || !same(owner, signer) || !same(system, SystemProgram.programId)) {
      fail("unexpected_ata_authority");
    }
    if (same(ata, wrappedSolAta) && same(mint, NATIVE_MINT) && same(tokenProgram, TOKEN_PROGRAM_ID)) return;
    if (same(ata, outputAta) && same(mint, context.mint) && same(tokenProgram, context.tokenProgram)) return;
    fail("unexpected_ata");
  }

  if (same(ix.programId, TOKEN_PROGRAM_ID)) {
    // SyncNative and closing the signer's WSOL account are the only permitted
    // top-level token instructions. The actual swap must run in pinned Metis.
    if (ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1 && same(ix.keys[0].pubkey, wrappedSolAta)) return;
    if (ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3 &&
      same(ix.keys[0].pubkey, wrappedSolAta) && same(ix.keys[1].pubkey, signer) && same(ix.keys[2].pubkey, signer)) return;
    fail("unsupported_token_instruction");
  }

  if (same(ix.programId, METIS_PROGRAM_ID)) {
    budget.metisInstructions += 1;
    if (budget.metisInstructions > 1 || !ix.keys.some((key) => same(key.pubkey, signer))) {
      fail("unexpected_metis_accounts");
    }
    // The output ATA must be writable in the route itself, not merely present
    // elsewhere in the message.
    if (!ix.keys.some((key) => same(key.pubkey, outputAta) && key.isWritable)) fail("missing_route_output");
    return;
  }

  fail("unapproved_program");
}

function verifyQuote(quote, { signer, mint, amountLamports, maxTradeLamports }) {
  const input = atomic(amountLamports, "invalid_input_amount");
  const cap = BigInt(maxTradeLamports);
  if (input > cap) fail("trade_cap_exceeded");
  if (quote?.router !== "metis" || quote.inputMint !== SOL_MINT || quote.outputMint !== mint.toBase58() ||
    quote.taker !== signer.toBase58() || quote.inAmount !== amountLamports) fail("quote_mismatch");
  const output = atomic(quote.outAmount, "invalid_output_amount");
  if (output < 100n) fail("output_too_small");
  if (quote.priceImpact == null || !["number", "string"].includes(typeof quote.priceImpact)) fail("missing_price_impact");
  const impact = Number(quote.priceImpact);
  if (!Number.isFinite(impact) || Math.abs(impact) > 5) fail("price_impact_exceeded");
  if (typeof quote.requestId !== "string" || !quote.requestId ||
    typeof quote.transaction !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(quote.transaction)) {
    fail("invalid_order_response");
  }
  return { input, minOutput: output * 99n / 100n };
}

async function lookupTables(connection, message) {
  const tables = [];
  for (const lookup of message.addressTableLookups) {
    const response = await connection.getAddressLookupTable(lookup.accountKey);
    const table = response?.value;
    if (!table || !same(table.key, lookup.accountKey) ||
      String(table.state.deactivationSlot) !== "18446744073709551615") fail("lookup_table_unavailable");
    tables.push(table);
  }
  return tables;
}

async function validateWritableAccounts(connection, message, keys, context) {
  const writable = [];
  for (let index = 0; index < keys.length; index += 1) {
    if (message.isAccountWritable(index)) writable.push({ index, key: keys.get(index) });
  }
  if (!writable.some(({ key }) => same(key, context.outputAta))) fail("output_not_writable");
  const accounts = await connection.getMultipleAccountsInfo(writable.map(({ key }) => key), "confirmed");
  if (!Array.isArray(accounts) || accounts.length !== writable.length) fail("writable_accounts_unavailable");
  const snapshot = new Map();
  for (let i = 0; i < writable.length; i += 1) {
    const { key } = writable[i];
    const account = accounts[i];
    snapshot.set(key.toBase58(), account);
    if (same(key, context.signer)) {
      if (!account || !same(account.owner, SystemProgram.programId)) fail("signer_account_changed");
      continue;
    }
    if (!account) {
      // The destination ATA must already exist so we can measure its precise
      // pre-simulation balance. A WSOL ATA may be created by the order.
      if (same(key, context.wrappedSolAta)) continue;
      fail("unknown_writable_account");
    }
    const owner = account.owner.toBase58();
    if (!context.allowedWritableOwners.has(owner)) fail("unapproved_writable_owner");
    if (same(key, context.outputAta) || same(key, context.wrappedSolAta)) {
      const expectedMint = same(key, context.outputAta) ? context.mint : NATIVE_MINT;
      const expectedProgram = same(key, context.outputAta) ? context.tokenProgram : TOKEN_PROGRAM_ID;
      if (!same(account.owner, expectedProgram)) fail("treasury_token_program_changed");
      const decoded = unpackAccount(key, account, expectedProgram);
      if (!same(decoded.mint, expectedMint) || !same(decoded.owner, context.signer)) fail("treasury_token_account_changed");
      continue;
    }
    if (same(account.owner, TOKEN_PROGRAM_ID) || same(account.owner, TOKEN_2022_PROGRAM_ID)) {
      // Never let a route write to another signer-owned token account. Mint
      // accounts are shorter than the base token-account layout.
      if (account.data.length >= 165) {
        const decoded = unpackAccount(key, account, account.owner);
        if (same(decoded.owner, context.signer)) fail("unexpected_signer_token_account");
      }
    }
  }
  return snapshot;
}

function safeLamports(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("unsafe_balance_metadata");
  return BigInt(value);
}

function inspectSimulation(simulated, inspection, snapshot, tokenProgram) {
  const value = simulated?.value;
  if (!value || value.err !== null || !Array.isArray(value.accounts) || value.accounts.length !== 2) {
    fail("simulation_unavailable_or_failed");
  }
  const [simSigner, simOutput] = value.accounts;
  const preSigner = snapshot.get(inspection.signer.toBase58());
  const preOutput = snapshot.get(inspection.outputAta.toBase58());
  if (!simSigner || !simOutput || !preSigner || !preOutput ||
    simSigner.owner !== SystemProgram.programId.toBase58() ||
    simOutput.owner !== tokenProgram.toBase58() ||
    simOutput.data?.[1] !== "base64") fail("simulation_account_mismatch");
  const debit = safeLamports(preSigner.lamports) - safeLamports(simSigner.lamports);
  if (debit < 0n || debit > inspection.maxDebit) fail("simulated_sol_debit_exceeded");
  let postOutput;
  try {
    postOutput = unpackAccount(inspection.outputAta, {
      owner: tokenProgram,
      data: Buffer.from(simOutput.data[0], "base64"),
      lamports: simOutput.lamports,
    }, tokenProgram);
  } catch { fail("simulation_output_invalid"); }
  const preAmount = unpackAccount(inspection.outputAta, preOutput, tokenProgram).amount;
  if (!same(postOutput.owner, inspection.signer) || !same(postOutput.mint, inspection.mint) ||
    postOutput.amount - preAmount < inspection.minOutput) fail("simulated_output_below_minimum");
}

/**
 * Reject a Jupiter order unless its quote, v0 message, signers, instructions,
 * address lookups, writable accounts, and transaction fee fit the buyback lane.
 * This is defense in depth, not permission to run swaps without a durable ledger.
 */
export async function inspectBuybackOrder({
  connection,
  quote,
  signer,
  mint,
  tokenProgram,
  amountLamports,
  maxTradeLamports = MAX_TRADE_LAMPORTS,
  maxFeeLamports = MAX_FEE_LAMPORTS,
  allowedWritableOwners = [],
}) {
  const signerKey = new PublicKey(signer);
  const mintKey = new PublicKey(mint);
  const tokenProgramKey = new PublicKey(tokenProgram);
  const { input, minOutput } = verifyQuote(quote, {
    signer: signerKey, mint: mintKey, amountLamports, maxTradeLamports,
  });
  const outputAta = getAssociatedTokenAddressSync(mintKey, signerKey, false, tokenProgramKey);
  const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, signerKey);
  if (quote.outputTokenAccount && quote.outputTokenAccount !== outputAta.toBase58()) fail("quote_output_account_mismatch");
  let transaction;
  try { transaction = VersionedTransaction.deserialize(Buffer.from(quote.transaction, "base64")); }
  catch { fail("invalid_transaction"); }
  const message = transaction.message;
  if (!Array.isArray(message.addressTableLookups) || message.header.numRequiredSignatures !== 1 ||
    message.header.numReadonlySignedAccounts !== 0 || !same(message.staticAccountKeys[0], signerKey) ||
    transaction.signatures.length !== 1 || transaction.signatures[0].some((byte) => byte !== 0)) {
    fail("unexpected_signer");
  }
  const tables = await lookupTables(connection, message);
  const keys = message.getAccountKeys({ addressLookupTableAccounts: tables });
  const budget = { units: null, microLamports: null, solTransfers: 0n, metisInstructions: 0 };
  const context = { signer: signerKey, mint: mintKey, tokenProgram: tokenProgramKey,
    outputAta, wrappedSolAta, maxInput: input, budget,
    allowedWritableOwners: new Set([
      SystemProgram.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(),
      METIS_PROGRAM_ID.toBase58(), ...allowedWritableOwners,
    ]) };
  for (const compiled of message.compiledInstructions) {
    validateTopLevelInstruction(instructionFor(message, keys, compiled), context);
  }
  if (budget.metisInstructions !== 1) fail("missing_metis_route");
  if (budget.units && budget.microLamports &&
    (BigInt(budget.units) * budget.microLamports + 999_999n) / 1_000_000n > BigInt(maxFeeLamports) - 5_000n) {
    fail("priority_fee_exceeded");
  }
  const snapshot = await validateWritableAccounts(connection, message, keys, context);
  const fee = await connection.getFeeForMessage(message, "confirmed");
  if (fee?.value == null || BigInt(fee.value) > BigInt(maxFeeLamports)) fail("fee_unavailable_or_exceeded");
  const inspection = { transaction, outputAta, minOutput, maxDebit: input + BigInt(maxFeeLamports),
    signer: signerKey, mint: mintKey, accountKeys: keys };
  // Solana permits simulation without a signature. Require its signer balance
  // and output-token deltas, rather than trusting a third-party quote alone.
  const simulated = await connection.simulateTransaction(transaction, {
    commitment: "confirmed", sigVerify: false, replaceRecentBlockhash: false,
    accounts: { encoding: "base64", addresses: [signerKey.toBase58(), outputAta.toBase58()] },
  });
  inspectSimulation(simulated, inspection, snapshot, tokenProgramKey);
  return inspection;
}

/** Validate a confirmed swap receipt before attributing output to a burn. */
export function inspectBuybackSettlement(receipt, inspection) {
  if (!receipt?.meta || receipt.meta.err !== null) fail("swap_not_confirmed");
  const keys = inspection.accountKeys;
  let outputIndex = -1;
  for (let index = 0; index < keys.length; index += 1) {
    if (same(keys.get(index), inspection.outputAta)) outputIndex = index;
  }
  if (outputIndex < 0 || !Array.isArray(receipt.meta.preBalances) || !Array.isArray(receipt.meta.postBalances)) {
    fail("receipt_accounts_missing");
  }
  const preLamports = receipt.meta.preBalances[0];
  const postLamports = receipt.meta.postBalances[0];
  if (![preLamports, postLamports].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    fail("unsafe_balance_metadata");
  }
  const debit = BigInt(preLamports) - BigInt(postLamports);
  if (debit < 0n || debit > inspection.maxDebit) fail("actual_sol_debit_exceeded");
  const tokenBalance = (entries) => {
    const row = entries?.find((entry) => entry.accountIndex === outputIndex &&
      entry.mint === inspection.mint.toBase58() && entry.owner === inspection.signer.toBase58());
    if (!row && entries?.some((entry) => entry.accountIndex === outputIndex)) fail("output_token_identity_changed");
    if (row && !/^[0-9]+$/.test(row.uiTokenAmount?.amount ?? "")) fail("invalid_output_balance");
    return row ? BigInt(row.uiTokenAmount.amount) : 0n;
  };
  const purchased = tokenBalance(receipt.meta.postTokenBalances) - tokenBalance(receipt.meta.preTokenBalances);
  if (purchased < inspection.minOutput || purchased <= 0n) fail("actual_output_below_minimum");
  return { purchased, debit };
}

/** The burn is verified from its own transaction meta, never global supply. */
export function inspectBuybackBurnReceipt(receipt, { signature, outputAta, mint, signer, amount }) {
  if (!receipt?.meta || receipt.meta.err !== null ||
    receipt.transaction?.signatures?.[0] !== signature) fail("burn_not_confirmed");
  const keys = receipt.transaction.message?.accountKeys;
  if (!Array.isArray(keys)) fail("burn_accounts_missing");
  const accountIndex = keys.findIndex((key) => same(key, outputAta));
  if (accountIndex < 0) fail("burn_output_account_missing");
  const balance = (entries) => {
    const row = entries?.find((entry) => entry.accountIndex === accountIndex &&
      entry.mint === mint.toBase58() && entry.owner === signer.toBase58());
    if (!row || !/^[0-9]+$/.test(row.uiTokenAmount?.amount ?? "")) fail("burn_token_balance_missing");
    return BigInt(row.uiTokenAmount.amount);
  };
  const pre = balance(receipt.meta.preTokenBalances);
  const post = balance(receipt.meta.postTokenBalances);
  if (pre - post !== BigInt(amount)) fail("burn_delta_mismatch");
  return { burned: BigInt(amount) };
}

export const buybackSafetyLimits = Object.freeze({
  maxTradeLamports: MAX_TRADE_LAMPORTS,
  maxFeeLamports: MAX_FEE_LAMPORTS,
  router: METIS_PROGRAM_ID.toBase58(),
});
