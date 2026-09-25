import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { decodeEventLog, getAddress, parseAbiItem } from "viem";

/** The official Chiliz bridge's CHZ pathway, checked against both on-chain peers. */
export const DIRECT_CHZ_OFT = Object.freeze({
  sourceEid: 30_168,
  destinationEid: 30_409,
  destinationChainId: 88_888,
  sourceStore: "9SBbd5mXvCimWXpggkE8PJpXMjBddDhWWZY1eW1BhvUF",
  destinationAdapter: "0xcdE3D1879b81b45c3aA35779C6ceB7E8B6526b4f",
  sourceDecimals: 8,
  destinationDecimals: 18,
});

const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const SOLANA_TO_CHILIZ_FACTOR = 10n ** BigInt(
  DIRECT_CHZ_OFT.destinationDecimals - DIRECT_CHZ_OFT.sourceDecimals,
);
const MAX_FINALIZED_HEAD_LAG = 128n;
const DEFAULT_RPC_TIMEOUT_MS = 12_000;
const OFT_RECEIVED = parseAbiItem(
  "event OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)",
);

type JsonObject = Record<string, unknown>;
type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type RpcContext = { url: URL; fetchImpl: RpcFetch; timeoutMs: number };

export type DirectOftDeliveryExpected = {
  sourceSignature: string;
  sourceTreasury: string;
  destinationTreasury: string;
  /** Must come from the immutable bridge journal, not the Scan response. */
  minimumReceivedWei: bigint;
};

export type DirectOftDeliveryProof = {
  kind: "direct_chz_oft_delivery";
  sourceEid: typeof DIRECT_CHZ_OFT.sourceEid;
  destinationEid: typeof DIRECT_CHZ_OFT.destinationEid;
  destinationChainId: typeof DIRECT_CHZ_OFT.destinationChainId;
  sourceStore: typeof DIRECT_CHZ_OFT.sourceStore;
  destinationAdapter: string;
  sourceSignature: string;
  sourceTreasury: string;
  destinationTreasury: string;
  guid: string;
  destinationTransactionHash: string;
  receiptBlockNumber: string;
  receiptBlockHash: string;
  finalizedBlockNumber: string;
  receivedWei: string;
};

export type VerifiedDirectOftDelivery = {
  guid: string;
  destinationTransactionHash: string;
  receiptBlockNumber: bigint;
  receivedWei: bigint;
  /** JSON-safe evidence suitable for destinationEvidenceJson. */
  proof: DirectOftDeliveryProof;
};

function fail(code: string): never { throw new Error(code); }

function object(value: unknown, code: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) fail(code);
  return value;
}

function hash(value: unknown, code: string): string {
  const text = string(value, code);
  if (!HASH.test(text)) fail(code);
  return text.toLowerCase();
}

function address(value: unknown, code: string): string {
  try { return getAddress(string(value, code)).toLowerCase(); }
  catch { return fail(code); }
}

function solanaAddress(value: unknown, code: string): string {
  const text = string(value, code);
  try {
    if (new PublicKey(text).toBase58() !== text) fail(code);
    return text;
  } catch { return fail(code); }
}

function signature(value: unknown, code: string): string {
  const text = string(value, code);
  try {
    const decoded = bs58.decode(text);
    if (decoded.length !== 64 || bs58.encode(decoded) !== text) fail(code);
    return text;
  } catch { return fail(code); }
}

function quantity(value: unknown, code: string): bigint {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) fail(code);
  return BigInt(value);
}

function decimalBlock(value: unknown, code: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail(code);
  return BigInt(value);
}

function scanRecord(payload: unknown): JsonObject {
  const record = object(payload, "direct_oft_scan_invalid");
  if (!("data" in record)) return record;
  if (!Array.isArray(record.data) || record.data.length !== 1) fail("direct_oft_scan_ambiguous");
  return object(record.data[0], "direct_oft_scan_invalid");
}

type ParsedScan = {
  guid: string;
  sourceSignature: string;
  sourceTreasury: string;
  destinationTreasury: string;
  destinationTransactionHash: string;
  destinationBlockHash: string;
  destinationBlockNumber: bigint;
  amountWei: bigint;
};

