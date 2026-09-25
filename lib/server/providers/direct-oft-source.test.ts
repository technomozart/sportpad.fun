import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Buffer } from "node:buffer";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { padHex } from "viem";
import { verifyDirectOftSource, type DirectOftSourceExpected } from "./direct-oft-source.ts";

const PROGRAM = new PublicKey("BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo");
const STORE = new PublicKey("9SBbd5mXvCimWXpggkE8PJpXMjBddDhWWZY1eW1BhvUF");
const MINT = new PublicKey("6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw");
const LOOKUP_TABLE = new PublicKey("AokBxha6VMLLgf97B5VYHEtqztamWmYERBmmFvjuTzJB");
const EID = 30409;
const DESTINATION = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const SENT = 100_000_000n;
const RECEIVED = 99_000_000n;
const GUID = `0x${"ab".repeat(32)}`;
const EVENT_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
const EVENT_DISCRIMINATOR = createHash("sha256").update("event:OFTSent")
  .digest().subarray(0, 8);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type FixtureOptions = {
  instructionDestination?: string;
  instructionAmount?: bigint;
  topLevelExtraProgram?: boolean;
  postBalance?: string;
  eventGuid?: string;
  omitEvent?: boolean;
  receiptError?: unknown;
  statusFinalized?: boolean;
  rpcTransactionBase64?: string;
  omitLoadedAddress?: boolean;
};

function makeFixture(options: FixtureOptions = {}) {
  const wallet = Keypair.generate();
  const sourceAta = getAssociatedTokenAddressSync(MINT, wallet.publicKey);
  const escrow = Keypair.generate().publicKey;
  const eventAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")], PROGRAM)[0];
  const eidBytes = Buffer.alloc(4);
  eidBytes.writeUInt32BE(EID);
  const peer = PublicKey.findProgramAddressSync([
    Buffer.from("Peer"), STORE.toBuffer(), eidBytes,
  ], PROGRAM)[0];
  const instructionData = oft.instructions.getSendInstructionDataSerializer().serialize({
    dstEid: EID,
    to: Buffer.from(padHex((options.instructionDestination ?? DESTINATION) as `0x${string}`,
      { size: 32 }).slice(2), "hex"),
    amountLd: options.instructionAmount ?? SENT,
    minAmountLd: RECEIVED,
    options: new Uint8Array(),
    composeMsg: null,
    nativeFee: 1_000_000n,
    lzTokenFee: 0n,
  });
  const send = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: true },
      { pubkey: STORE, isSigner: false, isWritable: true },
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), send];
  if (options.topLevelExtraProgram) instructions.push(new TransactionInstruction({
    programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0),
  }));
  const lookupTable = new AddressLookupTableAccount({
    key: LOOKUP_TABLE,
    state: {
      deactivationSlot: 0xffff_ffff_ffff_ffffn,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: wallet.publicKey,
      addresses: [peer, STORE, sourceAta, escrow, MINT, TOKEN_PROGRAM_ID,
        eventAuthority, PROGRAM],
    },
  });
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions,
  }).compileToV0Message([lookupTable]);
  const transaction = new VersionedTransaction(message);
  transaction.sign([wallet]);
  const bytes = transaction.serialize();
  const base64 = Buffer.from(bytes).toString("base64");
  const resolved = message.getAccountKeys({ addressLookupTableAccounts: [lookupTable] });
  const allKeys = Array.from({ length: resolved.length }, (_, index) => resolved.get(index)!);
  const sourceIndex = allKeys.findIndex((key) => key.equals(sourceAta));
  const programIndex = allKeys.findIndex((key) => key.equals(PROGRAM));
  const writable = message.addressTableLookups.flatMap((lookup) =>
    Array.from(lookup.writableIndexes, (index) => lookupTable.state.addresses[index].toBase58()));
  const readonly = message.addressTableLookups.flatMap((lookup) =>
    Array.from(lookup.readonlyIndexes, (index) => lookupTable.state.addresses[index].toBase58()));
  const eventBytes = Buffer.alloc(100);
  eventBytes.set(EVENT_TAG, 0);
  eventBytes.set(EVENT_DISCRIMINATOR, 8);
  eventBytes.set(Buffer.from((options.eventGuid ?? GUID).slice(2), "hex"), 16);
  eventBytes.writeUInt32LE(EID, 48);
  eventBytes.set(sourceAta.toBuffer(), 52);
  eventBytes.writeBigUInt64LE(SENT, 84);
  eventBytes.writeBigUInt64LE(RECEIVED, 92);
  const expected: DirectOftSourceExpected = {
    sourceSignature: bs58.encode(transaction.signatures[0]),
    sourceWallet: wallet.publicKey.toBase58(),
    sourceTokenAccount: sourceAta.toBase58(),
    sourceEscrow: escrow.toBase58(),
    sourceMint: MINT.toBase58(),
    sourceAmountAtomic: SENT.toString(),
    destinationTreasury: DESTINATION,
    minimumDestinationWei: (RECEIVED * 10_000_000_000n).toString(),
    quoteId: `oft:${"a".repeat(64)}`,
    signedTransactionBase64: base64,
    signedTransactionSha256: hash(bytes),
    expectedMessageSha256: hash(message.serialize()),
    expectedGuid: GUID,
  };
  const balance = (amount: string) => ({
    accountIndex: sourceIndex,
    mint: MINT.toBase58(),
    owner: wallet.publicKey.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    uiTokenAmount: { amount, decimals: 8 },
  });
  const receipt = {
    slot: 123,
    version: 0,
    transaction: [options.rpcTransactionBase64 ?? base64, "base64"],
    meta: {
      err: options.receiptError === undefined ? null : options.receiptError,
      loadedAddresses: {
        writable: options.omitLoadedAddress ? writable.slice(1) : writable,
        readonly,
      },
      preTokenBalances: [balance("200000000")],
      postTokenBalances: [balance(options.postBalance ?? "100000000")],
      innerInstructions: options.omitEvent ? [] : [{ index: 1, instructions: [{
        programIdIndex: programIndex,
        data: bs58.encode(eventBytes),
      }] }],
    },
  };
  const status = {
    value: [{ slot: 123, err: null,
      confirmationStatus: options.statusFinalized === false ? "confirmed" : "finalized" }],
  };
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      jsonrpc: string; id: number; method: string; params: unknown[];
    };
    calls.push({ method: body.method, params: body.params });
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id: body.id,
      result: body.method === "getTransaction" ? receipt : status,
    }), { status: 200 });
  };
  return { expected, fetchImpl, calls, receipt, status, base64 };
}

