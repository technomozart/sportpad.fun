import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import test from "node:test";
import { oft } from "@layerzerolabs/oft-v2-solana-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { encodeAbiParameters, encodeEventTopics, padHex, parseAbiItem } from "viem";
import {
  reconcileDirectOftChilizBridge, type PreparedDirectOftJournalRow,
  type TrustedDirectOftSourceIntent,
} from "./direct-oft-reconcile.ts";

const PROGRAM = new PublicKey("BcRpUE1jvLvgchaYntfi2weReWVG8THCRLFy73CmxjHo");
const STORE = new PublicKey("9SBbd5mXvCimWXpggkE8PJpXMjBddDhWWZY1eW1BhvUF");
const MINT = new PublicKey("6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw");
const ADAPTER = "0xcdE3D1879b81b45c3aA35779C6ceB7E8B6526b4f";
const DESTINATION = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const DESTINATION_LOWER = DESTINATION.toLowerCase();
const GUID = `0x${"a".repeat(64)}`;
const DEST_TX = `0x${"b".repeat(64)}`;
const RECEIPT_HASH = `0x${"c".repeat(64)}`;
const FINAL_HASH = `0x${"d".repeat(64)}`;
const EID = 30409;
const SENT = 100_000_000n;
const RECEIVED = 99_000_000n;
const MINIMUM_WEI = (RECEIVED * 10_000_000_000n).toString();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const oftReceived = parseAbiItem(
  "event OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)",
);

