import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from "viem";
import { CHILIZ_CHAIN, getChilizRewardAsset, KAYEN } from "../../protocol/chiliz-reward-assets.ts";

const KAYEN_ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function decimals() view returns (uint8)",
]);
const MIN_INPUT_WEI = 10_000_000_000_000_000n; // 0.01 CHZ.
const MAX_INPUT_WEI = 10_000_000_000_000_000_000n; // 10 CHZ per canary-sized purchase.
const MIN_OUTPUT_ATOMIC = 1_000_000_000_000n;
const MAX_SLIPPAGE_BPS = 100n;
const DEADLINE_SECONDS = 120n;
const MAX_GAS_UNITS = 400_000n;
const MAX_FEE_PER_GAS_WEI = 10_000_000_000_000n;
const MAX_GAS_COST_WEI = 1_000_000_000_000_000_000n; // 1 CHZ.

type RpcFetch = typeof fetch;
type Hex = `0x${string}`;

export type ChilizV2BuyPlan = {
  readonly symbol: string;
  readonly chainId: 88888;
  readonly blockNumber: string;
  readonly router: Hex;
  readonly fanToken: Hex;
  readonly treasury: Hex;
  readonly amountInWei: string;
  readonly quotedOutputAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly simulatedOutputAtomic: string;
  readonly slippageBps: 100;
  readonly deadlineUnixSeconds: string;
  readonly nonce: string;
  readonly gasLimit: string;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
  readonly maximumGasCostWei: string;
  readonly transaction: {
    readonly to: Hex;
    readonly from: Hex;
    readonly value: Hex;
    readonly data: Hex;
    readonly chainId: 88888;
    readonly nonce: number;
    readonly gas: bigint;
    readonly maxFeePerGas: bigint;
    readonly maxPriorityFeePerGas: bigint;
    readonly type: "eip1559";
  };
  readonly executionEnabled: false;
};

function fail(code: string): never { throw new Error(`chiliz_v2_buy_plan_${code}`); }

function parseAtomic(value: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) fail("amount_invalid");
  return BigInt(value);
}

async function rpc(rpcUrl: string, method: string, params: unknown[], fetcher: RpcFetch): Promise<unknown> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail("rpc_unavailable");
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error || payload.result == null) fail(`rpc_${method}_failed`);
  return payload.result;
}

function hexResult(result: unknown): Hex {
  if (typeof result !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) fail("rpc_result_invalid");
  return result as Hex;
}

function hexQuantity(result: unknown): bigint {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) fail("rpc_quantity_invalid");
  return BigInt(result);
}

/**
 * Prepare only an unsigned, simulated native-CHZ purchase of an official
 * current V2 Fan Token. This is not an authorization to sign or broadcast.
 */
