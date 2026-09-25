import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";

/**
 * Narrow Borsh reader for Jupiter V6 JUP6, using the official IDL's
 * `route` / `sharedAccountsRoute` and `Swap` enum layouts (reviewed 2026-09-25):
 * https://github.com/jup-ag/instruction-parser/blob/main/src/idl/jupiter.ts
 * The official parser README maps JUP6Lkb... to V6 parser version 6.0.7.
 * https://github.com/jup-ag/instruction-parser#npm
 * No fallback to guessed offsets or trailing-field scanning is allowed.
 */
const METIS_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const CHZ_MINT = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const ROUTE_DISCRIMINATOR = Uint8Array.from([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a]);
const SHARED_ROUTE_DISCRIMINATOR = Uint8Array.from([0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81]);
const MAX_STEPS = 8;
const MAX_INSTRUCTION_BYTES = 1_024;
const MAX_SLIPPAGE_BPS = 100;

export type VerifiedJupiterEmbeddedMinOut = {
  readonly instructionVariant: "route" | "sharedAccountsRoute";
  readonly routeSteps: number;
  readonly inputAmountAtomic: string;
  readonly quotedOutputAtomic: string;
  readonly slippageBps: number;
  readonly embeddedMinimumOutputAtomic: string;
  readonly platformFeeBps: 0;
};

function fail(code: string): never { throw new Error(`jupiter_metis_min_out_${code}`); }

function atomic(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) fail(`${label}_invalid`);
  return BigInt(value);
}

class Reader {
  private offset = 0;
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }
  get consumed() { return this.offset; }
  get length() { return this.data.length; }
  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) {
      fail("truncated_instruction_data");
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u8(): number { return this.bytes(1)[0]; }
  u16(): number {
    const bytes = this.bytes(2);
    return bytes[0] | bytes[1] << 8;
  }
  u32(): number {
    const bytes = this.bytes(4);
    return (bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24) >>> 0;
  }
  u64(): bigint {
    const bytes = this.bytes(8);
    let value = 0n;
    for (let index = 7; index >= 0; index--) value = value * 256n + BigInt(bytes[index]);
    return value;
  }
  bool(): void {
    if (this.u8() > 1) fail("noncanonical_bool_or_side");
  }
}

// Payload sizes/variants are copied from the official JUP6 Swap enum in the
// pinned V6 IDL. Unknown future variants fail closed. The only variable case
// (WhirlpoolSwapV2, tag 47) is parsed separately.
const ONE_BYTE_VARIANTS = new Set([
  8, 12, 15, 16, 17, 18, 21, 23, 24, 27, 28, 39, 58, 60, 61,
]);
const FOUR_BYTE_VARIANTS = new Set([33, 41]);
const FIVE_BYTE_VARIANTS = new Set([44, 45]);
const ZERO_BYTE_VARIANTS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14, 19, 20, 22,
  25, 26, 30, 31, 32, 34, 35, 36, 37, 38, 40, 46, 48, 49, 50,
  51, 52, 53, 54, 55, 56, 57, 59,
]);

function readSwapVariant(reader: Reader): void {
  const tag = reader.u8();
  if (ZERO_BYTE_VARIANTS.has(tag)) return;
  if (ONE_BYTE_VARIANTS.has(tag)) { reader.bool(); return; }
  if (FOUR_BYTE_VARIANTS.has(tag)) { reader.u32(); return; }
  if (FIVE_BYTE_VARIANTS.has(tag)) { reader.u8(); reader.u32(); return; }
  if (tag === 29) { reader.u64(); reader.u64(); return; } // Symmetry.
  if (tag === 42) { reader.u8(); reader.bool(); reader.bool(); return; } // Clone.
  if (tag === 43) { reader.u8(); reader.u8(); reader.u32(); reader.u32(); return; } // SanctumS.
  if (tag === 47) { // WhirlpoolSwapV2: bool, Option<RemainingAccountsInfo>.
    reader.bool();
    const option = reader.u8();
    if (option === 0) return;
    if (option !== 1) fail("remaining_accounts_option_invalid");
    const count = reader.u32();
    if (count > 8) fail("remaining_accounts_count_exceeded");
    for (let index = 0; index < count; index++) {
      reader.bool(); // AccountsType enum TransferHookA / TransferHookB.
      reader.u8(); // RemainingAccountsSlice.length.
    }
    return;
  }
  fail("unsupported_swap_variant");
}

function exactAccount(ix: TransactionInstruction, index: number, expected: PublicKey,
  signer = false, writable = false): void {
  const meta = ix.keys[index];
  if (!meta || !meta.pubkey.equals(expected) || signer && !meta.isSigner ||
      writable && !meta.isWritable) fail("route_account_identity_invalid");
}