function parseScan(payload: unknown, expected: DirectOftDeliveryExpected): ParsedScan {
  const scan = scanRecord(payload);
  if (typeof expected.minimumReceivedWei !== "bigint" ||
      expected.minimumReceivedWei <= 0n) fail("direct_oft_minimum_invalid");
  const sourceSignature = signature(expected.sourceSignature, "direct_oft_source_signature_invalid");
  const sourceTreasury = solanaAddress(expected.sourceTreasury, "direct_oft_source_treasury_invalid");
  const destinationTreasury = address(expected.destinationTreasury, "direct_oft_destination_treasury_invalid");
  const guid = hash(scan.guid, "direct_oft_guid_invalid");
  const status = object(scan.status, "direct_oft_scan_status_invalid");
  const source = object(scan.source, "direct_oft_scan_source_invalid");
  const destination = object(scan.destination, "direct_oft_scan_destination_invalid");
  const pathway = object(scan.pathway, "direct_oft_scan_pathway_invalid");
  const sender = object(pathway.sender, "direct_oft_scan_sender_invalid");
  const receiver = object(pathway.receiver, "direct_oft_scan_receiver_invalid");
  const sourceTx = object(source.tx, "direct_oft_scan_source_invalid");
  const destinationTx = object(destination.tx, "direct_oft_scan_destination_invalid");
  const config = object(scan.config, "direct_oft_scan_config_invalid");
  if (status.name !== "DELIVERED" || source.status !== "SUCCEEDED" ||
      destination.status !== "SUCCEEDED" || config.error !== false ||
      pathway.srcEid !== DIRECT_CHZ_OFT.sourceEid ||
      pathway.dstEid !== DIRECT_CHZ_OFT.destinationEid ||
      sender.address !== DIRECT_CHZ_OFT.sourceStore || sender.chain !== "solana" ||
      address(receiver.address, "direct_oft_scan_receiver_invalid") !==
        DIRECT_CHZ_OFT.destinationAdapter.toLowerCase() || receiver.chain !== "chiliz" ||
      signature(sourceTx.txHash, "direct_oft_scan_source_invalid") !== sourceSignature ||
      solanaAddress(sourceTx.from, "direct_oft_scan_source_invalid") !== sourceTreasury) {
    fail("direct_oft_scan_identity_mismatch");
  }
  const payloadHex = string(sourceTx.payload, "direct_oft_scan_payload_invalid");
  // A plain OFT transfer is bytes32(to) + uint64(amount shared decimals).
  // A compose payload or altered recipient is outside this settlement flow.
  if (!/^0x[0-9a-fA-F]{80}$/.test(payloadHex)) fail("direct_oft_scan_payload_invalid");
  if (payloadHex.slice(2, 26) !== "0".repeat(24) ||
      `0x${payloadHex.slice(26, 66)}`.toLowerCase() !== destinationTreasury) {
    fail("direct_oft_scan_recipient_mismatch");
  }
  const amountWei = BigInt(`0x${payloadHex.slice(66)}`) * SOLANA_TO_CHILIZ_FACTOR;
  if (amountWei <= 0n || amountWei < expected.minimumReceivedWei) {
    fail("direct_oft_scan_amount_mismatch");
  }
  return {
    guid, sourceSignature, sourceTreasury, destinationTreasury,
    destinationTransactionHash: hash(destinationTx.txHash, "direct_oft_scan_destination_invalid"),
    destinationBlockHash: hash(destinationTx.blockHash, "direct_oft_scan_destination_invalid"),
    destinationBlockNumber: decimalBlock(destinationTx.blockNumber, "direct_oft_scan_destination_invalid"),
    amountWei,
  };
}

type RpcReceipt = { transactionHash: string; blockHash: string; blockNumber: bigint;
  receivedWei: bigint };

