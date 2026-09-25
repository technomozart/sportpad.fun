import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { DIRECT_CHZ_OFT, verifyDirectOftDelivery } from "./direct-oft-receipts.ts";

const sourceSignature = bs58.encode(new Uint8Array(64).fill(7));
const sourceTreasury = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const destinationTreasury = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const guid = `0x${"a".repeat(64)}` as `0x${string}`;
const txHash = `0x${"b".repeat(64)}`;
const receiptHash = `0x${"c".repeat(64)}`;
const finalHash = `0x${"d".repeat(64)}`;
const amountWei = 123_456_789n * 10_000_000_000n;
const oftReceived = parseAbiItem(
  "event OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)",
);

function makeScan() {
  return {
    guid,
    status: { name: "DELIVERED" },
    source: {
      status: "SUCCEEDED",
      tx: {
        txHash: sourceSignature,
        from: sourceTreasury,
        payload: `0x${"0".repeat(24)}${destinationTreasury.slice(2).toLowerCase()}${
          (123_456_789n).toString(16).padStart(16, "0")}`,
      },
    },
    destination: { status: "SUCCEEDED", tx: {
      txHash, blockHash: receiptHash, blockNumber: 10,
    } },
    pathway: {
      srcEid: Number(DIRECT_CHZ_OFT.sourceEid),
      dstEid: DIRECT_CHZ_OFT.destinationEid,
      sender: { address: String(DIRECT_CHZ_OFT.sourceStore), chain: "solana" },
      receiver: { address: String(DIRECT_CHZ_OFT.destinationAdapter), chain: "chiliz" },
    },
    config: { error: false },
  };
}

function makeReceipt(overrides: Record<string, unknown> = {}) {
  const topics = encodeEventTopics({ abi: [oftReceived], eventName: "OFTReceived",
    args: { guid, toAddress: destinationTreasury } });
  const data = encodeAbiParameters([
    { name: "srcEid", type: "uint32" },
    { name: "amountReceivedLD", type: "uint256" },
  ], [DIRECT_CHZ_OFT.sourceEid, amountWei]);
  return {
    transactionHash: txHash, blockHash: receiptHash, blockNumber: "0xa",
    status: "0x1",
    logs: [{ address: DIRECT_CHZ_OFT.destinationAdapter, topics, data }],
    ...overrides,
  };
}

function makeRpcResult(receipt = makeReceipt(), options: {
  chain?: string;
  receiptBlockHash?: string;
  commonHash?: string;
  finalizedHeight?: string;
  latestHeight?: string;
} = {}) {
  const finalizedHeight = options.finalizedHeight ?? "0x14";
  return (method: string, params: readonly unknown[]) => {
    switch (method) {
      case "eth_chainId": return options.chain ?? "0x15b38";
      case "eth_getTransactionReceipt": return receipt;
      case "eth_getFinalizedBlock": return { number: finalizedHeight, hash: finalHash };
      case "eth_blockNumber": return options.latestHeight ?? "0x15";
      case "eth_getBlockByNumber": {
        const number = params[0];
        if (number === "0xa") return { number, hash: options.receiptBlockHash ?? receiptHash };
        if (number === "0x14") return { number, hash: options.commonHash ?? finalHash };
        return null;
      }
      default: throw new Error(`unexpected RPC method: ${method}`);
    }
  };
}

function makeFetch(first = makeRpcResult(), second = makeRpcResult(), seen?: string[]) {
  return async (url: string | URL, init?: RequestInit) => {
    const destination = String(url);
    seen?.push(destination);
    const resultFor = destination === "https://rpc-one.example/chiliz" ? first :
      destination === "https://rpc-two.example/chiliz" ? second : null;
    if (!resultFor || init?.method !== "POST") throw new Error("unexpected_rpc_endpoint");
    const request = JSON.parse(String(init.body)) as {
      jsonrpc: string; id: number; method: string; params: unknown[] };
    assert.equal(request.jsonrpc, "2.0");
    return Response.json({ jsonrpc: "2.0", id: request.id,
      result: resultFor(request.method, request.params) });
  };
}

function input(scanMessage: unknown = makeScan(), receipt = makeReceipt(), seen?: string[]) {
  return {
    scanMessage,
    expected: { sourceSignature, sourceTreasury, destinationTreasury,
      minimumReceivedWei: amountWei },
    primaryRpcUrl: "https://rpc-one.example/chiliz",
    secondaryRpcUrl: "https://rpc-two.example/chiliz",
    fetchImpl: makeFetch(makeRpcResult(receipt), makeRpcResult(receipt), seen),
  };
}

test("direct OFT delivery requires Scan identity, dual receipts, event and finality", async () => {
  const requestedUrls: string[] = [];
  const verified = await verifyDirectOftDelivery(input(makeScan(), makeReceipt(), requestedUrls));
  assert.equal(verified.guid, guid);
  assert.equal(verified.destinationTransactionHash, txHash);
  assert.equal(verified.receiptBlockNumber, 10n);
  assert.equal(verified.receivedWei, amountWei);
  assert.equal(verified.proof.destinationTreasury, destinationTreasury.toLowerCase());
  assert.equal(verified.proof.receivedWei, amountWei.toString());
  assert.equal(verified.proof.finalizedBlockNumber, "20");
  assert.deepEqual([...new Set(requestedUrls)].sort(),
    ["https://rpc-one.example/chiliz", "https://rpc-two.example/chiliz"]);
  assert.doesNotThrow(() => JSON.stringify(verified.proof));
});

