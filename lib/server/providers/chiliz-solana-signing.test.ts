import test from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import {
  getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram,
  Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage,
  VersionedTransaction, type AccountInfo,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { REPLENISHMENT_ASSETS } from "../../protocol/replenishment.ts";
import {
  prepareAndSignOfficialChzAta, prepareAndSignSolToChzSwap,
  type SolanaMessageSigner,
} from "./chiliz-solana-signing.ts";
import type { ChzAtaProvisionReadConnection } from "./chiliz-ata-provision.ts";
import type { SolChzReadConnection } from "./jupiter-sol-chz-plan.ts";

const keypair = Keypair.fromSeed(new Uint8Array(32).fill(52)); // test-only seed.
const treasury = keypair.publicKey;
const other = Keypair.fromSeed(new Uint8Array(32).fill(53)).publicKey;
const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
const outputAta = getAssociatedTokenAddressSync(mint, treasury, false, TOKEN_PROGRAM_ID);
const wrappedAta = getAssociatedTokenAddressSync(NATIVE_MINT, treasury, false, TOKEN_PROGRAM_ID);
const alt = Keypair.fromSeed(new Uint8Array(32).fill(54)).publicKey;
const metis = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(55)).publicKey.toBase58();

function signer(onCall?: () => void): SolanaMessageSigner {
  return { publicKey: treasury, signMessage(message) {
    onCall?.();
    return ed25519.sign(message, keypair.secretKey.slice(0, 32));
  } };
}

function account(owner: PublicKey, data = Buffer.alloc(0), lamports = 1_000_000): AccountInfo<Buffer> {
  return { owner, data, lamports, executable: false, rentEpoch: 0 };
}

function mintData(): Buffer {
  const bytes = Buffer.alloc(82);
  bytes[44] = 8;
  bytes[45] = 1;
  return bytes;
}

function writeU64(bytes: Uint8Array, value: bigint, offset: number): void {
  for (let index = 0; index < 8; index++) bytes[offset + index] = Number(value >> BigInt(index * 8) & 255n);
}

function u64(value: bigint): number[] {
  return Array.from({ length: 8 }, (_, index) => Number(value >> BigInt(index * 8) & 255n));
}

function tokenData(amount: bigint): Buffer {
  const bytes = Buffer.alloc(165);
  bytes.set(mint.toBytes(), 0);
  bytes.set(treasury.toBytes(), 32);
  writeU64(bytes, amount, 64);
  bytes[108] = 1;
  return bytes;
}

function altData(): Buffer {
  const bytes = Buffer.alloc(120);
  bytes[0] = 1;
  writeU64(bytes, 0xffff_ffff_ffff_ffffn, 4);
  writeU64(bytes, 1n, 12);
  bytes.set(outputAta.toBytes(), 56);
  bytes.set(wrappedAta.toBytes(), 88);
  return bytes;
}

function ataRpc(heightSequence = [150]): ChzAtaProvisionReadConnection {
  let heights = 0;
  return {
    async getMultipleAccountsInfoAndContext() {
      return { context: { slot: 100 }, value: [
        account(SystemProgram.programId, Buffer.alloc(0), 50_000_000),
        account(TOKEN_PROGRAM_ID, mintData()), null,
      ] };
    },
    async getMinimumBalanceForRentExemption() { return 2_039_280; },
    async getLatestBlockhashAndContext() {
      return { context: { slot: 101 }, value: { blockhash, lastValidBlockHeight: 200 } };
    },
    async getFeeForMessage() { return { context: { slot: 102 }, value: 5_000 }; },
    async getBlockHeight() { return heightSequence[Math.min(heights++, heightSequence.length - 1)]; },
  } as unknown as ChzAtaProvisionReadConnection;
}

