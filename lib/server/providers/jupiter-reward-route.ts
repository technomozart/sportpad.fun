import "server-only";

import { readProviderCredentials } from "./runtime-config";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const QUOTE_AMOUNT_LAMPORTS = "10000000";
const JUPITER_ORDER_ENDPOINT = "https://api.jup.ag/swap/v2/order";

export type RewardRouteStatus = {
  available: boolean;
  checkedAt: string;
  inputAmountLamports: string;
  outputAmountAtomic: string | null;
  router: string | null;
  reason: "available" | "no_route" | "provider_unavailable" | "not_configured";
};

const ROUTE_CACHE_MS = 30_000;
const routeCache = new Map<string, { value: RewardRouteStatus; expiresAt: number }>();
const routeChecks = new Map<string, Promise<RewardRouteStatus>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function checkRewardRouteUncached(outputMint: string): Promise<RewardRouteStatus> {
  const checkedAt = new Date().toISOString();
  const { jupiterApiKey } = readProviderCredentials();
  if (!jupiterApiKey) {
    return { available: false, checkedAt, inputAmountLamports: QUOTE_AMOUNT_LAMPORTS, outputAmountAtomic: null, router: null, reason: "not_configured" };
  }
  const endpoint = new URL(JUPITER_ORDER_ENDPOINT);
  endpoint.searchParams.set("inputMint", WRAPPED_SOL_MINT);
  endpoint.searchParams.set("outputMint", outputMint);
  endpoint.searchParams.set("amount", QUOTE_AMOUNT_LAMPORTS);
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json", "x-api-key": jupiterApiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    if (response.status === 400 && isRecord(body) && body.error === "Failed to get quotes") {
      return { available: false, checkedAt, inputAmountLamports: QUOTE_AMOUNT_LAMPORTS, outputAmountAtomic: null, router: null, reason: "no_route" };
    }
    if (!response.ok || !isRecord(body)) {
      return { available: false, checkedAt, inputAmountLamports: QUOTE_AMOUNT_LAMPORTS, outputAmountAtomic: null, router: null, reason: "provider_unavailable" };
    }
    const outputAmountAtomic = typeof body.outAmount === "string" && /^[1-9]\d*$/.test(body.outAmount) ? body.outAmount : null;
    if (!outputAmountAtomic) {
      return { available: false, checkedAt, inputAmountLamports: QUOTE_AMOUNT_LAMPORTS, outputAmountAtomic: null, router: null, reason: "no_route" };
    }
    return {
      available: true,
      checkedAt,
      inputAmountLamports: QUOTE_AMOUNT_LAMPORTS,
      outputAmountAtomic,
      router: typeof body.router === "string" ? body.router : null,
      reason: "available",
    };
  } catch {
    return { available: false, checkedAt, inputAmountLamports: QUOTE_AMOUNT_LAMPORTS, outputAmountAtomic: null, router: null, reason: "provider_unavailable" };
  }
}

export async function checkRewardRoute(outputMint: string): Promise<RewardRouteStatus> {
  const now = Date.now();
  const cached = routeCache.get(outputMint);
  if (cached && cached.expiresAt > now) return cached.value;
  let inFlight = routeChecks.get(outputMint);
  if (!inFlight) {
    inFlight = checkRewardRouteUncached(outputMint);
    routeChecks.set(outputMint, inFlight);
  }
  try {
    const value = await inFlight;
    routeCache.set(outputMint, { value, expiresAt: now + ROUTE_CACHE_MS });
    return value;
  } finally {
    routeChecks.delete(outputMint);
  }
}