function parseReceipt(value: unknown, scan: ParsedScan): RpcReceipt {
  const receipt = object(value, "direct_oft_receipt_missing");
  const transactionHash = hash(receipt.transactionHash, "direct_oft_receipt_invalid");
  const blockHash = hash(receipt.blockHash, "direct_oft_receipt_invalid");
  const blockNumber = quantity(receipt.blockNumber, "direct_oft_receipt_invalid");
  if (transactionHash !== scan.destinationTransactionHash ||
      blockHash !== scan.destinationBlockHash || blockNumber !== scan.destinationBlockNumber ||
      receipt.status !== "0x1") fail("direct_oft_receipt_mismatch");
  if (!Array.isArray(receipt.logs)) fail("direct_oft_receipt_logs_invalid");
  let found: bigint | null = null;
  for (const entry of receipt.logs) {
    const log = object(entry, "direct_oft_receipt_logs_invalid");
    if (address(log.address, "direct_oft_receipt_logs_invalid") !==
        DIRECT_CHZ_OFT.destinationAdapter.toLowerCase()) continue;
    if (!Array.isArray(log.topics) || typeof log.data !== "string") {
      fail("direct_oft_receipt_logs_invalid");
    }
    let decoded: ReturnType<typeof decodeEventLog>;
    try {
      decoded = decodeEventLog({ abi: [OFT_RECEIVED], data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]], strict: true });
    } catch { continue; }
    if (decoded.eventName !== "OFTReceived") continue;
    const args = decoded.args as { guid: string; srcEid: number;
      toAddress: string; amountReceivedLD: bigint };
    if (hash(args.guid, "direct_oft_event_invalid") !== scan.guid) continue;
    if (found !== null || args.srcEid !== DIRECT_CHZ_OFT.sourceEid ||
        address(args.toAddress, "direct_oft_event_invalid") !== scan.destinationTreasury ||
        typeof args.amountReceivedLD !== "bigint" || args.amountReceivedLD !== scan.amountWei) {
      fail("direct_oft_event_mismatch");
    }
    found = args.amountReceivedLD;
  }
  if (found === null) fail("direct_oft_event_missing");
  return { transactionHash, blockHash, blockNumber, receivedWei: found };
}

function parsedBlock(value: unknown, code: string): { number: bigint; hash: string } {
  const block = object(value, code);
  const number = quantity(block.number, code);
  const blockHash = hash(block.hash, code);
  if (number === 0n) fail(code);
  return { number, hash: blockHash };
}

function endpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { return fail("direct_oft_rpc_url_invalid"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    fail("direct_oft_rpc_url_invalid");
  }
  return url;
}

async function rpc(context: RpcContext, method: string, params: readonly unknown[],
  id: number): Promise<unknown> {
  let response: Response;
  try {
    response = await context.fetchImpl(context.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(context.timeoutMs),
    });
  } catch { return fail("direct_oft_rpc_unavailable"); }
  if (!response.ok) fail("direct_oft_rpc_unavailable");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { return fail("direct_oft_rpc_invalid"); }
  const record = object(payload, "direct_oft_rpc_invalid");
  if (record.jsonrpc !== "2.0" || record.id !== id || record.error || record.result == null) {
    fail("direct_oft_rpc_invalid");
  }
  return record.result;
}

/**
 * Reconcile one direct OFT delivery from independent read-only sources. The
 * Scan record identifies the message; two Chiliz transports independently
 * attest to its receipt, event, canonical block and Chiliz finalized head.
 * Nothing in this module signs, broadcasts or changes ledger state.
 */
