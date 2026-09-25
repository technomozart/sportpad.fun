import { createPublicClient, http } from "viem";
import { createChilizSignedIntent } from "../lib/protocol/chiliz-signed-intent.ts";
import { prepareChilizV2BuyPlan } from "../lib/server/providers/chiliz-v2-buy-plan.ts";
import { AFC_BUY_CANARY_AMOUNT_WEI, AFC_BUY_CANARY_JOB_ID,
  verifyAfcV2BuyCanaryIntent } from
  "../lib/server/providers/chiliz-v2-buy-canary-intent.ts";
import { sendPersistedChilizIntent } from "./chiliz-worker-intent.mjs";

const API_PATH = "/api/internal/workers/afc-v2-buy-canary";
const PRIMARY_RPC = "https://rpc.ankr.com/chiliz";
const SECONDARY_RPC = "https://chiliz-rpc.publicnode.com";

function fail(code) { throw new Error(code); }

function clients() {
  const chain = { id: 88_888, name: "Chiliz Chain",
    nativeCurrency: { name: "Chiliz", symbol: "CHZ", decimals: 18 },
    rpcUrls: { default: { http: [PRIMARY_RPC] } } };
  return {
    primary: createPublicClient({ chain,
      transport: http(PRIMARY_RPC, { timeout: 15_000, retryCount: 0 }) }),
    secondary: createPublicClient({ chain: { ...chain,
      rpcUrls: { default: { http: [SECONDARY_RPC] } } },
      transport: http(SECONDARY_RPC, { timeout: 15_000, retryCount: 0 }) }),
  };
}

export function afcCanaryConfig(source, account, workerToken, baseUrl) {
  if (source.SPORTPAD_AFC_V2_BUY_CANARY_WORKER_ENABLED !== "true") {
    fail("afc_v2_buy_canary_disabled");
  }
  const mode = source.SPORTPAD_AFC_V2_BUY_CANARY_MODE;
  if (mode !== "prepare_broadcast" && mode !== "reconcile") {
    fail("afc_v2_buy_canary_mode_invalid");
  }
  if (!account?.address || typeof account.signTransaction !== "function" ||
      !workerToken || baseUrl !== "https://sportpad.fun") {
    fail("afc_v2_buy_canary_worker_identity_invalid");
  }
  return { mode, account, workerToken, baseUrl,
    workerId: `chiliz:${account.address.toLowerCase()}` };
}

