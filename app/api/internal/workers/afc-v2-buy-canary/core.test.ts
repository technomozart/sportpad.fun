import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChilizRewardAsset, KAYEN } from
  "../../../../../lib/protocol/chiliz-reward-assets.ts";
import { createChilizSignedIntent } from
  "../../../../../lib/protocol/chiliz-signed-intent.ts";
import { FINALIZE_AFC_BUY_CANARY_SQL, INSERT_AFC_BUY_CANARY_SQL,
  MARK_AFC_BUY_CANARY_BROADCAST_SQL, SELECT_AFC_BUY_CANARY_SQL } from
  "../../../../../lib/server/chiliz-afc-buy-canary-journal.ts";
import { AFC_BUY_CANARY_JOB_ID } from
  "../../../../../lib/server/providers/chiliz-v2-buy-canary-intent.ts";
import { handleAfcV2BuyCanaryRequest } from "./core.ts";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const token = getChilizRewardAsset("AFC")!.currentV2Contract;
const nowMs = 1_800_000_000_000;
const workerId = `chiliz:${account.address.toLowerCase()}`;
const auth = "canary-test-token";
const abi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns (uint256[] amounts)",
]);

async function signed(amount = 10_000_000_000_000_000n) {
  const rawTransaction = await account.signTransaction({
    chainId: 88_888, type: "eip1559", nonce: 2,
    gas: 200_000n, maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    to: KAYEN.router, value: amount,
    data: encodeFunctionData({ abi, functionName: "swapExactETHForTokens",
      args: [1_000_000_000_000n, [KAYEN.wrappedChz, token],
        account.address, 1_800_000_120n] }),
  });
  return createChilizSignedIntent({ kind: "purchase", jobId: AFC_BUY_CANARY_JOB_ID,
    attempt: 1, treasury: account.address, fanTokenContract: token,
    maxPrincipalWei: amount.toString(), minimumOutputAtomic: "1000000000000",
    signedAtEpochSeconds: 1_800_000_000,
    deadlineEpochSeconds: 1_800_000_120,
    rawTransaction, gasFeeCeilingWei: "200000000000000" });
}

function fixture() {
  let row: Record<string, unknown> | null = null;
  let writes = 0;
  const database = {
    prepare(sql: string) {
      if (sql === SELECT_AFC_BUY_CANARY_SQL) return {
        first: async () => row,
      };
      return { bind(...values: unknown[]) { return { run: async () => {
        if (sql === INSERT_AFC_BUY_CANARY_SQL) {
          if (row) return { success: true, meta: { changes: 0 } };
          writes++;
          row = { id: "initial", treasury_address: values[0], fan_token_contract: values[1],
            amount_in_wei: values[2], minimum_output_atomic: values[3],
            nonce: values[4], deadline_epoch_seconds: values[5],
            maximum_network_fee_wei: values[6], tx_hash: values[7],
            raw_transaction: values[8], intent_json: values[9],
            state: "prepared", broadcast_attempted_at_ms: null,
            receipt_status: null, receipt_block_hash: null,
            receipt_block_number: null, finalized_block_number: null,
            output_amount_atomic: null, receipt_evidence_json: null };
          return { success: true, meta: { changes: 1 } };
        }
        if (sql === MARK_AFC_BUY_CANARY_BROADCAST_SQL && row?.state === "prepared") {
          writes++;
          row = { ...row, state: "broadcast_attempted",
            broadcast_attempted_at_ms: values[1] };
          return { success: true, meta: { changes: 1 } };
        }
        if (sql === FINALIZE_AFC_BUY_CANARY_SQL && row?.state === "broadcast_attempted") {
          writes++;
          row = { ...row, state: values[1], receipt_status: values[2],
            receipt_block_hash: values[3], receipt_block_number: values[4],
            finalized_block_number: values[5], output_amount_atomic: values[6],
            receipt_evidence_json: values[7] };
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      } }; } };
    },
  } as unknown as D1Database;
  const deps = { database, workerToken: auth, canaryEnabled: true,
    prepareEnabled: true, chilizTreasury: account.address,
    nowMs: () => nowMs };
  const request = (body: unknown, bearer = auth) => new Request(
    "https://sportpad.fun/api/internal/workers/afc-v2-buy-canary", {
      method: "POST", headers: { authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ workerId, ...(body as object) }),
    });
  return { deps, request, get row() { return row; },
    get writes() { return writes; } };
}

