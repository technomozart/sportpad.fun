import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ed25519 } from "@noble/curves/ed25519";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { padHex } from "viem";
import { buildUnsignedDirectOftFromSnapshot, directOftOptions,
  type DirectOftBuildSnapshot, type UnsignedDirectOftChzTransfer } from
  "./chiliz-direct-oft-build.ts";
import { DIRECT_CHZ_OFT } from "./chiliz-direct-oft.ts";
import { signDirectOftChilizJournal, type DirectOftSigningIntent } from
  "./chiliz-direct-oft-sign.ts";

const keypair = Keypair.fromSeed(new Uint8Array(32).fill(17));
const wallet = keypair.publicKey.toBase58();
const destination = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const escrow = "CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ";
const sourceAta = getAssociatedTokenAddressSync(
  new PublicKey(DIRECT_CHZ_OFT.solanaMint), keypair.publicKey, false,
  TOKEN_PROGRAM_ID).toBase58();
const amount = 100_000_000n;
const minimum = 99_000_000n;
const fee = 345_783n;
const options = directOftOptions(new Uint8Array());
const nowMs = 1_800_000_000_000;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function snapshot(): DirectOftBuildSnapshot {
  const sendData = oft.instructions.getSendInstructionDataSerializer().serialize({
    dstEid: DIRECT_CHZ_OFT.chilizEid,
    to: Buffer.from(padHex(destination, { size: 32 }).slice(2), "hex"),
    amountLd: amount, minAmountLd: minimum, options, composeMsg: null,
    nativeFee: fee, lzTokenFee: 0n,
  });
  return {
    storeMint: DIRECT_CHZ_OFT.solanaMint,
    storeEscrow: escrow,
    storePaused: false,
    peer: padHex(DIRECT_CHZ_OFT.chilizNativeAdapter, { size: 32 }),
    sourceTokenAccount: sourceAta,
    sourceTokenAmountAtomic: amount.toString(),
    messagingFeeLamports: fee,
    lzTokenFee: 0n,
    oftQuote: {
      oftLimits: { minAmountLd: 1n, maxAmountLd: 1_000_000_000n },
      oftFeeDetails: [],
      oftReceipt: { amountSentLd: amount, amountReceivedLd: amount },
    },
    options,
    sendInstruction: new TransactionInstruction({
      programId: new PublicKey(DIRECT_CHZ_OFT.solanaProgram),
      keys: [
        { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: new PublicKey(sourceAta), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(escrow), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaMint), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(DIRECT_CHZ_OFT.solanaStore), isSigner: false, isWritable: true },
      ],
      data: Buffer.from(sendData),
    }),
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
  };
}

async function fixture() {
  const plan = await buildUnsignedDirectOftFromSnapshot({
    amountAtomic: amount.toString(),
    payerSolanaWallet: wallet,
    destinationChilizWallet: destination,
    solanaRpcUrl: "https://solana.example/rpc",
    nowMs,
  }, snapshot());
  const intent: DirectOftSigningIntent = {
    sourceWallet: wallet,
    destinationTreasury: destination,
    sourceAmountAtomic: amount.toString(),
    minimumDestinationWei: (minimum * 10_000_000_000n).toString(),
    quoteId: `oft:${plan.onchainQuoteDigestSha256}`,
  };
  let signerCalls = 0;
  let rpcHeight = 20;
  let rpcCalls = 0;
  const signer = {
    publicKey: wallet,
    signMessage: async (message: Uint8Array): Promise<Uint8Array> => {
      signerCalls++;
      return ed25519.sign(message, keypair.secretKey.subarray(0, 32));
    },
  };
  const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
    rpcCalls++;
    const body = JSON.parse(String(init?.body)) as {
      jsonrpc: string; id: number; method: string; params: unknown[];
    };
    assert.equal(body.method, "getBlockHeight");
    assert.deepEqual(body.params, [{ commitment: "confirmed" }]);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id,
      result: rpcHeight }), { status: 200 });
  };
  const input = {
    id: "direct-oft-sign-test", plan, intent, signer,
    solanaRpcUrl: "https://solana.example/rpc", fetchImpl, nowMs,
  };
  return { input, get signerCalls() { return signerCalls; },
    get rpcCalls() { return rpcCalls; }, setRpcHeight(value: number) { rpcHeight = value; } };
}

