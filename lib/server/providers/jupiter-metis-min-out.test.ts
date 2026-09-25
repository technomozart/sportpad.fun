import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import { verifyJupiterMetisEmbeddedMinOut } from "./jupiter-metis-min-out.ts";

const treasury = Keypair.fromSeed(new Uint8Array(32).fill(67)).publicKey;
const other = Keypair.fromSeed(new Uint8Array(32).fill(68)).publicKey;
const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const outputAta = getAssociatedTokenAddressSync(mint, treasury, false, TOKEN_PROGRAM_ID);
const sourceAta = getAssociatedTokenAddressSync(NATIVE_MINT, treasury, false, TOKEN_PROGRAM_ID);
const metis = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

function u64(value: bigint): number[] {
  return Array.from({ length: 8 }, (_, index) => Number(value >> BigInt(index * 8) & 255n));
}

function instruction(options: {
  shared?: boolean;
  swapTag?: number;
  variantData?: number[];
  quote?: bigint;
  slippage?: number;
  platformFee?: number;
  trailing?: number[];
  output?: PublicKey;
} = {}): TransactionInstruction {
  const shared = options.shared ?? true;
  const discriminator = shared
    ? [0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81]
    : [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];
  const data = Buffer.from([
    ...discriminator,
    ...(shared ? [1] : []), // shared-accounts id
    1, 0, 0, 0, // one route-plan step
    options.swapTag ?? 7, // Raydium, payload-free in official JUP6 IDL
    ...(options.variantData ?? []),
    100, 0, 1, // percent, input token index, output token index
    ...u64(10_000_000n),
    ...u64(options.quote ?? 6_000_000n),
    (options.slippage ?? 100) & 255,
    (options.slippage ?? 100) >> 8,
    options.platformFee ?? 0,
    ...(options.trailing ?? []),
  ]);
  const meta = (pubkey: PublicKey, isSigner = false, isWritable = false) =>
    ({ pubkey, isSigner, isWritable });
  const keys = shared ? [
    meta(TOKEN_PROGRAM_ID), meta(other), meta(treasury, true), meta(sourceAta, false, true),
    meta(other), meta(other), meta(options.output ?? outputAta, false, true),
    meta(NATIVE_MINT), meta(mint),
  ] : [
    meta(TOKEN_PROGRAM_ID), meta(treasury, true), meta(sourceAta, false, true),
    meta(options.output ?? outputAta, false, true), meta(other), meta(mint),
  ];
  return new TransactionInstruction({ programId: metis, keys, data });
}

function verify(ix: TransactionInstruction, minimum = "5900000") {
  return verifyJupiterMetisEmbeddedMinOut({
    instruction: ix, configuredRewardTreasury: treasury.toBase58(),
    inputAmountAtomic: "10000000", quotedOutputAtomic: "6000000",
    journalMinimumOutputAtomic: minimum,
  });
}

test("decodes pinned sharedAccountsRoute and proves embedded floor min-out", () => {
  const result = verify(instruction());
  assert.equal(result.instructionVariant, "sharedAccountsRoute");
  assert.equal(result.routeSteps, 1);
  assert.equal(result.embeddedMinimumOutputAtomic, "5940000");
  assert.equal(result.slippageBps, 100);
});

test("also decodes pinned route variant", () => {
  const result = verify(instruction({ shared: false }));
  assert.equal(result.instructionVariant, "route");
  assert.equal(result.embeddedMinimumOutputAtomic, "5940000");
});

test("rejects embedded min-out below the journaled minimum", () => {
  assert.throws(() => verify(instruction(), "5940001"), /embedded_minimum_below_journal_minimum/);
  assert.throws(() => verify(instruction({ slippage: 101 })), /embedded_quote_input_or_policy_mismatch/);
  assert.throws(() => verify(instruction({ platformFee: 1 })), /embedded_quote_input_or_policy_mismatch/);
});

test("rejects unsupported swap tag, trailing data and wrong output ATA", () => {
  assert.throws(() => verify(instruction({ swapTag: 255 })), /unsupported_swap_variant/);
  assert.throws(() => verify(instruction({ trailing: [9] })), /noncanonical_trailing_instruction_bytes/);
  assert.throws(() => verify(instruction({ output: other })), /route_account_identity_invalid/);
});

test("parses official WhirlpoolSwapV2 optional remaining accounts shape", () => {
  const result = verify(instruction({ swapTag: 47, variantData: [1, 1, 1, 0, 0, 0, 0, 2] }));
  assert.equal(result.embeddedMinimumOutputAtomic, "5940000");
  assert.throws(() => verify(instruction({ swapTag: 47, variantData: [1, 2] })),
    /remaining_accounts_option_invalid/);
});
