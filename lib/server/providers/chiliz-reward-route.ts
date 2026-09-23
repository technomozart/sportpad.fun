import { CHILIZ_CHAIN, KAYEN } from "../../protocol/chiliz-reward-assets.ts";

const ONE_CHZ_WEI = 1_000_000_000_000_000_000n;
const AUDIT_ORDER_CHZ_WEI = 100n * ONE_CHZ_WEI;
const MIN_V2_OUTPUT_ATOMIC = 1_000_000_000_000n;
const GET_AMOUNTS_OUT_SELECTOR = "d06ca61f";
const DECIMALS_SELECTOR = "0x313ce567";
const cache = new Map<string, { expiresAt: number; value: ChilizRewardRouteStatus }>();
const auditCache = new Map<string, { expiresAt: number; value: ChilizV2MarketAudit }>();

export type ChilizRewardRouteStatus = {
  available: boolean;
  checkedAt: string;
  inputAmountWei: string;
  outputAmountAtomic: string | null;
  router: "Kayen";
  reason: "available" | "no_route" | "provider_unavailable";
};

export type ChilizV2MarketAudit = {
  checkedAt: string;
  quoteAvailable: boolean;
  executionApproved: false;
  tokenDecimals: number | null;
  oneChzOutputAtomic: string | null;
  hundredChzOutputAtomic: string | null;
  depthImpactBps: number | null;
  reason: "quote_available" | "shallow_depth" | "dust_quote" | "no_route" | "quote_failed" | "wrong_chain" | "wrong_decimals" | "no_contract" | "provider_unavailable";
};

type RpcFetch = typeof fetch;

async function rpcCall(rpcUrl: string, method: string, params: unknown[], fetcher: RpcFetch) {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Chiliz RPC unavailable.");
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error || typeof payload.result !== "string") throw new Error("Chiliz RPC call failed.");
  return payload.result;
}