test("direct OFT delivery requires the journal minimum", async () => {
  const missing = input();
  delete (missing.expected as { minimumReceivedWei?: bigint }).minimumReceivedWei;
  await assert.rejects(() => verifyDirectOftDelivery(missing), /direct_oft_minimum_invalid/);
  const zero = input();
  zero.expected.minimumReceivedWei = 0n;
  await assert.rejects(() => verifyDirectOftDelivery(zero), /direct_oft_minimum_invalid/);
  const tooLow = makeScan();
  tooLow.source.tx.payload = `0x${"0".repeat(24)}${destinationTreasury.slice(2).toLowerCase()}${
    (1n).toString(16).padStart(16, "0")}`;
  await assert.rejects(() => verifyDirectOftDelivery(input(tooLow)),
    /direct_oft_scan_amount_mismatch/);
});

test("direct OFT delivery rejects forged or incomplete Scan identities", async () => {
  const mutations = [
    (scan: ReturnType<typeof makeScan>) => { scan.pathway.srcEid = 30184; },
    (scan: ReturnType<typeof makeScan>) => { scan.pathway.sender.address = sourceTreasury; },
    (scan: ReturnType<typeof makeScan>) => { scan.pathway.receiver.address = destinationTreasury; },
    (scan: ReturnType<typeof makeScan>) => { scan.source.tx.from = DIRECT_CHZ_OFT.sourceStore; },
    (scan: ReturnType<typeof makeScan>) => { scan.source.tx.txHash = "wrong"; },
    (scan: ReturnType<typeof makeScan>) => { scan.source.tx.payload =
      `0x${"0".repeat(24)}${"1".repeat(40)}${(123_456_789n).toString(16).padStart(16, "0")}`; },
    (scan: ReturnType<typeof makeScan>) => { scan.destination.status = "PENDING"; },
    (scan: ReturnType<typeof makeScan>) => { scan.config.error = true; },
  ];
  for (const mutate of mutations) {
    const scan = makeScan();
    mutate(scan);
    await assert.rejects(() => verifyDirectOftDelivery(input(scan)));
  }
  const incomplete = makeScan() as Record<string, unknown>;
  delete incomplete.pathway;
  await assert.rejects(() => verifyDirectOftDelivery(input(incomplete)));
});

test("direct OFT delivery rejects missing, reverted, mismatched or malformed receipts", async () => {
  for (const receipt of [
    makeReceipt({ status: "0x0" }),
    makeReceipt({ blockHash: `0x${"e".repeat(64)}` }),
    makeReceipt({ logs: [] }),
    makeReceipt({ logs: [{ address: DIRECT_CHZ_OFT.destinationAdapter,
      topics: encodeEventTopics({ abi: [oftReceived], eventName: "OFTReceived",
        args: { guid, toAddress: "0x1111111111111111111111111111111111111111" } }),
      data: encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }],
        [DIRECT_CHZ_OFT.sourceEid, amountWei]) }] }),
  ]) {
    await assert.rejects(() => verifyDirectOftDelivery(input(makeScan(), receipt)));
  }
});

test("direct OFT delivery requires separate correct-chain canonical finalized RPCs", async () => {
  const sameOrigin = input();
  sameOrigin.secondaryRpcUrl = "https://rpc-one.example/another-path";
  await assert.rejects(() => verifyDirectOftDelivery(sameOrigin),
    /direct_oft_rpcs_not_independent/);
  const invalidUrl = input();
  invalidUrl.secondaryRpcUrl = "http://rpc-two.example/chiliz";
  await assert.rejects(() => verifyDirectOftDelivery(invalidUrl),
    /direct_oft_rpc_url_invalid/);
  const invalidResponse = input();
  invalidResponse.fetchImpl = async () => Response.json({ jsonrpc: "2.0", id: 999,
    result: "0x15b38" });
  await assert.rejects(() => verifyDirectOftDelivery(invalidResponse),
    /direct_oft_rpc_invalid/);
  const badChain = input();
  badChain.fetchImpl = makeFetch(makeRpcResult(), makeRpcResult(makeReceipt(), { chain: "0x1" }));
  await assert.rejects(() => verifyDirectOftDelivery(badChain));
  const badBlock = input();
  badBlock.fetchImpl = makeFetch(makeRpcResult(), makeRpcResult(makeReceipt(),
    { receiptBlockHash: `0x${"e".repeat(64)}` }));
  await assert.rejects(() => verifyDirectOftDelivery(badBlock));
  const badFinality = input();
  badFinality.fetchImpl = makeFetch(makeRpcResult(), makeRpcResult(makeReceipt(),
    { finalizedHeight: "0x9" }));
  await assert.rejects(() => verifyDirectOftDelivery(badFinality));
});