function fixture() {
  const wallet = Keypair.generate();
  const sourceAta = getAssociatedTokenAddressSync(MINT, wallet.publicKey);
  const escrow = Keypair.generate().publicKey;
  const peerEid = Buffer.alloc(4);
  peerEid.writeUInt32BE(EID);
  const peer = PublicKey.findProgramAddressSync([
    Buffer.from("Peer"), STORE.toBuffer(), peerEid,
  ], PROGRAM)[0];
  const eventAuthority = PublicKey.findProgramAddressSync([
    Buffer.from("__event_authority"),
  ], PROGRAM)[0];
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
    data: Buffer.from(oft.instructions.getSendInstructionDataSerializer().serialize({
      dstEid: EID,
      to: Buffer.from(padHex(DESTINATION, { size: 32 }).slice(2), "hex"),
      amountLd: SENT,
      minAmountLd: RECEIVED,
      options: new Uint8Array(),
      composeMsg: null,
      nativeFee: 1_000_000n,
      lzTokenFee: 0n,
    })),
  });
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [send],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([wallet]);
  const signedBytes = transaction.serialize();
  const sourceSignature = bs58.encode(transaction.signatures[0]);
  const signedBase64 = Buffer.from(signedBytes).toString("base64");
  const event = Buffer.alloc(100);
  event.set(Buffer.from("e445a52e51cb9a1d", "hex"), 0);
  event.set(createHash("sha256").update("event:OFTSent").digest().subarray(0, 8), 8);
  event.set(Buffer.from(GUID.slice(2), "hex"), 16);
  event.writeUInt32LE(EID, 48);
  event.set(sourceAta.toBuffer(), 52);
  event.writeBigUInt64LE(SENT, 84);
  event.writeBigUInt64LE(RECEIVED, 92);
  const sourceIndex = message.staticAccountKeys.findIndex((key) => key.equals(sourceAta));
  const programIndex = message.staticAccountKeys.findIndex((key) => key.equals(PROGRAM));
  const balance = (amount: string) => ({
    accountIndex: sourceIndex, mint: MINT.toBase58(), owner: wallet.publicKey.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount, decimals: 8 },
  });
  const sourceReceipt = {
    slot: 123, version: 0, transaction: [signedBase64, "base64"],
    meta: {
      err: null, loadedAddresses: { writable: [], readonly: [] },
      preTokenBalances: [balance("200000000")],
      postTokenBalances: [balance("100000000")],
      innerInstructions: [{ index: 0, instructions: [{
        programIdIndex: programIndex, data: bs58.encode(event),
      }] }],
    },
  };
  const sourceStatus = { value: [{ slot: 123, err: null,
    confirmationStatus: "finalized" }] };
  const journal: PreparedDirectOftJournalRow = {
    id: "bridge-1",
    sourceChain: "solana",
    destinationChainId: 88888,
    sourceMint: MINT.toBase58(),
    destinationAsset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    routeType: "OFT",
    sourceWallet: wallet.publicKey.toBase58(),
    destinationTreasury: DESTINATION_LOWER,
    sourceAmountAtomic: SENT.toString(),
    minimumDestinationWei: MINIMUM_WEI,
    quoteId: `oft:${"e".repeat(64)}`,
    signedTransactionBase64: signedBase64,
    signedTransactionSha256: hash(signedBytes),
    sourceSignature,
    bridgeMessageId: null,
    sourceFinalizedSlot: null,
    destinationTxHash: null,
  };
  const trusted: TrustedDirectOftSourceIntent = {
    sourceTokenAccount: sourceAta.toBase58(),
    sourceEscrow: escrow.toBase58(),
    minimumDestinationWei: MINIMUM_WEI,
    expectedMessageSha256: hash(message.serialize()),
  };
  const scan = {
    data: [{
      guid: GUID,
      status: { name: "DELIVERED" },
      source: { status: "SUCCEEDED", tx: {
        txHash: sourceSignature,
        from: wallet.publicKey.toBase58(),
        payload: `${padHex(DESTINATION, { size: 32 }).toLowerCase()}${RECEIVED.toString(16).padStart(16, "0")}`,
      } },
      destination: { status: "SUCCEEDED", tx: {
        txHash: DEST_TX, blockHash: RECEIPT_HASH, blockNumber: 10,
      } },
      pathway: {
        srcEid: 30168, dstEid: EID,
        sender: { address: STORE.toBase58(), chain: "solana" },
        receiver: { address: ADAPTER, chain: "chiliz" },
      },
      config: { error: false },
    }],
  };
  const topics = encodeEventTopics({ abi: [oftReceived], eventName: "OFTReceived",
    args: { guid: GUID as `0x${string}`, toAddress: DESTINATION } });
  const data = encodeAbiParameters([
    { name: "srcEid", type: "uint32" },
    { name: "amountReceivedLD", type: "uint256" },
  ], [30168, RECEIVED * 10_000_000_000n]);
  const destinationReceipt = {
    transactionHash: DEST_TX, blockHash: RECEIPT_HASH,
    blockNumber: "0xa", status: "0x1",
    logs: [{ address: ADAPTER, topics, data }],
  };
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = async (requestUrl: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(requestUrl);
    if (url.startsWith("https://scan.layerzero-api.com/")) {
      calls.push({ url, method: String(init?.method) });
      return new Response(JSON.stringify(scan), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as {
      jsonrpc: string; id: number; method: string; params: unknown[];
    };
    calls.push({ url, method: body.method });
    let result: unknown;
    if (url === "https://solana.example/rpc") {
      result = body.method === "getTransaction" ? sourceReceipt : sourceStatus;
    } else {
      switch (body.method) {
        case "eth_chainId": result = "0x15b38"; break;
        case "eth_getTransactionReceipt": result = destinationReceipt; break;
        case "eth_getFinalizedBlock": result = { number: "0x14", hash: FINAL_HASH }; break;
        case "eth_blockNumber": result = "0x15"; break;
        case "eth_getBlockByNumber": result = body.params[0] === "0xa" ?
          { number: "0xa", hash: RECEIPT_HASH } :
          { number: "0x14", hash: FINAL_HASH };
          break;
        default: throw new Error(`unexpected method ${body.method}`);
      }
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { status: 200 });
  };
  const input = {
    journal, trusted, solanaRpcUrl: "https://solana.example/rpc",
    primaryChilizRpcUrl: "https://chiliz-one.example/rpc",
    secondaryChilizRpcUrl: "https://chiliz-two.example/rpc", fetchImpl,
  };
  return { input, calls, scan, sourceReceipt, sourceStatus, destinationReceipt };
}

test("reconciles finalized source GUID, one Scan message, and dual Chiliz receipts", async () => {
  const f = fixture();
  const result = await reconcileDirectOftChilizBridge(f.input);
  assert.equal(result.journalId, "bridge-1");
  assert.equal(result.guid, GUID);
  assert.equal(result.source.bridgeMessageId, GUID);
  assert.equal(result.destination.bridgeMessageId, GUID);
  assert.equal(result.destination.transactionHash, DEST_TX);
  assert.equal(result.destination.receivedWei, MINIMUM_WEI);
  assert.equal(result.destination.finalized, true);
  assert.equal(f.calls.filter((call) => call.url.startsWith("https://scan.")).length, 1);
  assert.deepEqual(f.calls.map((call) => call.method).slice(0, 3).sort(),
    ["GET", "getSignatureStatuses", "getTransaction"].sort());
  assert.equal(f.calls.find((call) => call.method === "GET")?.url,
    `https://scan.layerzero-api.com/v1/messages/tx/${f.input.journal.sourceSignature}`);
});

test("rejects journal/independent minimum mismatch before network access", async () => {
  const f = fixture();
  await assert.rejects(reconcileDirectOftChilizBridge({ ...f.input,
    trusted: { ...f.input.trusted, minimumDestinationWei: "1" },
  }), /journal_mismatch/);
  assert.equal(f.calls.length, 0);
});

test("rejects a non-direct route before network access", async () => {
  const f = fixture();
  await assert.rejects(reconcileDirectOftChilizBridge({ ...f.input,
    journal: { ...f.input.journal, routeType: "OFT_V2" },
  }), /journal_mismatch/);
  assert.equal(f.calls.length, 0);
});

test("requires source finality before asking Scan", async () => {
  const f = fixture();
  f.sourceStatus.value[0].confirmationStatus = "confirmed";
  await assert.rejects(reconcileDirectOftChilizBridge(f.input), /not_finalized/);
  assert.equal(f.calls.some((call) => call.method === "GET"), false);
});

test("rejects previously stored conflicting GUID", async () => {
  const f = fixture();
  await assert.rejects(reconcileDirectOftChilizBridge({ ...f.input,
    journal: { ...f.input.journal, bridgeMessageId: `0x${"f".repeat(64)}` },
  }), /existing_source_mismatch/);
  assert.equal(f.calls.some((call) => call.method === "GET"), false);
});

for (const [name, data, code] of [
  ["missing Scan message", [], /scan_missing/],
  ["ambiguous Scan messages", [{ guid: GUID }, { guid: GUID }], /scan_ambiguous/],
  ["different Scan GUID", [{ guid: `0x${"f".repeat(64)}` }], /scan_guid_mismatch/],
] as const) {
  test(`rejects ${name} before Chiliz RPC calls`, async () => {
    const f = fixture();
    (f.scan as { data: unknown[] }).data = Array.from(data);
    await assert.rejects(reconcileDirectOftChilizBridge(f.input), code);
    assert.equal(f.calls.some((call) => call.url.startsWith("https://chiliz-")), false);
  });
}

test("sanitizes Scan transport failure", async () => {
  const f = fixture();
  await assert.rejects(reconcileDirectOftChilizBridge({ ...f.input,
    fetchImpl: (url, init) => String(url).startsWith("https://scan.") ?
      Promise.reject(new Error("private transport detail")) : f.input.fetchImpl(url, init),
  }), /direct_oft_reconcile_scan_unavailable/);
});

test("rejects a failed Chiliz destination receipt", async () => {
  const f = fixture();
  f.destinationReceipt.status = "0x0";
  await assert.rejects(reconcileDirectOftChilizBridge(f.input), /receipt_mismatch/);
});