test("AFC API is doubly off by default and never leaks raw spend bytes", async () => {
  const f = fixture();
  const intent = await signed();
  const off = await handleAfcV2BuyCanaryRequest(f.request({ action: "prepare", intent }),
    { ...f.deps, canaryEnabled: false });
  assert.equal(off.status, 404);
  const unauth = await handleAfcV2BuyCanaryRequest(f.request({ action: "load" }, "wrong"),
    f.deps);
  assert.equal(unauth.status, 401);
  const prepOff = await handleAfcV2BuyCanaryRequest(f.request({ action: "prepare", intent }),
    { ...f.deps, prepareEnabled: false });
  assert.equal(prepOff.status, 404);
  assert.equal((await prepOff.text()).includes(intent.rawTransaction), false);
  assert.equal(f.writes, 0);
});

test("prepare, exact one-way claim, and dual-RPC proof finalization are durable", async () => {
  const f = fixture();
  const intent = await signed();
  const prepare = await handleAfcV2BuyCanaryRequest(f.request({ action: "prepare", intent }),
    f.deps);
  assert.equal(prepare.status, 200);
  assert.equal((await prepare.json() as { journal: { intent: { rawTransaction: string } } })
    .journal.intent.rawTransaction, intent.rawTransaction);
  const duplicate = await handleAfcV2BuyCanaryRequest(
    f.request({ action: "prepare", intent }), f.deps);
  assert.equal(duplicate.status, 409);
  const claim = await handleAfcV2BuyCanaryRequest(f.request({ action: "claim_broadcast",
    txHash: intent.txHash.toLowerCase() }), f.deps);
  assert.equal(claim.status, 200);
  const repeat = await handleAfcV2BuyCanaryRequest(f.request({ action: "claim_broadcast",
    txHash: intent.txHash.toLowerCase() }), f.deps);
  assert.equal(repeat.status, 409);
  const proof = { txHash: intent.txHash.toLowerCase(), receiptStatus: "success" as const,
    receiptBlockHash: `0x${"c".repeat(64)}`, receiptBlockNumber: 100,
    finalizedBlockNumber: 103, outputAmountAtomic: "1000000000000" };
  const finalize = await handleAfcV2BuyCanaryRequest(f.request({ action: "finalize",
    txHash: intent.txHash.toLowerCase() }), { ...f.deps,
    verifyReceipt: async () => proof });
  assert.equal(finalize.status, 200);
  assert.equal((await finalize.json() as { state: string }).state, "finalized_success");
  assert.equal(f.writes, 3);
  const load = await handleAfcV2BuyCanaryRequest(f.request({ action: "load" }), f.deps);
  assert.equal((await load.json() as { journal: { state: string } }).journal.state,
    "finalized_success");
});

test("wrong amount cannot prepare; dust proof cannot finalize", async () => {
  const f = fixture();
  const wrong = await signed(20_000_000_000_000_000n);
  assert.equal((await handleAfcV2BuyCanaryRequest(f.request({ action: "prepare",
    intent: wrong }), f.deps)).status, 400);
  assert.equal(f.writes, 0);
  const intent = await signed();
  await handleAfcV2BuyCanaryRequest(f.request({ action: "prepare", intent }), f.deps);
  await handleAfcV2BuyCanaryRequest(f.request({ action: "claim_broadcast",
    txHash: intent.txHash.toLowerCase() }), f.deps);
  const bad = await handleAfcV2BuyCanaryRequest(f.request({ action: "finalize",
    txHash: intent.txHash.toLowerCase() }), { ...f.deps,
    verifyReceipt: async () => ({ txHash: intent.txHash.toLowerCase(),
      receiptStatus: "success", receiptBlockHash: `0x${"d".repeat(64)}`,
      receiptBlockNumber: 100, finalizedBlockNumber: 103, outputAmountAtomic: "1" }) });
  assert.equal(bad.status, 409);
  assert.equal(f.writes, 2);
});
