import { CHILIZ_CHAIN, KAYEN } from "../../protocol/chiliz-reward-assets.ts";

const ONE_CHZ_WEI = 1_000_000_000_000_000_000n;
const GET_AMOUNTS_OUT_SELECTOR = "d06ca61f";
const cache = new Map<string, { expiresAt: number; value: ChilizRewardRouteStatus }>();

export type ChilizRewardRouteStatus = {
  available: boolean;
  checkedAt: string;
  inputAmountWei: string;
  outputAmountAtomic: string | null;
  router: "Kayen";
  reason: "available" | "no_route" | "provider_unavailable";
};

function word(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

function addressWord(address: string) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function encodeKayenGetAmountsOut(outputWrappedContract: string, amountIn = ONE_CHZ_WEI) {
  return `0x${GET_AMOUNTS_OUT_SELECTOR}${word(amountIn)}${word(64n)}${word(2n)}${addressWord(KAYEN.wrappedChz)}${addressWord(outputWrappedContract)}`;
}

export function decodeKayenGetAmountsOut(result: string) {
  const body = result.replace(/^0x/, "");
  if (body.length < 64 * 4) throw new Error("Kayen returned an invalid quote.");
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  const lengthStart = offset * 2;
  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthStart + 64)}`));
  if (length < 2) throw new Error("Kayen returned an empty quote.");
  const lastStart = lengthStart + 64 * length;
  return BigInt(`0x${body.slice(lastStart, lastStart + 64)}`);
}

async function checkUncached(outputWrappedContract: string): Promise<ChilizRewardRouteStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(process.env.CHILIZ_RPC_URL?.trim() || CHILIZ_CHAIN.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: KAYEN.router, data: encodeKayenGetAmountsOut(outputWrappedContract) }, "latest"],
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

export async function checkChilizRewardRoute(outputWrappedContract: string) {
  const key = outputWrappedContract.toLowerCase();
  const found = cache.get(key);
  if (found && found.expiresAt > Date.now()) return found.value;
  const value = await checkUncached(outputWrappedContract);
  cache.set(key, { value, expiresAt: Date.now() + 30_000 });
  return value;
}