function changedMessage(plan: UnsignedDirectOftChzTransfer,
  destinationOverride: string): UnsignedDirectOftChzTransfer {
  const tx = VersionedTransaction.deserialize(Buffer.from(plan.unsignedTransactionBase64, "base64"));
  tx.message.compiledInstructions[0].data = oft.instructions.getSendInstructionDataSerializer()
    .serialize({
      dstEid: DIRECT_CHZ_OFT.chilizEid,
      to: Buffer.from(padHex(destinationOverride as `0x${string}`, { size: 32 }).slice(2), "hex"),
      amountLd: amount, minAmountLd: minimum, options, composeMsg: null,
      nativeFee: fee, lzTokenFee: 0n,
    });
  return {
    ...plan,
    unsignedTransactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    unsignedMessageBase64: Buffer.from(tx.message.serialize()).toString("base64"),
    expectedMessageSha256: hash(tx.message.serialize()),
  };
}

test("signs the exact official message and returns durable journal bytes without broadcasting", async () => {
  const f = await fixture();
  const result = await signDirectOftChilizJournal(f.input);
  assert.equal(f.signerCalls, 1);
  assert.equal(f.rpcCalls, 1);
  assert.equal(result.journal.quoteId, f.input.intent.quoteId);
  assert.equal(result.journal.sourceWallet, wallet);
  assert.equal(result.journal.destinationTreasury, destination.toLowerCase());
  assert.equal(result.journal.routeType, "OFT");
  assert.equal(result.journal.signedTransactionBase64, result.signedTransactionBase64);
  assert.equal(result.journal.sourceSignature, result.sourceSignature);
  const tx = VersionedTransaction.deserialize(Buffer.from(result.signedTransactionBase64, "base64"));
  assert.equal(ed25519.verify(tx.signatures[0], tx.message.serialize(),
    keypair.publicKey.toBytes()), true);
  assert.equal(hash(tx.message.serialize()), f.input.plan.expectedMessageSha256);
});

test("rejects a malicious changed recipient before invoking signer", async () => {
  const f = await fixture();
  await assert.rejects(signDirectOftChilizJournal({ ...f.input,
    plan: changedMessage(f.input.plan, "0x1111111111111111111111111111111111111111"),
  }), /instruction_mismatch/);
  assert.equal(f.signerCalls, 0);
  assert.equal(f.rpcCalls, 0);
});

test("rejects another signer and independently changed amount/minimum/quote", async () => {
  const f = await fixture();
  const other = Keypair.generate().publicKey.toBase58();
  for (const changed of [
    { signer: { ...f.input.signer, publicKey: other } },
    { intent: { ...f.input.intent, sourceAmountAtomic: "200000000" } },
    { intent: { ...f.input.intent, minimumDestinationWei: "950000000000000000" } },
    { intent: { ...f.input.intent, quoteId: `oft:${"f".repeat(64)}` } },
  ]) {
    await assert.rejects(signDirectOftChilizJournal({ ...f.input, ...changed }));
  }
  assert.equal(f.signerCalls, 0);
  assert.equal(f.rpcCalls, 0);
});

test("rejects stale quote expiry before RPC or signing", async () => {
  const f = await fixture();
  await assert.rejects(signDirectOftChilizJournal({ ...f.input,
    plan: { ...f.input.plan, quoteExpiresAtMs: nowMs + 20_000 },
  }), /expired/);
  assert.equal(f.signerCalls, 0);
  assert.equal(f.rpcCalls, 0);
});

test("rejects near-expired blockhash before signing", async () => {
  const f = await fixture();
  f.setRpcHeight(91);
  await assert.rejects(signDirectOftChilizJournal(f.input), /blockhash_stale/);
  assert.equal(f.signerCalls, 0);
  assert.equal(f.rpcCalls, 1);
});

test("rejects a bad signature returned by the signer", async () => {
  const f = await fixture();
  await assert.rejects(signDirectOftChilizJournal({ ...f.input,
    signer: { publicKey: wallet, signMessage: async () => new Uint8Array(64).fill(1) },
  }), /signer_signature_invalid/);
});

test("rejects a forged ALT before invoking signer", async () => {
  const f = await fixture();
  const tx = VersionedTransaction.deserialize(
    Buffer.from(f.input.plan.unsignedTransactionBase64, "base64"));
  tx.message.addressTableLookups.push({
    accountKey: Keypair.generate().publicKey,
    writableIndexes: [], readonlyIndexes: [],
  });
  const plan = {
    ...f.input.plan,
    unsignedTransactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    unsignedMessageBase64: Buffer.from(tx.message.serialize()).toString("base64"),
    expectedMessageSha256: hash(tx.message.serialize()),
  };
  await assert.rejects(signDirectOftChilizJournal({ ...f.input, plan }), /message_mismatch/);
  assert.equal(f.signerCalls, 0);
});