function swapFixture(maliciousTransfer = false, options: {
  minimumOutputAtomic?: string;
  simulatedOutputAtomic?: bigint;
  malformedMetis?: boolean;
} = {}) {
  const table = new AddressLookupTableAccount({ key: alt, state: {
    deactivationSlot: 0xffff_ffff_ffff_ffffn, lastExtendedSlot: 1,
    lastExtendedSlotStartIndex: 0, authority: undefined,
    addresses: [outputAta, wrappedAta],
  } });
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    SystemProgram.transfer({ fromPubkey: treasury, toPubkey: wrappedAta, lamports: 10_000_000 }),
    ...(maliciousTransfer ? [SystemProgram.transfer({
      fromPubkey: treasury, toPubkey: other, lamports: 1_000_000,
    })] : []),
    new TransactionInstruction({ programId: metis, keys: [
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: other, isSigner: false, isWritable: false },
      { pubkey: treasury, isSigner: true, isWritable: true },
      { pubkey: wrappedAta, isSigner: false, isWritable: true },
      { pubkey: other, isSigner: false, isWritable: false },
      { pubkey: other, isSigner: false, isWritable: false },
      { pubkey: outputAta, isSigner: false, isWritable: true },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
    ], data: options.malformedMetis ? Buffer.from([1, 2, 3]) : Buffer.from([
      0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81,
      1, 1, 0, 0, 0, 7, 100, 0, 1,
      ...u64(10_000_000n), ...u64(6_000_000n), 100, 0, 0,
    ]) }),
  ];
  const unsigned = new VersionedTransaction(new TransactionMessage({
    payerKey: treasury, recentBlockhash: blockhash, instructions,
  }).compileToV0Message([table]));
  const payload = {
    inputMint: REPLENISHMENT_ASSETS.solMint,
    outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
    taker: treasury.toBase58(),
    inAmount: "10000000", outAmount: "6000000",
    otherAmountThreshold: options.minimumOutputAtomic ?? "4000000",
    priceImpact: 0.1, swapMode: "ExactIn", slippageBps: 100,
    router: "metis", gasless: false, signatureFeePayer: treasury.toBase58(),
    transaction: Buffer.from(unsigned.serialize()).toString("base64"),
    requestId: "server-fresh-test-order", lastValidBlockHeight: 200,
  };
  const fetcher = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
  const accounts = new Map<string, AccountInfo<Buffer> | null>([
    [treasury.toBase58(), account(SystemProgram.programId, Buffer.alloc(0), 100_000_000)],
    [mint.toBase58(), account(TOKEN_PROGRAM_ID, mintData())],
    [outputAta.toBase58(), account(TOKEN_PROGRAM_ID, tokenData(0n))],
    [wrappedAta.toBase58(), null],
    [alt.toBase58(), account(AddressLookupTableProgram.programId, altData())],
  ]);
  let reads = 0;
  const connection = {
    async getMultipleAccountsInfoAndContext(addresses: PublicKey[]) {
      reads++;
      return { context: { slot: reads === 1 ? 100 : 101 },
        value: addresses.map((address) => accounts.get(address.toBase58()) ?? null) };
    },
    async getBlockHeight() { return 150; },
    async simulateTransaction() { return { context: { slot: 102 }, value: {
      err: null, unitsConsumed: 300_000, accounts: [
        { owner: SystemProgram.programId.toBase58(), executable: false,
          lamports: 89_900_000, data: ["", "base64"] },
        { owner: TOKEN_PROGRAM_ID.toBase58(), executable: false,
          lamports: 1_000_000,
          data: [Buffer.from(tokenData(options.simulatedOutputAtomic ?? 5_000_000n)).toString("base64"), "base64"] },
        null,
      ],
    } }; },
  } as unknown as SolChzReadConnection;
  return { connection, fetcher };
}

