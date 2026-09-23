import assert from "node:assert/strict";
import test from "node:test";

import { verifyChilizDualRpcFinality, type ChilizReceiptAnchor } from "./chiliz-finality.ts";

const primaryRpcUrl = "https://rpc.chiliz.com";
const secondaryRpcUrl = "https://rpc.ankr.com/chiliz";
const transactionHash = `0x${"a".repeat(64)}`;
const hashAt = (height: bigint) => `0x${height.toString(16).padStart(64, "0")}`;
const receipt: ChilizReceiptAnchor = {
  transactionHash, blockHash: hashAt(256n), blockNumber: 256n, status: "success",
};

type RpcCall = { provider: "primary" | "secondary"; method: string; params: unknown[] };
type Override = (call: RpcCall, defaultResult: unknown) => unknown;

function mockRpc(expected: ChilizReceiptAnchor = receipt, override?: Override) {
  const calls: RpcCall[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const provider = new URL(input).origin === new URL(primaryRpcUrl).origin
      ? "primary" : "secondary";
    const request = JSON.parse(String(init?.body)) as {
      jsonrpc: string; id: number; method: string; params: unknown[];
    };
    const call: RpcCall = { provider, method: request.method, params: request.params };
    calls.push(call);
    let result: unknown;
    if (request.method === "eth_chainId") result = "0x15b38";
    else if (request.method === "eth_getTransactionReceipt") result = {
      transactionHash: expected.transactionHash,
      blockHash: expected.blockHash,
      blockNumber: `0x${expected.blockNumber.toString(16)}`,
      status: expected.status === "success" ? "0x1" : "0x0",
    };
    else if (request.method === "eth_getFinalizedBlock") {
      assert.deepEqual(request.params, [-3, false]);
      const height = provider === "primary" ? 300n : 299n;
      result = { number: `0x${height.toString(16)}`, hash: hashAt(height) };
    } else if (request.method === "eth_blockNumber") result = "0x12d";
    else if (request.method === "eth_getBlockByNumber") {
      assert.equal(request.params[1], false);
      assert.notEqual(request.params[0], "finalized");
      const height = BigInt(String(request.params[0]));
      result = { number: `0x${height.toString(16)}`, hash: hashAt(height) };
    } else assert.fail(`unexpected RPC method ${request.method}`);
    if (override) result = override(call, result);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

function verify(fetchImpl: NonNullable<Parameters<typeof verifyChilizDualRpcFinality>[0]["fetchImpl"]>,
  anchored: ChilizReceiptAnchor = receipt) {
  return verifyChilizDualRpcFinality({ primaryRpcUrl, secondaryRpcUrl,
    receipt: anchored, fetchImpl });
}

test("both independent Chiliz RPCs agree on receipt and canonical finalized chain", async () => {
  const mock = mockRpc();
  const proof = await verify(mock.fetchImpl);
  assert.deepEqual(proof, {
    chainId: 88888, transactionHash, receiptStatus: "success",
    receiptBlockNumber: 256n, receiptBlockHash: hashAt(256n),
    canonicalBlockHash: hashAt(256n), finalizedBlockNumber: 299n,
    primaryFinalizedBlockHash: hashAt(300n),
    secondaryFinalizedBlockHash: hashAt(299n),
  });
  assert.equal(mock.calls.filter((call) => call.method === "eth_getFinalizedBlock").length, 2);
  assert.equal(mock.calls.filter((call) => call.method === "eth_getTransactionReceipt").length, 2);
  assert.ok(!mock.calls.some((call) => call.params.includes("finalized")));
});

test("reverted receipt is an attributed terminal proof, not a successful payout", async () => {
  const reverted = { ...receipt, status: "reverted" as const };
  const proof = await verify(mockRpc(reverted).fetchImpl, reverted);
  assert.equal(proof.receiptStatus, "reverted");
  assert.equal(proof.finalizedBlockNumber, 299n);
});

test("requires independent HTTPS RPC origins and valid transaction anchor", async () => {
  const mock = mockRpc();
  await assert.rejects(verifyChilizDualRpcFinality({ primaryRpcUrl,
    secondaryRpcUrl: `${primaryRpcUrl}/different`, receipt, fetchImpl: mock.fetchImpl }),
  /rpcs_not_independent/);
  await assert.rejects(verifyChilizDualRpcFinality({ primaryRpcUrl: "http://rpc.chiliz.com",
    secondaryRpcUrl, receipt, fetchImpl: mock.fetchImpl }), /rpc_url_invalid/);
  await assert.rejects(verify(mock.fetchImpl, { ...receipt, blockHash: "0xzz" }),
    /receipt_invalid/);
  await assert.rejects(verify(mock.fetchImpl, { ...receipt, blockNumber: 0n }),
    /receipt_invalid/);
  assert.equal(mock.calls.length, 0);
});

test("chain mismatch or inconsistent receipts fail before accepting finality", async () => {
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_chainId" ? "0x1" : result).fetchImpl),
  /chain_mismatch/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_getTransactionReceipt"
      ? { ...(result as object), status: "0x0" } : result).fetchImpl), /receipt_mismatch/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_getTransactionReceipt"
      ? { ...(result as object), blockHash: hashAt(257n) } : result).fetchImpl),
  /receipt_mismatch/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "primary" && call.method === "eth_getTransactionReceipt"
      ? { ...(result as object), blockNumber: "0xzz" } : result).fetchImpl),
  /receipt_invalid/);
});

test("unsupported, genesis, future or lagging finalized RPC cannot establish proof", async () => {
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_getFinalizedBlock"
      ? null : result).fetchImpl), /rpc_invalid/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_getFinalizedBlock"
      ? { number: "0x0", hash: hashAt(0n) } : result).fetchImpl),
  /head_lagging/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_getFinalizedBlock"
      ? { number: "0xff", hash: hashAt(255n) } : result).fetchImpl),
  /head_lagging/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "primary" && call.method === "eth_getFinalizedBlock"
      ? { number: "0xffff", hash: hashAt(65_535n) } : result).fetchImpl),
  /head_lagging/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_blockNumber"
      ? "0x1000" : result).fetchImpl), /head_lagging/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "primary" && call.method === "eth_getFinalizedBlock"
      ? { number: "300", hash: hashAt(300n) } : result).fetchImpl),
  /head_invalid/);
});

test("both canonical receipt block and finalized ancestry must match", async () => {
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_getBlockByNumber" &&
      call.params[0] === "0x100" ? { number: "0x100", hash: hashAt(257n) } : result).fetchImpl),
  /canonical_mismatch/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "secondary" && call.method === "eth_getBlockByNumber" &&
      call.params[0] === "0x12b" ? { number: "0x12b", hash: hashAt(301n) } : result).fetchImpl),
  /canonical_mismatch/);
  await assert.rejects(verify(mockRpc(receipt, (call, result) =>
    call.provider === "primary" && call.method === "eth_getFinalizedBlock"
      ? { number: "0x12c", hash: hashAt(301n) } : result).fetchImpl),
  /canonical_mismatch/);
});
