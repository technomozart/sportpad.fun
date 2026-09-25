import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChilizRewardAsset, KAYEN } from "../lib/protocol/chiliz-reward-assets.ts";
import { createChilizSignedIntent } from "../lib/protocol/chiliz-signed-intent.ts";
import { afcCanaryConfig, runAfcV2BuyCanary } from
  "./chiliz-afc-v2-buy-canary-worker.mjs";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const token = getChilizRewardAsset("AFC").currentV2Contract;
const amount = 10_000_000_000_000_000n;
const abi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns (uint256[] amounts)",
]);
const config = afcCanaryConfig({
  SPORTPAD_AFC_V2_BUY_CANARY_WORKER_ENABLED: "true",
  SPORTPAD_AFC_V2_BUY_CANARY_MODE: "prepare_broadcast",
}, account, "token", "https://sportpad.fun");

function plan() {
  const deadline = Math.floor(Date.now() / 1_000) + 120;
  return { symbol: "AFC", amountInWei: amount.toString(),
    treasury: account.address, chainId: 88_888, executionEnabled: false,
    fanToken: token, minimumOutputAtomic: "1000000000000",
    maximumGasCostWei: "200000000000000",
    deadlineUnixSeconds: String(deadline),
    transaction: { from: account.address, to: KAYEN.router,
      chainId: 88_888, type: "eip1559", nonce: 2,
      gas: 200_000n, maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n, value: amount,
      data: encodeFunctionData({ abi, functionName: "swapExactETHForTokens",
        args: [1_000_000_000_000n, [KAYEN.wrappedChz, token],
          account.address, BigInt(deadline)] }) },
  };
}

test("AFC worker is off without explicit local action flag", () => {
  assert.throws(() => afcCanaryConfig({ SPORTPAD_AFC_V2_BUY_CANARY_MODE:
    "prepare_broadcast" }, account, "token", "https://sportpad.fun"), /canary_disabled/);
  assert.throws(() => afcCanaryConfig({
    SPORTPAD_AFC_V2_BUY_CANARY_WORKER_ENABLED: "true",
    SPORTPAD_AFC_V2_BUY_CANARY_MODE: "prepare_broadcast",
  }, account, "token", "https://attacker.example"), /worker_identity_invalid/);
});

test("AFC worker persists exact signed bytes, then claims, then sends once", async () => {
  const events = [];
  let prepared = null;
  const api = {
    probe: async () => { events.push("probe"); return null; },
    prepare: async (intent) => { events.push("prepare");
      prepared = { id: "initial", state: "prepared", intent }; return prepared; },
    load: async () => { events.push("load"); return prepared; },
    claim: async (hash) => { events.push("claim");
      assert.equal(hash, prepared.intent.txHash.toLowerCase());
      prepared = { ...prepared, state: "broadcast_attempted" };
      return prepared; },
    finalize: async () => { events.push("finalize"); return null; },
  };
  const outcome = await runAfcV2BuyCanary(config, {
    api, buildPlanImpl: async () => { events.push("quote"); return plan(); },
    primaryClient: {},
    sendImpl: async (persisted) => { events.push("send");
      assert.equal(persisted.rawTransaction, prepared.intent.rawTransaction);
      return { acknowledged: true, txHash: persisted.txHash }; },
  });
  assert.equal(outcome.state, "submitted_pending");
  assert.deepEqual(events,
    ["probe", "quote", "prepare", "load", "claim", "send", "finalize"]);
});

test("unknown send remains attempted and cannot be automatically replayed", async () => {
  let prepared = null;
  let sends = 0;
  const api = {
    probe: async () => prepared,
    prepare: async (intent) => {
      prepared = { id: "initial", state: "prepared", intent }; return prepared; },
    load: async () => prepared,
    claim: async () => {
      prepared = { ...prepared, state: "broadcast_attempted" }; return prepared; },
    finalize: async () => { throw Error("must not finalize an unknown send"); },
  };
  const deps = { api, buildPlanImpl: async () => plan(), primaryClient: {},
    sendImpl: async () => { sends++; return { acknowledged: false }; } };
  assert.equal((await runAfcV2BuyCanary(config, deps)).state, "broadcast_unknown");
  await assert.rejects(runAfcV2BuyCanary(config, deps), /already_reserved/);
  assert.equal(sends, 1);
});

test("explicit reconciliation does not sign, claim, or resend", async () => {
  const quoted = plan();
  const unsigned = { ...quoted.transaction };
  delete unsigned.from;
  const rawTransaction = await account.signTransaction(unsigned);
  const now = Math.floor(Date.now() / 1_000);
  const intent = await createChilizSignedIntent({ kind: "purchase",
    jobId: "afc_v2_buy_canary_initial", attempt: 1,
    treasury: account.address, fanTokenContract: token,
    maxPrincipalWei: amount.toString(), minimumOutputAtomic: quoted.minimumOutputAtomic,
    signedAtEpochSeconds: now, deadlineEpochSeconds: Number(quoted.deadlineUnixSeconds),
    rawTransaction, gasFeeCeilingWei: quoted.maximumGasCostWei });
  const reconciliation = { ...config, mode: "reconcile" };
  const result = await runAfcV2BuyCanary(reconciliation, {
    api: { load: async () => ({ id: "initial", state: "broadcast_attempted",
      intent }),
      claim: async () => { throw Error("claim forbidden"); },
      finalize: async () => null },
    primaryClient: {},
    sendImpl: async () => { throw Error("send forbidden"); },
  });
  assert.equal(result.state, "reconciliation_pending");
});
