import assert from "node:assert/strict";
import test from "node:test";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { padHex } from "viem";
import { buildUnsignedDirectOftFromSnapshot, directOftOptions,
  type DirectOftBuildSnapshot } from "./chiliz-direct-oft-build.ts";
import {
  broadcastDirectOftChilizOnce, type DirectOftBroadcastRpc,
  type PersistedDirectOftBroadcastRow,
} from "./chiliz-direct-oft-broadcast.ts";
import { prepareDirectOftChilizBridgeJournalInsert } from "./chiliz-direct-oft-journal.ts";
import { DIRECT_CHZ_OFT } from "./chiliz-direct-oft.ts";

const signer = Keypair.fromSeed(new Uint8Array(32).fill(23));
const wallet = signer.publicKey.toBase58();
const destination = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const escrow = "CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ";
const sourceAta = getAssociatedTokenAddressSync(
  new PublicKey(DIRECT_CHZ_OFT.solanaMint), signer.publicKey, false,
  TOKEN_PROGRAM_ID).toBase58();
const nowMs = 1_800_000_000_000;
const amount = 100_000_000n;
const minimum = 99_000_000n;
const fee = 345_783n;
const options = directOftOptions(new Uint8Array());
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

function snapshot(): DirectOftBuildSnapshot {
  const sendData = oft.instructions.getSendInstructionDataSerializer().serialize({
    dstEid: DIRECT_CHZ_OFT.chilizEid,
    to: Buffer.from(padHex(destination, { size: 32 }).slice(2), "hex"),
    amountLd: amount, minAmountLd: minimum, options, composeMsg: null,
    nativeFee: fee, lzTokenFee: 0n,
  });
  return {
    storeMint: DIRECT_CHZ_OFT.solanaMint, storeEscrow: escrow, storePaused: false,
    peer: padHex(DIRECT_CHZ_OFT.chilizNativeAdapter, { size: 32 }),
    sourceTokenAccount: sourceAta,
    sourceTokenAmountAtomic: amount.toString(), messagingFeeLamports: fee,
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
        { pubkey: signer.publicKey, isSigner: true, isWritable: false },
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
        lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0,
        authority: undefined, addresses: [],
      },
    }),
    blockhash: { blockhash: escrow, lastValidBlockHeight: 100 },
  };
}

async function fixture() {
  const plan = await buildUnsignedDirectOftFromSnapshot({
    amountAtomic: amount.toString(), payerSolanaWallet: wallet,
    destinationChilizWallet: destination,
    solanaRpcUrl: "https://solana.example/rpc", nowMs,
  }, snapshot());
  const tx = VersionedTransaction.deserialize(
    Buffer.from(plan.unsignedTransactionBase64, "base64"));
  tx.sign([signer]);
  const signed = Buffer.from(tx.serialize()).toString("base64");
  const expectedJournal = await prepareDirectOftChilizBridgeJournalInsert({
    id: "bridge-broadcast-test", plan,
    expectedSourceWallet: wallet, expectedDestinationTreasury: destination,
    signedTransactionBase64: signed, nowMs,
  });
  let stored: PersistedDirectOftBroadcastRow = {
    ...expectedJournal,
    policyKey: "initial",
    sourceChain: "solana", destinationChainId: 88888,
    sourceMint: DIRECT_CHZ_OFT.solanaMint,
    destinationAsset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    state: "prepared", broadcastAttemptedAtMs: null,
  };
  let loadCount = 0;
  let claimCount = 0;
  let sendCount = 0;
  let height = 20;
  let genesis = MAINNET_GENESIS;
  let sendThrows = false;
  let statusValue: { err: unknown; confirmationStatus: string | null } | null = null;
  const rpc: DirectOftBroadcastRpc = {
    getGenesisHash: async () => genesis,
    getBlockHeight: async () => height,
    getSignatureStatuses: async (signatures, opts) => {
      assert.deepEqual(signatures, [expectedJournal.sourceSignature]);
      assert.deepEqual(opts, { searchTransactionHistory: true });
      return { value: [statusValue] };
    },
    sendRawTransaction: async (bytes, opts) => {
      sendCount++;
      assert.equal(Buffer.from(bytes).toString("base64"), stored.signedTransactionBase64);
      assert.deepEqual(opts, { skipPreflight: false, maxRetries: 0 });
      if (sendThrows) throw new Error("opaque transport failure");
      return expectedJournal.sourceSignature;
    },
  };
  const loadPersisted = async (id: string) => {
    assert.equal(id, stored.id);
    loadCount++;
    return stored;
  };
  const claimBroadcastAttempt = async (_id: string, _signature: string, atMs: number) => {
    claimCount++;
    if (stored.state !== "prepared") return { changedRows: 0, journal: stored };
    stored = { ...stored, state: "broadcast_attempted", broadcastAttemptedAtMs: atMs };
    return { changedRows: 1, journal: stored };
  };
  const input = {
    expectedJournal, plan, loadPersisted, claimBroadcastAttempt, rpc,
    solanaRpcUrl: "https://solana.example/rpc",
    primaryChilizRpcUrl: "https://chiliz-one.example/rpc",
    secondaryChilizRpcUrl: "https://chiliz-two.example/rpc",
    nowMs,
  };
  return {
    input,
    get stored() { return stored; },
    get loadCount() { return loadCount; },
    get claimCount() { return claimCount; },
    get sendCount() { return sendCount; },
    setHeight(value: number) { height = value; },
    setGenesis(value: string) { genesis = value; },
    setSendThrows(value: boolean) { sendThrows = value; },
    setStatus(value: typeof statusValue) { statusValue = value; },
  };
}

