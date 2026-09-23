import { CHILIZ_CHAIN_ID } from "../protocol/chiliz-receipts.ts";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_FINALIZED_HEAD_LAG_BLOCKS = 128n;

export type ChilizReceiptAnchor = {
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  status: "success" | "reverted";
};

export type ChilizDualRpcFinalityProof = {
  chainId: typeof CHILIZ_CHAIN_ID;
  transactionHash: string;
  receiptStatus: "success" | "reverted";
  receiptBlockNumber: bigint;
  receiptBlockHash: string;
  canonicalBlockHash: string;
  finalizedBlockNumber: bigint;
  primaryFinalizedBlockHash: string;
  secondaryFinalizedBlockHash: string;
};

type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type RpcContext = { url: string; fetchImpl: RpcFetch; timeoutMs: number };

function fail(code: string): never { throw new Error(code); }
function hash(value: unknown, code: string): string {
  if (typeof value !== "string" || !HASH.test(value)) fail(code);
  return value.toLowerCase();
}
function quantity(value: unknown, code: string): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value)) fail(code);
  return BigInt(value);
}
function block(value: unknown, code: string): { number: bigint; hash: string } {
  if (!value || typeof value !== "object") fail(code);
  const record = value as Record<string, unknown>;
  return { number: quantity(record.number, code), hash: hash(record.hash, code) };
}
function endpoint(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return fail("chiliz_finality_rpc_url_invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    fail("chiliz_finality_rpc_url_invalid");
  }
  return parsed;
}
function status(value: unknown): "success" | "reverted" {
  if (value === "0x1") return "success";
  if (value === "0x0") return "reverted";
  return fail("chiliz_finality_receipt_status_invalid");
}

async function rpc(context: RpcContext, method: string, params: unknown[], id: number): Promise<unknown> {
  let response: Response;
  try {
    response = await context.fetchImpl(context.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(context.timeoutMs),
    });
  } catch { return fail("chiliz_finality_rpc_unavailable"); }
  if (!response.ok) fail("chiliz_finality_rpc_unavailable");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { return fail("chiliz_finality_rpc_invalid"); }
  if (!payload || typeof payload !== "object") fail("chiliz_finality_rpc_invalid");
  const record = payload as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || record.id !== id || record.error || record.result == null) {
    fail("chiliz_finality_rpc_invalid");
  }
  return record.result;
}

function matchingReceipt(value: unknown, expected: ChilizReceiptAnchor) {
  if (!value || typeof value !== "object") fail("chiliz_finality_receipt_missing");
  const receipt = value as Record<string, unknown>;
  const transactionHash = hash(receipt.transactionHash, "chiliz_finality_receipt_invalid");
  const blockHash = hash(receipt.blockHash, "chiliz_finality_receipt_invalid");
  const blockNumber = quantity(receipt.blockNumber, "chiliz_finality_receipt_invalid");
  const receiptStatus = status(receipt.status);
  if (transactionHash !== expected.transactionHash.toLowerCase() ||
      blockHash !== expected.blockHash.toLowerCase() ||
      blockNumber !== expected.blockNumber || receiptStatus !== expected.status) {
    fail("chiliz_finality_receipt_mismatch");
  }
}

/** Chiliz's EVM-compatible RPCs may return genesis for the standard
 * `eth_getBlockByNumber('finalized')` tag. Use the Chiliz/BSC-style custom
 * `eth_getFinalizedBlock(-3,false)` response from two independent RPC origins
 * instead. This function performs no transaction and never substitutes latest
 * for finalized. Both providers must independently agree on the receipt and
 * its canonical block and have finalized at or beyond that block. */
