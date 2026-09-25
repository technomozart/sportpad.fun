import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChilizRewardAsset, KAYEN } from "../../protocol/chiliz-reward-assets.ts";
import { createChilizSignedIntent } from "../../protocol/chiliz-signed-intent.ts";
import { prepareChilizV2BuyPlan } from "./chiliz-v2-buy-plan.ts";

const abi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function decimals() view returns (uint8)",
]);
const amount = 10_000_000_000_000_000n;
const output = 5_000_000_000_000_000_000n;
const treasury = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";

function mockRpc(options: { chainId?: string; quoteOutput?: bigint; simulateOutput?: bigint;
  baseFee?: string } = {}) {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push(req);
    let result: unknown;
    if (req.method === "eth_chainId") result = options.chainId ?? "0x15b38";
    if (req.method === "eth_blockNumber") result = "0xabc";
    if (req.method === "eth_estimateGas") result = "0x249f0";
    if (req.method === "eth_getBlockByNumber") result = {
      baseFeePerGas: options.baseFee ?? "0x246139ca800",
    };
    if (req.method === "eth_maxPriorityFeePerGas") result = "0x3b9aca00";
    if (req.method === "eth_getTransactionCount") result = "0x0";
    if (req.method === "eth_getCode") result = "0x6000";
    if (req.method === "eth_call") {
      const tx = req.params[0] as { to: string; data: `0x${string}`; from?: string; value?: string };
      if (tx.to.toLowerCase() === KAYEN.router.toLowerCase()) {
        const decoded = decodeFunctionData({ abi, data: tx.data });
        if (decoded.functionName === "getAmountsOut") {
          result = encodeFunctionResult({ abi, functionName: "getAmountsOut",
            result: [amount, options.quoteOutput ?? output] });
        } else {
          result = encodeFunctionResult({ abi, functionName: "swapExactETHForTokens",
            result: [amount, options.simulateOutput ?? output] });
        }
      } else {
        result = encodeFunctionResult({ abi, functionName: "decimals", result: 18 });
      }
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

test("V2 buy plan quotes and simulates native CHZ to the registered current Fan Token only", async () => {
  const { calls, fetcher } = mockRpc();
  const plan = await prepareChilizV2BuyPlan({ symbol: "ACM", amountInWei: amount.toString(), treasury,
    nowUnixSeconds: 1_800_000_000, fetcher });
  assert.equal(plan.executionEnabled, false);
  assert.equal(plan.chainId, 88888);
  assert.equal(plan.blockNumber, "2748");
  assert.equal(plan.fanToken.toLowerCase(), getChilizRewardAsset("ACM")?.currentV2Contract.toLowerCase());
  assert.equal(plan.minimumOutputAtomic, (output * 99n / 100n).toString());
  assert.equal(plan.transaction.value, `0x${amount.toString(16)}`);
  assert.equal(calls.filter((call) => call.method === "eth_call").length, 3);
  assert.equal(plan.transaction.type, "eip1559");
  assert.equal(plan.transaction.nonce, 0);
  assert.equal(plan.gasLimit, "180000");
  assert.ok(BigInt(plan.maximumGasCostWei) < 1_000_000_000_000_000_000n);
  const decoded = decodeFunctionData({ abi, data: plan.transaction.data });
  assert.equal(decoded.functionName, "swapExactETHForTokens");
  assert.deepEqual(decoded.args?.[1]?.map((part: string) => part.toLowerCase()),
    [KAYEN.wrappedChz.toLowerCase(), plan.fanToken.toLowerCase()]);
  assert.equal(decoded.args?.[2], treasury);
  assert.equal(decoded.args?.[3], 1_800_000_120n);
  const simulated = calls.find((call) => call.method === "eth_call" &&
    (call.params[0] as { from?: string }).from)?.params[0] as { from: string; value: string; chainId?: number };
  assert.equal(simulated.from, treasury);
  assert.equal(simulated.value, plan.transaction.value);
  assert.equal(simulated.chainId, undefined);
});

test("V2 buy plan fails closed on unknown asset, wrong chain, or inadequate simulation", async () => {
  await assert.rejects(() => prepareChilizV2BuyPlan({ symbol: "FAKE", amountInWei: amount.toString(), treasury }),
    /asset_not_registered/);
  await assert.rejects(() => prepareChilizV2BuyPlan({ symbol: "ACM", amountInWei: amount.toString(), treasury,
    fetcher: mockRpc({ chainId: "0x1" }).fetcher }), /wrong_chain/);
  await assert.rejects(() => prepareChilizV2BuyPlan({ symbol: "ACM", amountInWei: amount.toString(), treasury,
    fetcher: mockRpc({ quoteOutput: 1n }).fetcher }), /quote_invalid/);
  await assert.rejects(() => prepareChilizV2BuyPlan({ symbol: "ACM", amountInWei: amount.toString(), treasury,
    fetcher: mockRpc({ simulateOutput: output / 2n }).fetcher }), /simulation_output_invalid/);
  await assert.rejects(() => prepareChilizV2BuyPlan({ symbol: "ACM", amountInWei: amount.toString(), treasury,
    fetcher: mockRpc({ baseFee: `0x${6_000_000_000_000n.toString(16)}` }).fetcher }),
    /gas_or_nonce_outside_canary_bounds/);
});

test("V2 canary plan is compatible with the existing recovered EIP-1559 purchase intent", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const plan = await prepareChilizV2BuyPlan({ symbol: "ACM", amountInWei: amount.toString(),
    treasury: account.address, nowUnixSeconds: 1_800_000_000, fetcher: mockRpc().fetcher });
  const { from: _from, value, ...unsigned } = plan.transaction;
  assert.equal(_from, account.address);
  const rawTransaction = await account.signTransaction({ ...unsigned, value: BigInt(value) });
  const intent = await createChilizSignedIntent({ kind: "purchase", jobId: "v2_canary_test",
    attempt: 1, treasury: account.address, fanTokenContract: plan.fanToken,
    maxPrincipalWei: plan.amountInWei, minimumOutputAtomic: plan.minimumOutputAtomic,
    signedAtEpochSeconds: 1_800_000_000, deadlineEpochSeconds: 1_800_000_120,
    rawTransaction, gasFeeCeilingWei: plan.maximumGasCostWei });
  assert.equal(intent.treasury, account.address);
  assert.equal(intent.maximumTotalSpendWei,
    (amount + BigInt(plan.maximumGasCostWei)).toString());
});