function word(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

function addressWord(address: string) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function encodeKayenGetAmountsOut(outputTokenContract: string, amountIn = ONE_CHZ_WEI) {
  return `0x${GET_AMOUNTS_OUT_SELECTOR}${word(amountIn)}${word(64n)}${word(2n)}${addressWord(KAYEN.wrappedChz)}${addressWord(outputTokenContract)}`;
}

export function decodeKayenGetAmountsOut(result: string) {
  const body = result.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(body) || body.length < 64 * 4 || body.length % 64 !== 0) {
    throw new Error("Kayen returned an invalid quote.");
  }
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  if (!Number.isSafeInteger(offset) || offset !== 32) throw new Error("Kayen returned an invalid quote.");
  const lengthStart = offset * 2;
  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthStart + 64)}`));
  if (length !== 2 || body.length !== lengthStart + 64 * (length + 1)) {
    throw new Error("Kayen returned an invalid quote.");
  }
  const lastStart = lengthStart + 64 * length;
  return BigInt(`0x${body.slice(lastStart, lastStart + 64)}`);
}

export function calculateChilizDepthImpactBps(oneChzOutput: bigint, hundredChzOutput: bigint) {
  if (oneChzOutput <= 0n || hundredChzOutput <= 0n) throw new Error("Kayen quote output must be positive.");
  const linearOutput = oneChzOutput * 100n;
  if (hundredChzOutput >= linearOutput) return 0;
  return Number((linearOutput - hundredChzOutput) * 10_000n / linearOutput);
}

export async function inspectChilizV2Market(
  outputTokenContract: string,
  options: { rpcUrl?: string; fetcher?: RpcFetch } = {},
): Promise<ChilizV2MarketAudit> {
  const checkedAt = new Date().toISOString();
  const result = (reason: ChilizV2MarketAudit["reason"], details: Partial<ChilizV2MarketAudit> = {}): ChilizV2MarketAudit => ({
    checkedAt, quoteAvailable: reason === "quote_available" || reason === "shallow_depth",
    executionApproved: false, tokenDecimals: null, oneChzOutputAtomic: null,
    hundredChzOutputAtomic: null, depthImpactBps: null, reason, ...details,
  });
  if (!/^0x[0-9a-fA-F]{40}$/.test(outputTokenContract)) return result("no_contract");
  const rpcUrl = options.rpcUrl ?? process.env.CHILIZ_RPC_URL?.trim() ?? CHILIZ_CHAIN.rpcUrl;
  const fetcher = options.fetcher ?? fetch;
  try {
    const chainId = BigInt(await rpcCall(rpcUrl, "eth_chainId", [], fetcher));
    if (chainId !== BigInt(CHILIZ_CHAIN.id)) return result("wrong_chain");
    const code = await rpcCall(rpcUrl, "eth_getCode", [outputTokenContract, "latest"], fetcher);
    if (code === "0x" || code === "0x0") return result("no_contract");
    const decimalsRaw = await rpcCall(rpcUrl, "eth_call", [{ to: outputTokenContract, data: DECIMALS_SELECTOR }, "latest"], fetcher);
    const decimals = Number(BigInt(decimalsRaw));
    if (decimals !== 18) return result("wrong_decimals", { tokenDecimals: Number.isSafeInteger(decimals) ? decimals : null });
    let one: bigint;
    let hundred: bigint;
    try {
      const [oneRaw, hundredRaw] = await Promise.all([
        rpcCall(rpcUrl, "eth_call", [{ to: KAYEN.router, data: encodeKayenGetAmountsOut(outputTokenContract) }, "latest"], fetcher),
        rpcCall(rpcUrl, "eth_call", [{ to: KAYEN.router, data: encodeKayenGetAmountsOut(outputTokenContract, AUDIT_ORDER_CHZ_WEI) }, "latest"], fetcher),
      ]);
      one = decodeKayenGetAmountsOut(oneRaw);
      hundred = decodeKayenGetAmountsOut(hundredRaw);
    } catch {
      return result("quote_failed", { tokenDecimals: decimals });
    }
    if (one <= 0n || hundred <= 0n) return result("no_route", { tokenDecimals: decimals });
    if (one < MIN_V2_OUTPUT_ATOMIC || hundred < MIN_V2_OUTPUT_ATOMIC) {
      return result("dust_quote", { tokenDecimals: decimals,
        oneChzOutputAtomic: one.toString(), hundredChzOutputAtomic: hundred.toString() });
    }
    const depthImpactBps = calculateChilizDepthImpactBps(one, hundred);
    return result(depthImpactBps > 2_000 ? "shallow_depth" : "quote_available", {
      tokenDecimals: decimals,
      oneChzOutputAtomic: one.toString(),
      hundredChzOutputAtomic: hundred.toString(),
      depthImpactBps,
    });
  } catch {
    return result("provider_unavailable");
  }
}

export async function checkChilizV2Market(outputTokenContract: string) {
  const key = outputTokenContract.toLowerCase();
  const found = auditCache.get(key);
  if (found && found.expiresAt > Date.now()) return found.value;
  const value = await inspectChilizV2Market(outputTokenContract);
  auditCache.set(key, { value, expiresAt: Date.now() + 30_000 });
  return value;
}

async function checkUncached(outputTokenContract: string): Promise<ChilizRewardRouteStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(process.env.CHILIZ_RPC_URL?.trim() || CHILIZ_CHAIN.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: KAYEN.router, data: encodeKayenGetAmountsOut(outputTokenContract) }, "latest"],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Chiliz RPC returned ${response.status}.`);
    const payload = await response.json() as { result?: string; error?: unknown };
    if (!payload.result || payload.error) {
      return { available: false, checkedAt, inputAmountWei: ONE_CHZ_WEI.toString(), outputAmountAtomic: null, router: "Kayen", reason: "no_route" };
    }
    const output = decodeKayenGetAmountsOut(payload.result);
    return {
      available: output > 0n,
      checkedAt,
      inputAmountWei: ONE_CHZ_WEI.toString(),
      outputAmountAtomic: output > 0n ? output.toString() : null,
      router: "Kayen",
      reason: output > 0n ? "available" : "no_route",
    };
  } catch {
    return { available: false, checkedAt, inputAmountWei: ONE_CHZ_WEI.toString(), outputAmountAtomic: null, router: "Kayen", reason: "provider_unavailable" };
  }
}

export async function checkChilizRewardRoute(outputTokenContract: string) {
  const key = outputTokenContract.toLowerCase();
  const found = cache.get(key);
  if (found && found.expiresAt > Date.now()) return found.value;
  const value = await checkUncached(outputTokenContract);
  cache.set(key, { value, expiresAt: Date.now() + 30_000 });
  return value;
}
