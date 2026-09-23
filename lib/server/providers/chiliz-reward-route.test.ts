import assert from "node:assert/strict";
import test from "node:test";

import { KAYEN } from "../../protocol/chiliz-reward-assets.ts";
import { calculateChilizDepthImpactBps, decodeKayenGetAmountsOut, encodeKayenGetAmountsOut,
  inspectChilizV2Market } from "./chiliz-reward-route.ts";

function word(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

test("Kayen quote calldata uses the exact WCHZ to selected Fan Token path", () => {
  const output = "0x1111111111111111111111111111111111111111";
  const data = encodeKayenGetAmountsOut(output, 7n);

  assert.ok(data.startsWith("0xd06ca61f"));
  assert.ok(data.includes(KAYEN.wrappedChz.slice(2).toLowerCase()));
  assert.ok(data.endsWith(output.slice(2).toLowerCase()));
});

test("Kayen quote results decode the final path amount", () => {
  const encoded = `0x${word(32n)}${word(2n)}${word(1n)}${word(42n)}`;
  assert.equal(decodeKayenGetAmountsOut(encoded), 42n);
  assert.throws(() => decodeKayenGetAmountsOut(`${encoded}${word(43n)}`), /invalid quote/);
});

test("read-only V2 audit checks chain, contract, decimals and both quote sizes without approving execution", async () => {
  const contract = "0x1111111111111111111111111111111111111111";
  const requests: string[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: Array<{ to?: string; data?: string }> };
    requests.push(request.method);
    let result = "0x";
    if (request.method === "eth_chainId") result = "0x15b38";
    if (request.method === "eth_getCode") result = "0x6000";
    if (request.method === "eth_call" && request.params[0].to === contract) result = `0x${word(18n)}`;
    if (request.method === "eth_call" && request.params[0].to === KAYEN.router) {
      const amountIn = BigInt(`0x${request.params[0].data?.slice(10, 74)}`);
      const output = amountIn === 1_000_000_000_000_000_000n ? 10n * 10n ** 18n : 900n * 10n ** 18n;
      result = `0x${word(32n)}${word(2n)}${word(amountIn)}${word(output)}`;
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  };
  const result = await inspectChilizV2Market(contract, { fetcher });
  assert.deepEqual(requests, ["eth_chainId", "eth_getCode", "eth_call", "eth_call", "eth_call"]);
  assert.equal(result.reason, "quote_available");
  assert.equal(result.quoteAvailable, true);
  assert.equal(result.executionApproved, false);
  assert.equal(result.tokenDecimals, 18);
  assert.equal(result.depthImpactBps, 1_000);
  assert.equal(result.oneChzOutputAtomic, (10n * 10n ** 18n).toString());
  assert.equal(result.hundredChzOutputAtomic, (900n * 10n ** 18n).toString());
});

test("V2 audit distinguishes shallow depth, wrong chain and unavailable quotes", async () => {
  assert.equal(calculateChilizDepthImpactBps(10n, 700n), 3_000);
  assert.equal(calculateChilizDepthImpactBps(10n, 1_100n), 0);
  const contract = "0x1111111111111111111111111111111111111111";
  const wrongChain = await inspectChilizV2Market(contract, {
    fetcher: async () => Response.json({ result: "0x1" }),
  });
  assert.equal(wrongChain.reason, "wrong_chain");
  assert.equal(wrongChain.executionApproved, false);
  const unavailable = await inspectChilizV2Market(contract, { fetcher: async () => { throw new Error("RPC offline"); } });
  assert.equal(unavailable.reason, "provider_unavailable");
  assert.equal(unavailable.quoteAvailable, false);
});