export async function verifyChilizDualRpcFinality(input: {
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  receipt: ChilizReceiptAnchor;
  fetchImpl?: RpcFetch;
  timeoutMs?: number;
}): Promise<ChilizDualRpcFinalityProof> {
  const primary = endpoint(input.primaryRpcUrl);
  const secondary = endpoint(input.secondaryRpcUrl);
  if (primary.origin.toLowerCase() === secondary.origin.toLowerCase()) {
    fail("chiliz_finality_rpcs_not_independent");
  }
  const expected = input.receipt;
  const transactionHash = hash(expected.transactionHash, "chiliz_finality_receipt_invalid");
  const receiptBlockHash = hash(expected.blockHash, "chiliz_finality_receipt_invalid");
  if (typeof expected.blockNumber !== "bigint" || expected.blockNumber <= 0n ||
      !["success", "reverted"].includes(expected.status)) {
    fail("chiliz_finality_receipt_invalid");
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    fail("chiliz_finality_timeout_invalid");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const a = { url: primary.href, fetchImpl, timeoutMs };
  const b = { url: secondary.href, fetchImpl, timeoutMs };
  const [chainA, chainB, receiptA, receiptB, finalizedA, finalizedB,
    latestA, latestB] = await Promise.all([
    rpc(a, "eth_chainId", [], 1), rpc(b, "eth_chainId", [], 2),
    rpc(a, "eth_getTransactionReceipt", [transactionHash], 3),
    rpc(b, "eth_getTransactionReceipt", [transactionHash], 4),
    rpc(a, "eth_getFinalizedBlock", [-3, false], 5),
    rpc(b, "eth_getFinalizedBlock", [-3, false], 6),
    rpc(a, "eth_blockNumber", [], 7), rpc(b, "eth_blockNumber", [], 8),
  ]);
  if (quantity(chainA, "chiliz_finality_chain_invalid") !== BigInt(CHILIZ_CHAIN_ID) ||
      quantity(chainB, "chiliz_finality_chain_invalid") !== BigInt(CHILIZ_CHAIN_ID)) {
    fail("chiliz_finality_chain_mismatch");
  }
  matchingReceipt(receiptA, expected);
  matchingReceipt(receiptB, expected);
  const finalA = block(finalizedA, "chiliz_finality_head_invalid");
  const finalB = block(finalizedB, "chiliz_finality_head_invalid");
  const latestHeightA = quantity(latestA, "chiliz_finality_latest_invalid");
  const latestHeightB = quantity(latestB, "chiliz_finality_latest_invalid");
  if (finalA.number === 0n || finalB.number === 0n ||
      finalA.number > latestHeightA || finalB.number > latestHeightB ||
      latestHeightA - finalA.number > MAX_FINALIZED_HEAD_LAG_BLOCKS ||
      latestHeightB - finalB.number > MAX_FINALIZED_HEAD_LAG_BLOCKS ||
      finalA.number < expected.blockNumber || finalB.number < expected.blockNumber) {
    fail("chiliz_finality_head_lagging");
  }
  const minFinalized = finalA.number < finalB.number ? finalA.number : finalB.number;
  const receiptQuantity = `0x${expected.blockNumber.toString(16)}`;
  const minimumQuantity = `0x${minFinalized.toString(16)}`;
  const [canonicalReceiptA, canonicalReceiptB, canonicalMinimumA,
    canonicalMinimumB, canonicalFinalA, canonicalFinalB] = await Promise.all([
    rpc(a, "eth_getBlockByNumber", [receiptQuantity, false], 9),
    rpc(b, "eth_getBlockByNumber", [receiptQuantity, false], 10),
    rpc(a, "eth_getBlockByNumber", [minimumQuantity, false], 11),
    rpc(b, "eth_getBlockByNumber", [minimumQuantity, false], 12),
    rpc(a, "eth_getBlockByNumber", [`0x${finalA.number.toString(16)}`, false], 13),
    rpc(b, "eth_getBlockByNumber", [`0x${finalB.number.toString(16)}`, false], 14),
  ]);
  const anchorA = block(canonicalReceiptA, "chiliz_finality_canonical_block_missing");
  const anchorB = block(canonicalReceiptB, "chiliz_finality_canonical_block_missing");
  const commonA = block(canonicalMinimumA, "chiliz_finality_common_block_missing");
  const commonB = block(canonicalMinimumB, "chiliz_finality_common_block_missing");
  const finalCanonicalA = block(canonicalFinalA, "chiliz_finality_head_invalid");
  const finalCanonicalB = block(canonicalFinalB, "chiliz_finality_head_invalid");
  if (anchorA.number !== expected.blockNumber || anchorB.number !== expected.blockNumber ||
      anchorA.hash !== receiptBlockHash || anchorB.hash !== receiptBlockHash ||
      commonA.number !== minFinalized || commonB.number !== minFinalized ||
      commonA.hash !== commonB.hash ||
      finalCanonicalA.number !== finalA.number || finalCanonicalA.hash !== finalA.hash ||
      finalCanonicalB.number !== finalB.number || finalCanonicalB.hash !== finalB.hash) {
    fail("chiliz_finality_canonical_mismatch");
  }
  return { chainId: CHILIZ_CHAIN_ID, transactionHash, receiptStatus: expected.status,
    receiptBlockNumber: expected.blockNumber, receiptBlockHash,
    canonicalBlockHash: anchorA.hash, finalizedBlockNumber: minFinalized,
    primaryFinalizedBlockHash: finalA.hash, secondaryFinalizedBlockHash: finalB.hash };
}
