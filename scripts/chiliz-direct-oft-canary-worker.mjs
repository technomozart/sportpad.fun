import { Connection, PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { getAddress } from "viem";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  broadcastDirectOftChilizOnce,
} from "../lib/server/providers/chiliz-direct-oft-broadcast.ts";
import { DIRECT_CHZ_OFT } from "../lib/server/providers/chiliz-direct-oft.ts";
import { buildUnsignedDirectOftChzTransfer } from
  "../lib/server/providers/chiliz-direct-oft-build.ts";
import { signDirectOftChilizJournal } from
  "../lib/server/providers/chiliz-direct-oft-sign.ts";

const API_PATH = "/api/internal/workers/chiliz-bridge";
const SHA256 = /^[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const CANARY_AMOUNT_ATOMIC = "700000000";
const CANARY_MINIMUM_ATOMIC = "665000000";
const MAX_CANARY_MESSAGING_FEE_LAMPORTS = 500_000n;
const MINIMUM_SOL_RESERVE_LAMPORTS = 45_000_000n;
const NETWORK_FEE_BUFFER_LAMPORTS = 50_000n;
const SWAP_API_PATH = "/api/internal/workers/chiliz-sol-chz-canary";

function fail(code) { throw new Error(code); }

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) fail(`direct_oft_canary_${name.toLowerCase()}_missing`);
  return value;
}

function httpsUrl(value, code, { allowQuery = true } = {}) {
  let url;
  try { url = new URL(value); } catch { fail(code); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.hash || (!allowQuery && (url.search || url.pathname !== "/"))) fail(code);
  return url;
}