export async function prepareChilizV2BuyPlan(input: {
  symbol: string;
  amountInWei: string;
  treasury: string;
  nowUnixSeconds?: number;
  rpcUrl?: string;
  fetcher?: RpcFetch;
}): Promise<ChilizV2BuyPlan> {
  const asset = getChilizRewardAsset(input.symbol);
  if (!asset || !/^0x[0-9a-fA-F]{40}$/.test(asset.currentV2Contract)) fail("asset_not_registered");
  let treasury: Hex;
  try { treasury = getAddress(input.treasury); }
  catch { return fail("treasury_invalid"); }
  if (treasury !== input.treasury) fail("treasury_not_checksummed");
  const amount = parseAtomic(input.amountInWei);
  if (amount < MIN_INPUT_WEI || amount > MAX_INPUT_WEI) fail("amount_outside_canary_bounds");
  const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || now <= 0) fail("time_invalid");
  const rpcUrl = input.rpcUrl ?? process.env.CHILIZ_RPC_URL?.trim() ?? CHILIZ_CHAIN.rpcUrl;
  const fetcher = input.fetcher ?? fetch;
  const chainId = hexQuantity(await rpc(rpcUrl, "eth_chainId", [], fetcher));
  if (chainId !== 88_888n) fail("wrong_chain");
  const blockNumber = hexQuantity(await rpc(rpcUrl, "eth_blockNumber", [], fetcher));
  if (blockNumber <= 0n) fail("block_invalid");
  const block = `0x${blockNumber.toString(16)}` as Hex;
  const router = getAddress(KAYEN.router);
  const token = getAddress(asset.currentV2Contract);
  const wrappedChz = getAddress(KAYEN.wrappedChz);
  const [routerCode, tokenCode] = await Promise.all([
    rpc(rpcUrl, "eth_getCode", [router, block], fetcher),
    rpc(rpcUrl, "eth_getCode", [token, block], fetcher),
  ]);
  if (hexResult(routerCode) === "0x" || hexResult(tokenCode) === "0x") fail("contract_missing");
  const decimalsRaw = hexResult(await rpc(rpcUrl, "eth_call", [{
    to: token,
    data: encodeFunctionData({ abi: KAYEN_ROUTER_ABI, functionName: "decimals" }),
  }, block], fetcher));
  const decimals = decodeFunctionResult({ abi: KAYEN_ROUTER_ABI, functionName: "decimals", data: decimalsRaw });
  if (decimals !== 18) fail("wrong_decimals");
  const path = [wrappedChz, token] as const;
  const quotedRaw = hexResult(await rpc(rpcUrl, "eth_call", [{
    to: router,
    data: encodeFunctionData({ abi: KAYEN_ROUTER_ABI, functionName: "getAmountsOut", args: [amount, [...path]] }),
  }, block], fetcher));
  const amounts = decodeFunctionResult({ abi: KAYEN_ROUTER_ABI, functionName: "getAmountsOut", data: quotedRaw });
  if (amounts.length !== 2 || amounts[0] !== amount || amounts[1] < MIN_OUTPUT_ATOMIC) fail("quote_invalid");
  const minimumOutput = amounts[1] * (10_000n - MAX_SLIPPAGE_BPS) / 10_000n;
  if (minimumOutput < MIN_OUTPUT_ATOMIC) fail("minimum_output_dust");
  const deadline = BigInt(now) + DEADLINE_SECONDS;
  const call = {
    to: router,
    from: treasury,
    value: `0x${amount.toString(16)}` as Hex,
    data: encodeFunctionData({ abi: KAYEN_ROUTER_ABI, functionName: "swapExactETHForTokens",
      args: [minimumOutput, [...path], treasury, deadline] }),
  };
  // Actual funded balance is used here. No state overrides in production.
  const simulatedRaw = hexResult(await rpc(rpcUrl, "eth_call", [call, "latest"], fetcher));
  const simulated = decodeFunctionResult({ abi: KAYEN_ROUTER_ABI, functionName: "swapExactETHForTokens", data: simulatedRaw });
  if (simulated.length !== 2 || simulated[0] !== amount || simulated[1] < minimumOutput) fail("simulation_output_invalid");
  const [estimatedRaw, blockRaw, priorityRaw, nonceRaw] = await Promise.all([
    rpc(rpcUrl, "eth_estimateGas", [call], fetcher),
    rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false], fetcher),
    rpc(rpcUrl, "eth_maxPriorityFeePerGas", [], fetcher),
    rpc(rpcUrl, "eth_getTransactionCount", [treasury, "pending"], fetcher),
  ]);
  const estimatedGas = hexQuantity(estimatedRaw);
  if (!blockRaw || typeof blockRaw !== "object" || Array.isArray(blockRaw)) fail("fee_block_invalid");
  const baseFee = hexQuantity((blockRaw as { baseFeePerGas?: unknown }).baseFeePerGas);
  const priorityFee = hexQuantity(priorityRaw);
  const maxFeePerGas = baseFee * 2n + priorityFee;
  const nonce = hexQuantity(nonceRaw);
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (estimatedGas <= 0n || gasLimit > MAX_GAS_UNITS || baseFee <= 0n ||
      priorityFee <= 0n || maxFeePerGas > MAX_FEE_PER_GAS_WEI ||
      gasLimit * maxFeePerGas > MAX_GAS_COST_WEI ||
      nonce > BigInt(Number.MAX_SAFE_INTEGER)) fail("gas_or_nonce_outside_canary_bounds");
  const transaction = { ...call, chainId: 88888 as const, nonce: Number(nonce),
    gas: gasLimit, maxFeePerGas, maxPriorityFeePerGas: priorityFee, type: "eip1559" as const };
  return {
    symbol: asset.symbol, chainId: 88888, blockNumber: blockNumber.toString(), router,
    fanToken: token, treasury, amountInWei: amount.toString(), quotedOutputAtomic: amounts[1].toString(),
    minimumOutputAtomic: minimumOutput.toString(), simulatedOutputAtomic: simulated[1].toString(),
    slippageBps: 100, deadlineUnixSeconds: deadline.toString(),
    nonce: nonce.toString(), gasLimit: gasLimit.toString(),
    maxFeePerGasWei: maxFeePerGas.toString(), maxPriorityFeePerGasWei: priorityFee.toString(),
    maximumGasCostWei: (gasLimit * maxFeePerGas).toString(), transaction,
    executionEnabled: false,
  };
}