export function createAfcCanaryApiClient(config, fetchImpl = fetch) {
  async function call(body, { allowMissing = false, allowPending = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${API_PATH}`, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json",
          Authorization: `Bearer ${config.workerToken}` },
        body: JSON.stringify({ ...body, workerId: config.workerId }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch { fail("afc_v2_buy_canary_api_unavailable"); }
    let result;
    try {
      const raw = await response.text();
      if (raw.length > 20_000) throw Error();
      result = JSON.parse(raw);
    } catch { fail("afc_v2_buy_canary_api_invalid"); }
    if (allowMissing && response.status === 404 && result?.error ===
        "Canary intent not found.") return null;
    if (allowPending && response.status === 409 && result?.error ===
        "Canary finality not yet verified.") return null;
    if (!response.ok) fail(response.status === 409 ?
      "afc_v2_buy_canary_conflict" : "afc_v2_buy_canary_api_unavailable");
    if (!result || typeof result !== "object") fail("afc_v2_buy_canary_api_invalid");
    return result;
  }
  const journal = (result) => {
    if (!result?.journal?.intent) fail("afc_v2_buy_canary_api_invalid");
    return result.journal;
  };
  return {
    probe: async () => { const result = await call({ action: "load" },
      { allowMissing: true }); return result === null ? null : journal(result); },
    load: async () => journal(await call({ action: "load" })),
    prepare: async (intent) => journal(await call({ action: "prepare", intent })),
    claim: async (txHash) => {
      const result = await call({ action: "claim_broadcast", txHash });
      if (result.changedRows !== 1) fail("afc_v2_buy_canary_claim_invalid");
      return journal(result);
    },
    finalize: async (txHash) => call({ action: "finalize", txHash },
      { allowPending: true }),
  };
}

function assertSameIntent(row, expected, state) {
  if (!row || row.id !== "initial" || row.state !== state ||
      row.intent?.txHash !== expected.txHash ||
      row.intent?.rawTransaction !== expected.rawTransaction ||
      row.intent?.treasury !== expected.treasury ||
      row.intent?.fanTokenContract !== expected.fanTokenContract ||
      row.intent?.valueWei !== AFC_BUY_CANARY_AMOUNT_WEI) {
    fail("afc_v2_buy_canary_persisted_identity_invalid");
  }
}

/** Single explicit action, no loop and no replacement after any uncertainty. */
export async function runAfcV2BuyCanary(config, deps = {}) {
  const api = deps.api ?? createAfcCanaryApiClient(config, deps.fetchImpl);
  const primaryClient = deps.primaryClient ?? clients().primary;
  if (config.mode === "reconcile") {
    const row = await api.load();
    const intent = await verifyAfcV2BuyCanaryIntent({ intent: row.intent,
      expectedTreasury: config.account.address, requireFresh: false });
    if (row.state === "finalized_success" || row.state === "finalized_reverted") {
      return { state: row.state, txHash: intent.txHash,
        outputAmountAtomic: row.receiptProof?.outputAmountAtomic ?? null };
    }
    assertSameIntent(row, intent, "broadcast_attempted");
    const finalized = await api.finalize(intent.txHash.toLowerCase());
    return finalized ? { state: finalized.state, txHash: intent.txHash,
      outputAmountAtomic: finalized.outputAmountAtomic } :
      { state: "reconciliation_pending", txHash: intent.txHash };
  }
  if (config.mode !== "prepare_broadcast") fail("afc_v2_buy_canary_mode_invalid");
  if (await api.probe() !== null) fail("afc_v2_buy_canary_already_reserved");
  const now = Math.floor(Date.now() / 1_000);
  const plan = await (deps.buildPlanImpl ?? prepareChilizV2BuyPlan)({
    symbol: "AFC", amountInWei: AFC_BUY_CANARY_AMOUNT_WEI,
    treasury: config.account.address, nowUnixSeconds: now, rpcUrl: PRIMARY_RPC,
  });
  if (plan.symbol !== "AFC" || plan.amountInWei !== AFC_BUY_CANARY_AMOUNT_WEI ||
      plan.treasury !== config.account.address || plan.chainId !== 88_888 ||
      plan.executionEnabled !== false ||
      BigInt(plan.maximumGasCostWei) > 1_000_000_000_000_000_000n) {
    fail("afc_v2_buy_canary_plan_invalid");
  }
  const { from: _from, ...unsigned } = plan.transaction;
  if (_from !== config.account.address) fail("afc_v2_buy_canary_plan_signer_invalid");
  const rawTransaction = await config.account.signTransaction(unsigned);
  const intent = await createChilizSignedIntent({ kind: "purchase",
    jobId: AFC_BUY_CANARY_JOB_ID, attempt: 1,
    treasury: config.account.address, fanTokenContract: plan.fanToken,
    maxPrincipalWei: AFC_BUY_CANARY_AMOUNT_WEI,
    minimumOutputAtomic: plan.minimumOutputAtomic,
    signedAtEpochSeconds: now,
    deadlineEpochSeconds: Number(plan.deadlineUnixSeconds),
    rawTransaction, gasFeeCeilingWei: plan.maximumGasCostWei });
  await verifyAfcV2BuyCanaryIntent({ intent,
    expectedTreasury: config.account.address });
  const prepared = await api.prepare(intent);
  assertSameIntent(prepared, intent, "prepared");
  const persisted = await api.load();
  assertSameIntent(persisted, intent, "prepared");
  const claimed = await api.claim(intent.txHash.toLowerCase());
  assertSameIntent(claimed, intent, "broadcast_attempted");
  // If the claim response is slow, do not send an expired transaction.
  if (Math.floor(Date.now() / 1_000) + 15 >= intent.deadlineEpochSeconds) {
    return { state: "broadcast_unknown", txHash: intent.txHash };
  }
  const sent = await (deps.sendImpl ?? sendPersistedChilizIntent)(
    claimed.intent, primaryClient);
  if (!sent.acknowledged) return { state: "broadcast_unknown", txHash: intent.txHash };
  const finalized = await api.finalize(intent.txHash.toLowerCase());
  return finalized ? { state: finalized.state, txHash: intent.txHash,
    outputAmountAtomic: finalized.outputAmountAtomic } :
    { state: "submitted_pending", txHash: intent.txHash };
}
