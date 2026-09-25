import test from "node:test";
import assert from "node:assert/strict";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AddressLookupTableAccount, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { padHex } from "viem";
import { DIRECT_CHZ_OFT } from "./chiliz-direct-oft.ts";
import {
  assertExactDirectOftSendInstruction,
  buildUnsignedDirectOftFromSnapshot,
  directOftOptions,
  minimumDirectOftReceiveAtomic,
  type DirectOftBuildSnapshot,
} from "./chiliz-direct-oft-build.ts";

const payer = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const destination = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const escrow = "CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ";
const sourceAta = getAssociatedTokenAddressSync(
  new PublicKey(DIRECT_CHZ_OFT.solanaMint), new PublicKey(payer), false, TOKEN_PROGRAM_ID,
).toBase58();
const amountAtomic = "100000000";
const minimumAtomic = "99000000";
const nativeFee = 345783n;
const options = directOftOptions(new Uint8Array());
const to = Buffer.from(padHex(destination, { size: 32 }).slice(2), "hex");

function sendInstruction(overrides: {
  dstEid?: number; to?: Uint8Array; amountLd?: bigint; minAmountLd?: bigint;
  nativeFee?: bigint; programId?: string; signer?: string;
} = {}): TransactionInstruction {
  const data = oft.instructions.getSendInstructionDataSerializer().serialize({
    dstEid: overrides.dstEid ?? DIRECT_CHZ_OFT.chilizEid,
    to: overrides.to ?? to,
    amountLd: overrides.amountLd ?? BigInt(amountAtomic),
    minAmountLd: overrides.minAmountLd ?? BigInt(minimumAtomic),
    options,
    composeMsg: null,
    nativeFee: overrides.nativeFee ?? nativeFee,
    lzTokenFee: 0n,
  });
  return new TransactionInstruction({
    programId: new PublicKey(overrides.programId ?? DIRECT_CHZ_OFT.solanaProgram),
    keys: [
      { pubkey: new PublicKey(overrides.signer ?? payer), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(sourceAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(escrow), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaMint), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaStore), isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

function snapshot(overrides: Partial<DirectOftBuildSnapshot> = {}): DirectOftBuildSnapshot {
  return {
    storeMint: DIRECT_CHZ_OFT.solanaMint,
    storeEscrow: escrow,
    storePaused: false,
    peer: padHex(DIRECT_CHZ_OFT.chilizNativeAdapter, { size: 32 }),
    sourceTokenAccount: sourceAta,
    sourceTokenAmountAtomic: "100000000",
    messagingFeeLamports: nativeFee,
    lzTokenFee: 0n,
    oftQuote: {
      oftLimits: { minAmountLd: 1n, maxAmountLd: 1000000000n },
      oftFeeDetails: [],
      oftReceipt: { amountSentLd: 100000000n, amountReceivedLd: 100000000n },
    },
    options,
    sendInstruction: sendInstruction(),
    lookupTable: new AddressLookupTableAccount({
      key: new PublicKey(DIRECT_CHZ_OFT.solanaAddressLookupTable),
      state: {
        deactivationSlot: 0xffff_ffff_ffff_ffffn,
        lastExtendedSlot: 1,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [],
      },
    }),
    blockhash: { blockhash: escrow, lastValidBlockHeight: 100 },
    ...overrides,
  };
}

const request = {
  amountAtomic,
  payerSolanaWallet: payer,
  destinationChilizWallet: destination,
  solanaRpcUrl: "https://api.mainnet-beta.solana.com/",
  nowMs: 1_800_000_000_000,
};

test("unsigned direct OFT plan binds recipient, quote, message and payout minimum", async () => {
  const result = await buildUnsignedDirectOftFromSnapshot(request, snapshot());
  assert.equal(result.sourceTokenAccount, sourceAta);
  assert.equal(result.destinationTreasury, destination);
  assert.equal(result.sourceAmountAtomic, amountAtomic);
  assert.equal(result.minimumReceiveAtomic, minimumAtomic);
  assert.equal(result.minimumDestinationWei, "990000000000000000");
  assert.equal(result.messagingFeeLamports, nativeFee.toString());
  assert.match(result.onchainQuoteDigestSha256, /^[0-9a-f]{64}$/);
  assert.match(result.expectedMessageSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(result.onchainQuoteDigestSha256, result.expectedMessageSha256);
  assert.equal(result.quoteExpiresAtMs, request.nowMs + 60_000);
  assert.equal(result.executionReady, false);
  assert.equal(Buffer.from(result.unsignedMessageBase64, "base64").length > 0, true);
});

test("unsigned direct OFT plan rejects substituted recipient or source amount", async () => {
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sendInstruction: sendInstruction({ to: Buffer.alloc(32) }),
  })));
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sendInstruction: sendInstruction({ amountLd: 200000000n }),
  })));
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sendInstruction: sendInstruction({ minAmountLd: 1n }),
  })));
});

test("unsigned direct OFT plan rejects substituted signer, program, fee and ATA", async () => {
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sendInstruction: sendInstruction({ signer: escrow }),
  })));
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sendInstruction: sendInstruction({ programId: TOKEN_PROGRAM_ID.toBase58() }),
  })));
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sendInstruction: sendInstruction({ nativeFee: nativeFee + 1n }),
  })));
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sourceTokenAccount: escrow,
  })));
});

test("unsigned direct OFT plan rejects unbacked quotes and inactive ALT", async () => {
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    sourceTokenAmountAtomic: "1",
  })));
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    oftQuote: {
      oftLimits: { minAmountLd: 1n, maxAmountLd: 1000000000n },
      oftFeeDetails: [],
      oftReceipt: { amountSentLd: 100000000n, amountReceivedLd: 90000000n },
    },
  })));
  const alt = snapshot().lookupTable;
  await assert.rejects(buildUnsignedDirectOftFromSnapshot(request, snapshot({
    lookupTable: new AddressLookupTableAccount({
      key: alt.key,
      state: { ...alt.state, deactivationSlot: 1n },
    }),
  })));
});

test("receive minimum is bounded and exact send instruction is decoded", () => {
  assert.equal(Buffer.from(options).toString("hex"),
    "00030100110100000000000000000000000000030d40");
  assert.equal(minimumDirectOftReceiveAtomic("100000000"), "99000000");
  assert.throws(() => minimumDirectOftReceiveAtomic("100000000", "94000000"));
  assert.throws(() => minimumDirectOftReceiveAtomic("100000000", "100000001"));
  assert.doesNotThrow(() => assertExactDirectOftSendInstruction({
    instruction: sendInstruction(), payer, sourceAta, escrow, destination,
    amountAtomic, minimumAtomic, options, messagingFeeLamports: nativeFee.toString(),
  }));
});