/** Nothing happens unless this separate, worker-local canary switch is true. */
export function readDirectOftCanaryConfig(source = process.env) {
  if (source.SPORTPAD_DIRECT_OFT_CANARY_WORKER_ENABLED !== "true") {
    fail("direct_oft_canary_disabled");
  }
  const mode = source.SPORTPAD_DIRECT_OFT_CANARY_MODE?.trim() ||
    (source.SPORTPAD_CHZ_SOLANA_CANARY_ACTION === "direct_oft_prepare_broadcast" ?
      "prepare_broadcast" : required(source, "SPORTPAD_DIRECT_OFT_CANARY_MODE"));
  if (!["prepare_broadcast", "broadcast", "reconcile"].includes(mode)) {
    fail("direct_oft_canary_mode_invalid");
  }
  const baseUrl = httpsUrl(required(source, "SPORTPAD_BASE_URL"),
    "direct_oft_canary_base_url_invalid", { allowQuery: false });
  if (baseUrl.origin !== "https://sportpad.fun") {
    fail("direct_oft_canary_base_url_invalid");
  }
  const rewardSecret = mode === "prepare_broadcast" ?
    required(source, "SOLANA_REWARD_VAULT_PRIVATE_KEY") : null;
  let sourceWallet = source.SOLANA_REWARD_TREASURY_ADDRESS?.trim();
  if (!sourceWallet && rewardSecret) {
    try {
      const bytes = rewardSecret.startsWith("[") ?
        Uint8Array.from(JSON.parse(rewardSecret)) : bs58.decode(rewardSecret);
      if (bytes.length !== 64) throw Error();
      sourceWallet = Keypair.fromSecretKey(bytes).publicKey.toBase58();
    } catch { fail("direct_oft_canary_signer_invalid"); }
  }
  if (!sourceWallet) fail("direct_oft_canary_source_wallet_missing");
  try {
    const key = new PublicKey(sourceWallet);
    if (!PublicKey.isOnCurve(key) || key.toBase58() !== sourceWallet) throw Error();
  } catch { fail("direct_oft_canary_source_wallet_invalid"); }
  let destinationTreasury;
  try {
    destinationTreasury = getAddress(required(source, "CHILIZ_TREASURY_ADDRESS"))
      .toLowerCase();
  } catch { fail("direct_oft_canary_destination_invalid"); }
  const id = source.SPORTPAD_DIRECT_OFT_CANARY_JOURNAL_ID?.trim() ||
    (mode === "prepare_broadcast" ? "initial" :
      required(source, "SPORTPAD_DIRECT_OFT_CANARY_JOURNAL_ID"));
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(id)) fail("direct_oft_canary_journal_id_invalid");
  let signedTransactionSha256 = null;
  let plan = null;
  let amountAtomic = null;
  let minimumReceiveAtomic = null;
  const amountIsDefault = mode === "prepare_broadcast" &&
    !source.SPORTPAD_DIRECT_OFT_CANARY_AMOUNT_ATOMIC?.trim();
  if (mode === "prepare_broadcast") {
    amountAtomic = source.SPORTPAD_DIRECT_OFT_CANARY_AMOUNT_ATOMIC?.trim() ||
      CANARY_AMOUNT_ATOMIC;
    minimumReceiveAtomic = source.SPORTPAD_DIRECT_OFT_CANARY_MINIMUM_RECEIVE_ATOMIC?.trim() ||
      CANARY_MINIMUM_ATOMIC;
    if (!POSITIVE.test(amountAtomic) ||
        BigInt(amountAtomic) > BigInt(DIRECT_CHZ_OFT.maximumCanaryAmountAtomic) ||
        !POSITIVE.test(minimumReceiveAtomic) ||
        BigInt(minimumReceiveAtomic) > BigInt(amountAtomic) ||
        BigInt(minimumReceiveAtomic) * 100n < BigInt(amountAtomic) * 95n) {
      fail("direct_oft_canary_amount_invalid");
    }
  } else {
    signedTransactionSha256 = source.SPORTPAD_DIRECT_OFT_CANARY_SIGNED_TX_SHA256?.trim() || null;
    if (signedTransactionSha256 !== null && !SHA256.test(signedTransactionSha256)) {
      fail("direct_oft_canary_signed_hash_invalid");
    }
    const manualPlan = source.SPORTPAD_DIRECT_OFT_CANARY_PLAN_JSON?.trim();
    if (manualPlan) {
      try { plan = JSON.parse(manualPlan); }
      catch { fail("direct_oft_canary_plan_invalid"); }
    }
  }
  if (plan !== null && (!plan || typeof plan !== "object" || Array.isArray(plan) ||
      plan.sourceWallet !== sourceWallet ||
      typeof plan.destinationTreasury !== "string" ||
      plan.destinationTreasury.toLowerCase() !== destinationTreasury ||
      plan.sourceMint !== DIRECT_CHZ_OFT.solanaMint ||
      plan.sourceProgram !== DIRECT_CHZ_OFT.solanaProgram ||
      plan.sourceStore !== DIRECT_CHZ_OFT.solanaStore ||
      plan.sourceLookupTable !== DIRECT_CHZ_OFT.solanaAddressLookupTable ||
      plan.destinationEid !== DIRECT_CHZ_OFT.chilizEid ||
      typeof plan.destinationAdapter !== "string" ||
      plan.destinationAdapter.toLowerCase() !==
        DIRECT_CHZ_OFT.chilizNativeAdapter.toLowerCase() ||
      !POSITIVE.test(plan.sourceAmountAtomic ?? "") ||
      BigInt(plan.sourceAmountAtomic) > BigInt(DIRECT_CHZ_OFT.maximumCanaryAmountAtomic) ||
      !POSITIVE.test(plan.minimumDestinationWei ?? "") ||
      BigInt(plan.minimumDestinationWei) * 100n <
        BigInt(plan.sourceAmountAtomic) * 10_000_000_000n * 95n ||
      BigInt(plan.minimumDestinationWei) > BigInt(plan.sourceAmountAtomic) * 10_000_000_000n ||
      !SHA256.test(plan.onchainQuoteDigestSha256 ?? "") ||
      !SHA256.test(plan.expectedMessageSha256 ?? "") ||
      !POSITIVE.test(plan.messagingFeeLamports ?? "") ||
      BigInt(plan.messagingFeeLamports) > MAX_CANARY_MESSAGING_FEE_LAMPORTS)) {
    fail("direct_oft_canary_plan_invalid");
  }
  const heliusKey = source.HELIUS_API_KEY?.trim();
  const solanaRpcRaw = source.SPORTPAD_DIRECT_OFT_SOLANA_RPC_URL?.trim() ||
    (heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}` :
      required(source, "SPORTPAD_DIRECT_OFT_SOLANA_RPC_URL"));
  const solanaRpc = httpsUrl(solanaRpcRaw, "direct_oft_canary_solana_rpc_invalid");
  if (solanaRpc.hostname !== "mainnet.helius-rpc.com" ||
      solanaRpc.pathname !== "/" || !solanaRpc.searchParams.get("api-key")) {
    fail("direct_oft_canary_solana_rpc_invalid");
  }
  const solanaRpcUrl = solanaRpc.href;
  const primaryChilizRpcUrl = httpsUrl(source.SPORTPAD_DIRECT_OFT_PRIMARY_CHILIZ_RPC_URL?.trim() ||
    "https://rpc.ankr.com/chiliz",
  "direct_oft_canary_primary_chiliz_rpc_invalid").href;
  const secondaryChilizRpcUrl = httpsUrl(source.SPORTPAD_DIRECT_OFT_SECONDARY_CHILIZ_RPC_URL?.trim() ||
    "https://chiliz-rpc.publicnode.com",
  "direct_oft_canary_secondary_chiliz_rpc_invalid").href;
  if (new URL(primaryChilizRpcUrl).origin === new URL(secondaryChilizRpcUrl).origin) {
    fail("direct_oft_canary_chiliz_rpcs_not_independent");
  }
  return Object.freeze({ mode, baseUrl: baseUrl.origin,
    workerToken: required(source, "SPORTPAD_WORKER_TOKEN"), id,
    sourceWallet, destinationTreasury, signedTransactionSha256, plan,
    amountAtomic, minimumReceiveAtomic, rewardSecret,
    amountIsDefault,
    solanaRpcUrl, primaryChilizRpcUrl, secondaryChilizRpcUrl });
}

export function createDirectOftCanaryJournalClient(config, fetchImpl = fetch) {
  async function call(body, { allowMissing = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${API_PATH}`, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json",
          Authorization: `Bearer ${config.workerToken}` },
        body: JSON.stringify({ ...body, id: config.id,
          workerId: `solana:${config.sourceWallet}` }),
        signal: AbortSignal.timeout(body.action === "reconcile" ? 90_000 : 20_000),
      });
    } catch { fail("direct_oft_canary_api_unavailable"); }
    let result;
    try {
      const raw = await response.text();
      if (raw.length > 12_000) throw Error();
      result = JSON.parse(raw);
    } catch { fail("direct_oft_canary_api_invalid"); }
    if (!result || typeof result !== "object") fail("direct_oft_canary_api_invalid");
    if (allowMissing && response.status === 404 &&
        result.error === "Reserved bridge intent not found.") return null;
    if (!response.ok) {
      fail(response.status === 409 ? "direct_oft_canary_claim_rejected" :
        "direct_oft_canary_api_unavailable");
    }
    return result;
  }
  return Object.freeze({
    async inspectFinalizedSwap() {
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}${SWAP_API_PATH}`, {
          method: "POST", redirect: "error", cache: "no-store",
          headers: { "Content-Type": "application/json",
            Authorization: `Bearer ${config.workerToken}` },
          body: JSON.stringify({ action: "inspect", operation: "sol_chz_swap" }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch { fail("direct_oft_canary_swap_proof_unavailable"); }
      let result;
      try {
        const raw = await response.text();
        if (raw.length > 4_000) throw Error();
        result = JSON.parse(raw);
      } catch { fail("direct_oft_canary_swap_proof_invalid"); }
      if (!response.ok || result?.ok !== true || !result.journal) {
        fail("direct_oft_canary_swap_proof_unavailable");
      }
      return result.journal;
    },
    async probe() {
      const result = await call({ action: "load" }, { allowMissing: true });
      if (result === null) return null;
      if (!result.journal || typeof result.journal !== "object") {
        fail("direct_oft_canary_api_invalid");
      }
      return result.journal;
    },
    async load() {
      const result = await call({ action: "load" });
      if (!result.journal || typeof result.journal !== "object") {
        fail("direct_oft_canary_api_invalid");
      }
      return result.journal;
    },
    async reconcile() {
      const result = await call({ action: "reconcile" });
      if (result.state !== "destination_finalized" ||
          typeof result.sourceSignature !== "string" ||
          typeof result.bridgeMessageId !== "string" ||
          typeof result.destinationTxHash !== "string" ||
          !POSITIVE.test(result.receivedWei ?? "")) {
        fail("direct_oft_canary_reconciliation_invalid");
      }
      return result;
    },
    async claim(sourceSignature, signedTransactionSha256) {
      const result = await call({ action: "claim_broadcast", sourceSignature,
        signedTransactionSha256 });
      if (result.changedRows !== 1 || !result.journal ||
          typeof result.journal !== "object") fail("direct_oft_canary_claim_invalid");
      return result;
    },
    async prepare(plan, signedTransactionBase64) {
      const result = await call({ action: "prepare_and_reserve", plan,
        signedTransactionBase64 });
      if (!result.journal || typeof result.journal !== "object") {
        fail("direct_oft_canary_prepare_invalid");
      }
      return result.journal;
    },
  });
}

function rewardSigner(config) {
  let bytes;
  let signer;
  try {
    bytes = config.rewardSecret.startsWith("[") ?
      Uint8Array.from(JSON.parse(config.rewardSecret)) : bs58.decode(config.rewardSecret);
    if (bytes.length !== 64) throw Error();
    signer = Keypair.fromSecretKey(bytes);
  } catch { fail("direct_oft_canary_signer_invalid"); }
  if (signer.publicKey.toBase58() !== config.sourceWallet) {
    fail("direct_oft_canary_signer_treasury_mismatch");
  }
  return { publicKey: config.sourceWallet,
    signMessage: async (message) => ed25519.sign(message, bytes.slice(0, 32)) };
}

function assertJournalMatchesConfig(row, config) {
  const plan = config.plan ?? row?.plan;
  const planJson = JSON.stringify(row?.plan);
  if (!plan || typeof planJson !== "string" || planJson.length > 30_000 ||
      !SHA256.test(row?.planSha256 ?? "") ||
      createHash("sha256").update(planJson).digest("hex") !== row.planSha256 ||
      (config.plan && createHash("sha256")
        .update(JSON.stringify(config.plan)).digest("hex") !== row.planSha256) ||
      !POSITIVE.test(plan.messagingFeeLamports ?? "") ||
      BigInt(plan.messagingFeeLamports) > MAX_CANARY_MESSAGING_FEE_LAMPORTS) {
    fail("direct_oft_canary_persisted_plan_invalid");
  }
  if (!row || typeof row !== "object" || row.id !== config.id ||
      row.policyKey !== "initial" || row.routeType !== "OFT" ||
      row.sourceChain !== "solana" || row.destinationChainId !== 88_888 ||
      row.sourceMint !== DIRECT_CHZ_OFT.solanaMint ||
      row.destinationAsset !== "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
      row.sourceWallet !== config.sourceWallet ||
      row.destinationTreasury !== config.destinationTreasury ||
      row.sourceAmountAtomic !== plan.sourceAmountAtomic ||
      row.minimumDestinationWei !== plan.minimumDestinationWei ||
      row.quoteId !== `oft:${plan.onchainQuoteDigestSha256}` ||
      row.quoteExpiresAtMs !== plan.quoteExpiresAtMs ||
      (config.signedTransactionSha256 &&
        row.signedTransactionSha256 !== config.signedTransactionSha256) ||
      typeof row.signedTransactionBase64 !== "string" ||
      typeof row.sourceSignature !== "string") {
    fail("direct_oft_canary_journal_identity_invalid");
  }
  return plan;
}

function assertFinalizedSwapOutput(journal, config) {
  if (!journal || journal.operation !== "sol_chz_swap" ||
      journal.state !== "finalized_success" ||
      journal.sourceWallet !== config.sourceWallet ||
      typeof journal.signature !== "string" || !journal.signature ||
      typeof journal.actualOutputAtomic !== "string" ||
      !POSITIVE.test(journal.actualOutputAtomic)) {
    fail("direct_oft_canary_swap_output_insufficient");
  }
  const output = BigInt(journal.actualOutputAtomic);
  const amount = config.amountIsDefault && output < BigInt(config.amountAtomic) ?
    (output / 100_000_000n) * 100_000_000n : BigInt(config.amountAtomic);
  if (amount < 400_000_000n || amount > 700_000_000n || output < amount) {
    fail("direct_oft_canary_swap_output_insufficient");
  }
  const minimum = config.amountIsDefault ? amount * 95n / 100n :
    BigInt(config.minimumReceiveAtomic);
  return { amountAtomic: amount.toString(),
    minimumReceiveAtomic: minimum.toString() };
}

async function assertSolanaReserve(rpc, sourceWallet, messagingFeeLamports) {
  if (!POSITIVE.test(messagingFeeLamports ?? "") ||
      BigInt(messagingFeeLamports) > MAX_CANARY_MESSAGING_FEE_LAMPORTS) {
    fail("direct_oft_canary_fee_exceeds_cap");
  }
  let balance;
  try { balance = await rpc.getBalance(new PublicKey(sourceWallet), "confirmed"); }
  catch { fail("direct_oft_canary_sol_balance_unavailable"); }
  if (!Number.isSafeInteger(balance) ||
      BigInt(balance) - BigInt(messagingFeeLamports) -
        NETWORK_FEE_BUFFER_LAMPORTS < MINIMUM_SOL_RESERVE_LAMPORTS) {
    fail("direct_oft_canary_sol_reserve_insufficient");
  }
}

/**
 * Run the one-shot preparation or recover its persisted journal. The provider
 * rechecks the signed message before the atomic claim, and recovery asks the
 * private API to independently verify delivery before finalizing D1.
 */
export async function runDirectOftCanary(config, deps = {}) {
  const api = deps.api ?? createDirectOftCanaryJournalClient(config, deps.fetchImpl);
  if (config.mode === "prepare_broadcast") {
    // A restart with a previously reserved ID must not even re-sign a fresh
    // blockhash. Only read-only reconciliation may follow an unknown outcome.
    const prior = await api.probe();
    if (prior !== null) {
      if (["broadcast_attempted", "source_finalized",
        "destination_finalized", "held"].includes(prior.state)) {
        return runDirectOftCanary({ ...config, mode: "reconcile" }, { ...deps, api });
      }
      fail("direct_oft_canary_already_reserved");
    }
    const signer = rewardSigner(config);
    const sourceAmount = assertFinalizedSwapOutput(await api.inspectFinalizedSwap(), config);
    const plan = await (deps.buildPlanImpl ?? buildUnsignedDirectOftChzTransfer)({
      amountAtomic: sourceAmount.amountAtomic,
      minimumReceiveAtomic: sourceAmount.minimumReceiveAtomic,
      payerSolanaWallet: config.sourceWallet,
      destinationChilizWallet: config.destinationTreasury,
      solanaRpcUrl: config.solanaRpcUrl,
    });
    if (plan.sourceAmountAtomic !== sourceAmount.amountAtomic ||
        plan.minimumReceiveAtomic !== sourceAmount.minimumReceiveAtomic ||
        !POSITIVE.test(plan.messagingFeeLamports ?? "") ||
        BigInt(plan.messagingFeeLamports) > MAX_CANARY_MESSAGING_FEE_LAMPORTS) {
      fail("direct_oft_canary_fresh_plan_invalid");
    }
    await assertSolanaReserve(deps.rpc ?? new Connection(config.solanaRpcUrl, "confirmed"),
      config.sourceWallet, plan.messagingFeeLamports);
    const signed = await (deps.signImpl ?? signDirectOftChilizJournal)({
      id: config.id, plan,
      intent: { sourceWallet: config.sourceWallet,
        destinationTreasury: config.destinationTreasury,
        sourceAmountAtomic: sourceAmount.amountAtomic,
        minimumDestinationWei: plan.minimumDestinationWei,
        quoteId: `oft:${plan.onchainQuoteDigestSha256}` },
      signer, solanaRpcUrl: config.solanaRpcUrl,
      fetchImpl: deps.fetchImpl,
    });
    const prepared = await api.prepare(plan, signed.signedTransactionBase64);
    const preparedConfig = { ...config, ...sourceAmount, mode: "broadcast", plan,
      signedTransactionSha256: signed.signedTransactionSha256 };
    assertJournalMatchesConfig(prepared, preparedConfig);
    if (prepared.state !== "prepared" ||
        prepared.sourceSignature !== signed.sourceSignature ||
        prepared.signedTransactionBase64 !== signed.signedTransactionBase64) {
      fail("direct_oft_canary_prepared_bytes_mismatch");
    }
    return runDirectOftCanary(preparedConfig, { ...deps, api });
  }
  const row = await api.load();
  const plan = assertJournalMatchesConfig(row, config);
  if (config.mode === "reconcile") {
    if (!["broadcast_attempted", "source_finalized",
      "destination_finalized", "held"]
      .includes(row.state)) fail("direct_oft_canary_reconcile_state_invalid");
    const reconciled = await api.reconcile();
    if (reconciled.sourceSignature !== row.sourceSignature) {
      fail("direct_oft_canary_reconciliation_invalid");
    }
    return { state: "delivered", sourceSignature: reconciled.sourceSignature,
      destinationTxHash: reconciled.destinationTxHash };
  }
  if (config.mode !== "broadcast" || row.state !== "prepared" ||
      row.broadcastAttemptedAtMs !== null) fail("direct_oft_canary_broadcast_state_invalid");
  const rpc = deps.rpc ?? new Connection(config.solanaRpcUrl, "confirmed");
  await assertSolanaReserve(rpc, config.sourceWallet, plan.messagingFeeLamports);
  const expectedJournal = {
    id: row.id, sourceWallet: row.sourceWallet,
    destinationTreasury: row.destinationTreasury,
    sourceAmountAtomic: row.sourceAmountAtomic,
    minimumDestinationWei: row.minimumDestinationWei,
    quoteId: row.quoteId, quoteExpiresAtMs: row.quoteExpiresAtMs,
    routeType: row.routeType,
    signedTransactionBase64: row.signedTransactionBase64,
    signedTransactionSha256: row.signedTransactionSha256,
    sourceSignature: row.sourceSignature,
    nowMs: Date.now(),
  };
  const outcome = await (deps.broadcastImpl ?? broadcastDirectOftChilizOnce)({
    expectedJournal, plan,
    loadPersisted: async (id) => {
      if (id !== config.id) fail("direct_oft_canary_journal_id_invalid");
      const loaded = await api.load();
      assertJournalMatchesConfig(loaded, config);
      return loaded;
    },
    claimBroadcastAttempt: async (id, sourceSignature) => {
      if (id !== config.id || sourceSignature !== row.sourceSignature) {
        fail("direct_oft_canary_claim_identity_invalid");
      }
      const claimed = await api.claim(sourceSignature, config.signedTransactionSha256);
      assertJournalMatchesConfig(claimed.journal, config);
      return { changedRows: claimed.changedRows, journal: claimed.journal };
    },
    rpc, solanaRpcUrl: config.solanaRpcUrl,
    primaryChilizRpcUrl: config.primaryChilizRpcUrl,
    secondaryChilizRpcUrl: config.secondaryChilizRpcUrl,
    fetchImpl: deps.fetchImpl,
  });
  if (outcome.state !== "delivered") return outcome;
  const reconciled = await api.reconcile();
  if (reconciled.sourceSignature !== row.sourceSignature) {
    fail("direct_oft_canary_reconciliation_invalid");
  }
  return { state: "delivered", sourceSignature: reconciled.sourceSignature,
    destinationTxHash: reconciled.destinationTxHash };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const outcome = await runDirectOftCanary(readDirectOftCanaryConfig());
    // Only public transaction identifiers and state are printed. No token,
    // signed transaction bytes, RPC URL, or plan JSON ever enter the logs.
    process.stdout.write(`${JSON.stringify({ state: outcome.state,
      sourceSignature: outcome.sourceSignature ??
        outcome.evidence?.source?.sourceSignature ?? null })}\n`);
  } catch (error) {
    const code = error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message) ?
      error.message : "direct_oft_canary_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
