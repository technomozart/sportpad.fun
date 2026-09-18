import type {
  CanaryOptions,
  ProviderCanaryStatus,
  ProviderDetail,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 3_000;
const HELIUS_RPC_ORIGIN = "https://mainnet.helius-rpc.com/";
const JUPITER_QUOTE_ENDPOINT = "https://api.jup.ag/swap/v1/quote";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function result(
  configured: boolean,
  healthy: boolean,
  detail: ProviderDetail,
  now: () => Date,
): ProviderCanaryStatus {
  return {
    configured,
    healthy,
    checkedAt: now().toISOString(),
    detail,
  };
}

function classifyHttpStatus(status: number): ProviderDetail {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "rate_limited";
  return "upstream_unavailable";
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) throw new CanaryFailure("timeout");
    throw new CanaryFailure("network_error");
  } finally {
    clearTimeout(timeout);
  }
}

class CanaryFailure extends Error {
  readonly detail: ProviderDetail;

  constructor(detail: ProviderDetail) {
    // The message is intentionally a fixed code. Never attach a provider URL,
    // request headers, response body, or upstream error message.
    super(detail);
    this.name = "CanaryFailure";
    this.detail = detail;
  }
}

function failureDetail(error: unknown): ProviderDetail {
  return error instanceof CanaryFailure ? error.detail : "network_error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

export async function checkHeliusHealth(
  apiKey: string | undefined,
  options: CanaryOptions = {},
): Promise<ProviderCanaryStatus> {
  const now = options.now ?? (() => new Date());
  const key = apiKey?.trim();
  if (!key) return result(false, false, "not_configured", now);

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const endpoint = new URL(HELIUS_RPC_ORIGIN);
    endpoint.searchParams.set("api-key", key);
    const response = await fetchWithTimeout(
      fetcher,
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sportpad-health",
          method: "getHealth",
        }),
        cache: "no-store",
      },
      timeoutMs,
    );

    if (!response.ok) {
      return result(true, false, classifyHttpStatus(response.status), now);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return result(true, false, "invalid_response", now);
    }

    if (!isRecord(payload) || payload.result !== "ok") {
      return result(true, false, "invalid_response", now);
    }

    return result(true, true, "operational", now);
  } catch (error) {
    return result(true, false, failureDetail(error), now);
  }
}

export async function checkJupiterQuote(
  apiKey: string | undefined,
  options: CanaryOptions = {},
): Promise<ProviderCanaryStatus> {
  const now = options.now ?? (() => new Date());
  const key = apiKey?.trim();
  if (!key) return result(false, false, "not_configured", now);

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const endpoint = new URL(JUPITER_QUOTE_ENDPOINT);
    endpoint.searchParams.set("inputMint", WRAPPED_SOL_MINT);
    endpoint.searchParams.set("outputMint", USDC_MINT);
    endpoint.searchParams.set("amount", "1000000");
    endpoint.searchParams.set("slippageBps", "50");
    endpoint.searchParams.set("restrictIntermediateTokens", "true");

    const response = await fetchWithTimeout(
      fetcher,
      endpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-api-key": key,
        },
        cache: "no-store",
      },
      timeoutMs,
    );

    if (!response.ok) {
      return result(true, false, classifyHttpStatus(response.status), now);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return result(true, false, "invalid_response", now);
    }

    const validQuote = isRecord(payload)
      && payload.inputMint === WRAPPED_SOL_MINT
      && payload.outputMint === USDC_MINT
      && payload.inAmount === "1000000"
      && isPositiveIntegerString(payload.outAmount)
      && Array.isArray(payload.routePlan)
      && payload.routePlan.length > 0;

    if (!validQuote) return result(true, false, "invalid_response", now);
    return result(true, true, "operational", now);
  } catch (error) {
    return result(true, false, failureDetail(error), now);
  }
}