test("sends only exact persisted bytes after one durable claim", async () => {
  const f = await fixture();
  const outcome = await broadcastDirectOftChilizOnce(f.input);
  assert.equal(outcome.state, "submitted_pending");
  assert.equal(f.claimCount, 1);
  assert.equal(f.sendCount, 1);
  assert.equal(f.stored.state, "broadcast_attempted");
  assert.equal(f.stored.broadcastAttemptedAtMs, nowMs);
  await assert.rejects(broadcastDirectOftChilizOnce(f.input), /persisted_identity_invalid/);
  assert.equal(f.sendCount, 1);
});

test("rejects absent or tampered persisted journal before sending", async () => {
  const f = await fixture();
  await assert.rejects(broadcastDirectOftChilizOnce({ ...f.input,
    loadPersisted: async () => null,
  }), /persisted_identity_invalid/);
  await assert.rejects(broadcastDirectOftChilizOnce({ ...f.input,
    loadPersisted: async () => ({ ...f.stored,
      signedTransactionBase64: "malicious" }),
  }), /persisted_identity_invalid/);
  assert.equal(f.sendCount, 0);
  assert.equal(f.claimCount, 0);
});

test("rejects expired blockhash and wrong Solana chain before durable claim", async () => {
  const f = await fixture();
  f.setHeight(95);
  await assert.rejects(broadcastDirectOftChilizOnce(f.input), /expired/);
  f.setHeight(20);
  f.setGenesis("wrong-genesis");
  await assert.rejects(broadcastDirectOftChilizOnce(f.input), /wrong_chain_or_height/);
  assert.equal(f.claimCount, 0);
  assert.equal(f.sendCount, 0);
});

test("zero-row durable claim never reaches sendRawTransaction", async () => {
  const f = await fixture();
  await assert.rejects(broadcastDirectOftChilizOnce({ ...f.input,
    claimBroadcastAttempt: async () => ({ changedRows: 0, journal: f.stored }),
  }), /claim_invalid/);
  assert.equal(f.sendCount, 0);
});

test("unknown network outcome is non-replayable and only signature-reconciled", async () => {
  const f = await fixture();
  f.setSendThrows(true);
  const outcome = await broadcastDirectOftChilizOnce(f.input);
  assert.equal(outcome.state, "broadcast_unknown");
  assert.equal(f.sendCount, 1);
  await assert.rejects(broadcastDirectOftChilizOnce(f.input), /persisted_identity_invalid/);
  assert.equal(f.sendCount, 1);
});

test("finalized source invokes proof reconciliation, never another send", async () => {
  const f = await fixture();
  f.setStatus({ err: null, confirmationStatus: "finalized" });
  let proofCalls = 0;
  const outcome = await broadcastDirectOftChilizOnce({ ...f.input,
    fetchImpl: async () => { proofCalls++; return new Response("opaque", { status: 503 }); },
  });
  assert.equal(outcome.state, "reconciliation_pending");
  assert.equal(f.sendCount, 0);
  assert.equal(proofCalls > 0, true);
});
