import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { runSolChzCanary } from "./chiliz-sol-chz-canary-worker.mjs";

function config(fetcher) {
  return { action: "sol_chz_swap", baseUrl: "https://sportpad.fun",
    workerToken: "test-token", jupiterKey: "test-key", rewardKeypair: Keypair.generate(),
    connection: { sendRawTransaction: async () => { throw new Error("must not send"); } },
    fetcher };
}

test("one-shot canary flag is off by default", async () => {
  const previous = process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED;
  delete process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED;
  try {
    await assert.rejects(runSolChzCanary(config(async () => {
      throw new Error("must not fetch");
    })), /chz_solana_canary_worker_flag_not_enabled/);
  } finally {
    if (previous === undefined) delete process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED;
    else process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED = previous;
  }
});

test("a durable existing row makes restart a no-send no-op", async () => {
  const previous = process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED;
  process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED = "true";
  let calls = 0;
  const setup = config(async (url, init) => {
    calls++;
    if (String(url).endsWith("/api/protocol/status")) {
      return Response.json({ treasuries: { reward: setup.rewardKeypair.publicKey.toBase58() } });
    }
    assert.equal(JSON.parse(init.body).action, "inspect");
    return Response.json({ ok: true, journal: { state: "broadcast_unknown",
      signature: "persisted-signature" } });
  });
  try {
    const result = await runSolChzCanary(setup);
    assert.deepEqual(result, { operation: "sol_chz_swap", state: "broadcast_unknown",
      signature: "persisted-signature", alreadyRecorded: true });
    assert.equal(calls, 2);
  } finally {
    if (previous === undefined) delete process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED;
    else process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED = previous;
  }
});