export async function verifyDirectOftDelivery(input: {
  scanMessage: unknown;
  expected: DirectOftDeliveryExpected;
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  fetchImpl?: RpcFetch;
  timeoutMs?: number;
}): Promise<VerifiedDirectOftDelivery> {
  const primaryUrl = endpoint(input.primaryRpcUrl);
  const secondaryUrl = endpoint(input.secondaryRpcUrl);
  if (primaryUrl.origin.toLowerCase() === secondaryUrl.origin.toLowerCase()) {
    fail("direct_oft_rpcs_not_independent");
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    fail("direct_oft_rpc_timeout_invalid");
  }
  const scan = parseScan(input.scanMessage, input.expected);
  const fetchImpl = input.fetchImpl ?? fetch;
  const first: RpcContext = { url: primaryUrl, fetchImpl, timeoutMs };
  const second: RpcContext = { url: secondaryUrl, fetchImpl, timeoutMs };
  const [chainA, chainB, receiptA, receiptB, finalA, finalB, latestA, latestB] =
    await Promise.all([
      rpc(first, "eth_chainId", [], 1),
      rpc(second, "eth_chainId", [], 2),
      rpc(first, "eth_getTransactionReceipt", [scan.destinationTransactionHash], 3),
      rpc(second, "eth_getTransactionReceipt", [scan.destinationTransactionHash], 4),
      rpc(first, "eth_getFinalizedBlock", [-3, false], 5),
      rpc(second, "eth_getFinalizedBlock", [-3, false], 6),
      rpc(first, "eth_blockNumber", [], 7),
      rpc(second, "eth_blockNumber", [], 8),
    ]);
  if (quantity(chainA, "direct_oft_chain_invalid") !== BigInt(DIRECT_CHZ_OFT.destinationChainId) ||
      quantity(chainB, "direct_oft_chain_invalid") !== BigInt(DIRECT_CHZ_OFT.destinationChainId)) {
    fail("direct_oft_chain_mismatch");
  }
  const a = parseReceipt(receiptA, scan);
  const b = parseReceipt(receiptB, scan);
  if (a.receivedWei !== b.receivedWei) fail("direct_oft_receipt_mismatch");
  const finalizedA = parsedBlock(finalA, "direct_oft_finalized_head_invalid");
  const finalizedB = parsedBlock(finalB, "direct_oft_finalized_head_invalid");
  const latestHeightA = quantity(latestA, "direct_oft_latest_head_invalid");
  const latestHeightB = quantity(latestB, "direct_oft_latest_head_invalid");
  for (const [finalized, latest] of [[finalizedA, latestHeightA], [finalizedB, latestHeightB]] as const) {
    if (finalized.number > latest || latest - finalized.number > MAX_FINALIZED_HEAD_LAG ||
        finalized.number < scan.destinationBlockNumber) fail("direct_oft_not_finalized");
  }
  const commonHeight = finalizedA.number < finalizedB.number ? finalizedA.number : finalizedB.number;
  const blockParam = (height: bigint) => [`0x${height.toString(16)}`, false] as const;
  const [receiptBlockA, receiptBlockB, commonA, commonB, finalBlockA, finalBlockB] =
    await Promise.all([
      rpc(first, "eth_getBlockByNumber", blockParam(scan.destinationBlockNumber), 9),
      rpc(second, "eth_getBlockByNumber", blockParam(scan.destinationBlockNumber), 10),
      rpc(first, "eth_getBlockByNumber", blockParam(commonHeight), 11),
      rpc(second, "eth_getBlockByNumber", blockParam(commonHeight), 12),
      rpc(first, "eth_getBlockByNumber", blockParam(finalizedA.number), 13),
      rpc(second, "eth_getBlockByNumber", blockParam(finalizedB.number), 14),
    ]);
  const anchorA = parsedBlock(receiptBlockA, "direct_oft_canonical_block_invalid");
  const anchorB = parsedBlock(receiptBlockB, "direct_oft_canonical_block_invalid");
  const commonBlockA = parsedBlock(commonA, "direct_oft_common_block_invalid");
  const commonBlockB = parsedBlock(commonB, "direct_oft_common_block_invalid");
  const headA = parsedBlock(finalBlockA, "direct_oft_finalized_head_invalid");
  const headB = parsedBlock(finalBlockB, "direct_oft_finalized_head_invalid");
  if (anchorA.number !== scan.destinationBlockNumber || anchorB.number !== scan.destinationBlockNumber ||
      anchorA.hash !== scan.destinationBlockHash || anchorB.hash !== scan.destinationBlockHash ||
      commonBlockA.number !== commonHeight || commonBlockB.number !== commonHeight ||
      commonBlockA.hash !== commonBlockB.hash || headA.number !== finalizedA.number ||
      headB.number !== finalizedB.number || headA.hash !== finalizedA.hash || headB.hash !== finalizedB.hash) {
    fail("direct_oft_canonical_mismatch");
  }
  const proof: DirectOftDeliveryProof = {
    kind: "direct_chz_oft_delivery",
    sourceEid: DIRECT_CHZ_OFT.sourceEid,
    destinationEid: DIRECT_CHZ_OFT.destinationEid,
    destinationChainId: DIRECT_CHZ_OFT.destinationChainId,
    sourceStore: DIRECT_CHZ_OFT.sourceStore,
    destinationAdapter: DIRECT_CHZ_OFT.destinationAdapter.toLowerCase(),
    sourceSignature: scan.sourceSignature,
    sourceTreasury: scan.sourceTreasury,
    destinationTreasury: scan.destinationTreasury,
    guid: scan.guid,
    destinationTransactionHash: scan.destinationTransactionHash,
    receiptBlockNumber: scan.destinationBlockNumber.toString(),
    receiptBlockHash: scan.destinationBlockHash,
    finalizedBlockNumber: commonHeight.toString(),
    receivedWei: a.receivedWei.toString(),
  };
  return { guid: scan.guid, destinationTransactionHash: scan.destinationTransactionHash,
    receiptBlockNumber: scan.destinationBlockNumber, receivedWei: a.receivedWei, proof };
}