test("signs only the exact freshly inspected SOL-to-CHZ Jupiter message", async () => {
  const { connection, fetcher } = swapFixture();
  const result = await prepareAndSignSolToChzSwap({
    apiKey: "test", inputLamports: "10000000",
    configuredRewardTreasury: treasury.toBase58(), connection, signer: signer(), fetcher,
  });
  const signed = VersionedTransaction.deserialize(Buffer.from(result.signedTransactionBase64, "base64"));
  assert.equal(result.plan.outputAta, outputAta.toBase58());
  assert.equal(result.plan.inputAmountAtomic, "10000000");
  assert.equal(result.plan.requestId, "server-fresh-test-order");
  assert.equal(result.plan.executionReady, false);
  assert.equal(result.executionReady, false);
  assert(ed25519.verify(signed.signatures[0], signed.message.serialize(), treasury.toBytes()));
  assert.equal(Buffer.from(signed.message.serialize()).toString("hex"),
    Buffer.from(VersionedTransaction.deserialize(Buffer.from(
      result.plan.transactionBase64, "base64")).message.serialize()).toString("hex"));
});

test("rejects a malicious Jupiter instruction before calling signer", async () => {
  const { connection, fetcher } = swapFixture(true);
  let signed = false;
  await assert.rejects(prepareAndSignSolToChzSwap({
    apiKey: "test", inputLamports: "10000000", configuredRewardTreasury: treasury.toBase58(),
    connection, signer: signer(() => { signed = true; }), fetcher,
  }), /unexpected_sol_transfer|system_transfer_not_exact_wsol_funding/);
  assert.equal(signed, false);
});

test("cannot sign a quote whose embedded Metis minimum is below journal minimum", async () => {
  const { connection, fetcher } = swapFixture(false, {
    minimumOutputAtomic: "5950000", simulatedOutputAtomic: 6_000_000n,
  });
  let signed = false;
  await assert.rejects(prepareAndSignSolToChzSwap({
    apiKey: "test", inputLamports: "10000000", configuredRewardTreasury: treasury.toBase58(),
    connection, signer: signer(() => { signed = true; }), fetcher,
  }), /embedded_minimum_below_journal_minimum/);
  assert.equal(signed, false);
});

test("cannot sign an undecodable Metis route", async () => {
  const { connection, fetcher } = swapFixture(false, { malformedMetis: true });
  let signed = false;
  await assert.rejects(prepareAndSignSolToChzSwap({
    apiKey: "test", inputLamports: "10000000", configuredRewardTreasury: treasury.toBase58(),
    connection, signer: signer(() => { signed = true; }), fetcher,
  }), /jupiter_metis_min_out_program_or_data_invalid/);
  assert.equal(signed, false);
});

test("ATA setup rejects wrong signer and returns only a signed transaction", async () => {
  const wrongSigner: SolanaMessageSigner = {
    publicKey: other,
    signMessage: () => new Uint8Array(64),
  };
  await assert.rejects(prepareAndSignOfficialChzAta({
    configuredRewardTreasury: treasury.toBase58(), connection: ataRpc(), signer: wrongSigner,
  }), /signer_not_configured_reward_treasury/);
  const result = await prepareAndSignOfficialChzAta({
    configuredRewardTreasury: treasury.toBase58(), connection: ataRpc(), signer: signer(),
  });
  const signed = VersionedTransaction.deserialize(Buffer.from(result.signedTransactionBase64, "base64"));
  assert.equal(result.plan.outputAta, outputAta.toBase58());
  assert.equal(result.executionReady, false);
  assert(ed25519.verify(signed.signatures[0], signed.message.serialize(), treasury.toBytes()));
});

test("rejects an expired blockhash after signing without returning signed bytes", async () => {
  let called = false;
  await assert.rejects(prepareAndSignOfficialChzAta({
    configuredRewardTreasury: treasury.toBase58(),
    connection: ataRpc([150, 150, 200]), signer: signer(() => { called = true; }),
  }), /blockhash_expired_after_signing/);
  assert.equal(called, true);
});

test("rejects a signature for a different message", async () => {
  const dishonest: SolanaMessageSigner = {
    publicKey: treasury,
    signMessage: (message) => ed25519.sign(new Uint8Array(message.length),
      keypair.secretKey.slice(0, 32)),
  };
  await assert.rejects(prepareAndSignOfficialChzAta({
    configuredRewardTreasury: treasury.toBase58(), connection: ataRpc(), signer: dishonest,
  }), /signature_invalid_or_wrong_message/);
});