test("accepts only a finalized exact signed CHZ OFT send with debit and GUID", async () => {
  const fixture = makeFixture();
  const result = await verifyDirectOftSource({
    rpcUrl: "https://solana-rpc.example/rpc", expected: fixture.expected,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(result.guid, GUID);
  assert.equal(result.amountSentAtomic, SENT);
  assert.equal(result.amountReceivedAtomic, RECEIVED);
  assert.equal(result.proof.bridgeMessageId, GUID);
  assert.equal(result.proof.finalized, true);
  assert.deepEqual(fixture.calls.map((call) => call.method).sort(),
    ["getSignatureStatuses", "getTransaction"]);
  assert.deepEqual(fixture.calls.find((call) => call.method === "getTransaction")?.params,
    [fixture.expected.sourceSignature, {
      encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0,
    }]);
});

for (const [name, options, error] of [
  ["wrong destination", { instructionDestination: "0x1111111111111111111111111111111111111111" },
    /instruction_mismatch/],
  ["wrong amount", { instructionAmount: SENT - 1n }, /instruction_mismatch/],
  ["unexpected program", { topLevelExtraProgram: true }, /program_mismatch/],
  ["missing source debit", { postBalance: "150000000" }, /debit_mismatch/],
  ["missing GUID event", { omitEvent: true }, /event_missing/],
  ["wrong GUID", { eventGuid: `0x${"cd".repeat(32)}` }, /event_mismatch/],
  ["failed transaction", { receiptError: { InstructionError: [1, "Custom"] } },
    /receipt_mismatch/],
  ["unfinalized signature", { statusFinalized: false }, /not_finalized/],
  ["different onchain signed bytes", { rpcTransactionBase64: "different" },
    /receipt_mismatch/],
  ["missing looked-up account", { omitLoadedAddress: true }, /loaded_accounts_invalid/],
] as const) {
  test(`rejects ${name}`, async () => {
    const fixture = makeFixture(options);
    await assert.rejects(verifyDirectOftSource({
      rpcUrl: "https://solana-rpc.example/rpc", expected: fixture.expected,
      fetchImpl: fixture.fetchImpl,
    }), error);
  });
}

test("rejects changed journal signature, digest, ATA, mint, and minimum", async () => {
  const fixture = makeFixture();
  for (const change of [
    { sourceSignature: bs58.encode(new Uint8Array(64).fill(1)) },
    { signedTransactionSha256: "b".repeat(64) },
    { expectedMessageSha256: "b".repeat(64) },
    { sourceTokenAccount: Keypair.generate().publicKey.toBase58() },
    { sourceMint: Keypair.generate().publicKey.toBase58() },
    { minimumDestinationWei: "0" },
  ]) {
    await assert.rejects(verifyDirectOftSource({
      rpcUrl: "https://solana-rpc.example/rpc", expected: { ...fixture.expected, ...change },
      fetchImpl: fixture.fetchImpl,
    }));
  }
});