/**
 * Prove the transaction's actual JUP6 route instruction embeds a min-out at
 * least as high as the separately journaled minimum, before treasury signing.
 * Unsupported variants do not get a waiver; they must not be signed here.
 */
export function verifyJupiterMetisEmbeddedMinOut(input: {
  instruction: TransactionInstruction;
  configuredRewardTreasury: string;
  inputAmountAtomic: string;
  quotedOutputAtomic: string;
  journalMinimumOutputAtomic: string;
}): VerifiedJupiterEmbeddedMinOut {
  let source: PublicKey;
  try { source = new PublicKey(input.configuredRewardTreasury); }
  catch { return fail("reward_treasury_invalid"); }
  if (source.toBase58() !== input.configuredRewardTreasury ||
      !input.instruction.programId.equals(METIS_PROGRAM_ID) ||
      input.instruction.data.length < 28 ||
      input.instruction.data.length > MAX_INSTRUCTION_BYTES) fail("program_or_data_invalid");
  const inputAtomic = atomic(input.inputAmountAtomic, "input_amount");
  const quotedAtomic = atomic(input.quotedOutputAtomic, "quoted_output");
  const journalMinimum = atomic(input.journalMinimumOutputAtomic, "journal_minimum");
  if (journalMinimum > quotedAtomic) fail("journal_minimum_exceeds_quote");
  const outputAta = getAssociatedTokenAddressSync(CHZ_MINT, source, false, TOKEN_PROGRAM_ID);
  const sourceAta = getAssociatedTokenAddressSync(NATIVE_MINT, source, false, TOKEN_PROGRAM_ID);
  const reader = new Reader(input.instruction.data);
  const discriminator = reader.bytes(8);
  let variant: VerifiedJupiterEmbeddedMinOut["instructionVariant"];
  if (discriminator.every((byte, index) => byte === ROUTE_DISCRIMINATOR[index])) {
    variant = "route";
    exactAccount(input.instruction, 0, TOKEN_PROGRAM_ID);
    exactAccount(input.instruction, 1, source, true);
    exactAccount(input.instruction, 2, sourceAta, false, true);
    exactAccount(input.instruction, 3, outputAta, false, true);
    exactAccount(input.instruction, 5, CHZ_MINT);
  } else if (discriminator.every((byte, index) => byte === SHARED_ROUTE_DISCRIMINATOR[index])) {
    variant = "sharedAccountsRoute";
    exactAccount(input.instruction, 0, TOKEN_PROGRAM_ID);
    exactAccount(input.instruction, 2, source, true);
    exactAccount(input.instruction, 3, sourceAta, false, true);
    exactAccount(input.instruction, 6, outputAta, false, true);
    exactAccount(input.instruction, 7, NATIVE_MINT);
    exactAccount(input.instruction, 8, CHZ_MINT);
    reader.u8(); // Shared-accounts id.
  } else fail("unsupported_instruction_variant");
  const count = reader.u32();
  if (count === 0 || count > MAX_STEPS) fail("route_step_count_invalid");
  for (let index = 0; index < count; index++) {
    readSwapVariant(reader);
    const percent = reader.u8();
    const inputIndex = reader.u8();
    const outputIndex = reader.u8();
    if (percent === 0 || percent > 100 || inputIndex > 16 || outputIndex > 16 ||
        inputIndex === outputIndex) fail("route_step_invalid");
  }
  const embeddedInput = reader.u64();
  const embeddedQuote = reader.u64();
  const slippageBps = reader.u16();
  const platformFeeBps = reader.u8();
  if (reader.consumed !== reader.length) fail("noncanonical_trailing_instruction_bytes");
  if (embeddedInput !== inputAtomic || embeddedQuote !== quotedAtomic ||
      slippageBps > MAX_SLIPPAGE_BPS || platformFeeBps !== 0) {
    fail("embedded_quote_input_or_policy_mismatch");
  }
  const embeddedMinimum = embeddedQuote * BigInt(10_000 - slippageBps) / 10_000n;
  if (embeddedMinimum < journalMinimum) fail("embedded_minimum_below_journal_minimum");
  return {
    instructionVariant: variant,
    routeSteps: count,
    inputAmountAtomic: embeddedInput.toString(),
    quotedOutputAtomic: embeddedQuote.toString(),
    slippageBps,
    embeddedMinimumOutputAtomic: embeddedMinimum.toString(),
    platformFeeBps: 0,
  };
}
