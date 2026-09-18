import assert from "node:assert/strict";
import test from "node:test";

import { checkHeliusHealth, checkJupiterQuote } from "./canaries.ts";
import {
  assertMainnetMutationEnabled,
  MAINNET_MUTATIONS_ENABLED,
  MainnetMutationLockedError,
} from "./safety.ts";

const NOW = () => new Date("2026-09-18T12:00:00.000Z");

test("missing credentials do not make network requests", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    throw new Error("unexpected request");
  };

  const [helius, jupiter] = await Promise.all([
    checkHeliusHealth(undefined, { fetcher, now: NOW }),
    checkJupiterQuote("   ", { fetcher, now: NOW }),
  ]);

  assert.equal(calls, 0);
  assert.deepEqual(helius, {
    configured: false,
    healthy: false,
    checkedAt: NOW().toISOString(),
    detail: "not_configured",
  });
  assert.deepEqual(jupiter, helius);
});

test("Helius canary accepts only a healthy JSON-RPC response and redacts the key", async () => {
  const dummyKey = "dummy-helius-secret";
  let requestMethod = "";
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("api-key"), dummyKey);
    requestMethod = init?.method ?? "";
    return new Response(JSON.stringify({ jsonrpc: "2.0", result: "ok", id: "sportpad-health" }));
  };

  const status = await checkHeliusHealth(dummyKey, { fetcher, now: NOW });
  assert.equal(requestMethod, "POST");
  assert.equal(status.healthy, true);
  assert.equal(status.detail, "operational");
  assert.equal(JSON.stringify(status).includes(dummyKey), false);
});

test("Jupiter canary sends the API key in a header and returns no quote data", async () => {
  const dummyKey = "dummy-jupiter-secret";
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.has("api-key"), false);
    assert.equal(new Headers(init?.headers).get("x-api-key"), dummyKey);
    return new Response(JSON.stringify({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inAmount: "1000000",
      outAmount: "125000",
      routePlan: [{ percent: 100 }],
    }));
  };

  const status = await checkJupiterQuote(dummyKey, { fetcher, now: NOW });
  assert.equal(status.healthy, true);
  assert.equal(status.detail, "operational");
  assert.equal(JSON.stringify(status).includes(dummyKey), false);
  assert.deepEqual(Object.keys(status).sort(), ["checkedAt", "configured", "detail", "healthy"]);
});

test("provider HTTP failures use fixed sanitized detail codes", async () => {
  const unauthorized: typeof fetch = async () => new Response("sensitive upstream body", { status: 401 });
  const limited: typeof fetch = async () => new Response("sensitive upstream body", { status: 429 });

  const helius = await checkHeliusHealth("dummy", { fetcher: unauthorized, now: NOW });
  const jupiter = await checkJupiterQuote("dummy", { fetcher: limited, now: NOW });

  assert.equal(helius.detail, "authentication_failed");
  assert.equal(jupiter.detail, "rate_limited");
  assert.equal(JSON.stringify([helius, jupiter]).includes("sensitive upstream body"), false);
});

test("provider canaries fail closed on timeout", async () => {
  const hangingFetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

  const status = await checkJupiterQuote("dummy", {
    fetcher: hangingFetcher,
    timeoutMs: 5,
    now: NOW,
  });

  assert.equal(status.healthy, false);
  assert.equal(status.detail, "timeout");
});

test("mainnet mutation guard cannot be enabled by provider configuration", () => {
  assert.equal(MAINNET_MUTATIONS_ENABLED, false);
  assert.throws(
    () => assertMainnetMutationEnabled(),
    (error) => error instanceof MainnetMutationLockedError
      && error.code === "MAINNET_MUTATION_LOCKED",
  );
});
