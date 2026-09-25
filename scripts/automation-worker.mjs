import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHILIZ_REWARD_ASSETS } from "../lib/protocol/chiliz-reward-assets.ts";
import { persistChilizIntent, purchasedTokenOutput, sendPersistedChilizIntent,
  signChilizTransaction, verifyRecoveredChilizIntent, waitForFinalizedChilizReceipt,
} from "./chiliz-worker-intent.mjs";
import {
  assertChilizTreasuryAddressMatchesAccount,
  assertFreshQuote,
  assertOfficialV2Asset,
  chzSpendFromSolanaQuote,
  normalizeChilizTreasuryPrivateKey,
  positiveAtomic,
  validateKayenQuote,
} from "../lib/protocol/chiliz-worker-safety.mjs";

const CHILIZ = {
  id: 88888,
  name: "Chiliz Chain",
  nativeCurrency: { name: "Chiliz", symbol: "CHZ", decimals: 18 },
  rpcUrls: { default: { http: [process.env.CHILIZ_RPC_URL || "https://rpc.chiliz.com"] } },
  blockExplorers: { default: { name: "Chiliz Explorer", url: "https://scan.chiliz.com" } },
};
const KAYEN_ROUTER = "0x1918EbB39492C8b98865c5E53219c3f1AE79e76F";
const WCHZ = "0x677F7e16C7Dd57be1D4C8aD1244883214953DC47";
const SOL = "So11111111111111111111111111111111111111112";
const SOLANA_CHZ = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const ONE_CHZ = 1_000_000_000_000_000_000n;
// A read-only route audit is not a funded end-to-end canary. Keep this hold
// independent of API flags so an accidental deployment cannot move funds.
const CHILIZ_WORKER_V2_EXECUTION_VERIFIED = false;
const ERC20 = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const ROUTER = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const baseUrl = required("SPORTPAD_BASE_URL").replace(/\/$/, "");
const workerToken = required("SPORTPAD_WORKER_TOKEN");
const privateKey = normalizeChilizTreasuryPrivateKey(required("CHILIZ_TREASURY_PRIVATE_KEY"));
const account = privateKeyToAccount(privateKey);
assertChilizTreasuryAddressMatchesAccount(required("CHILIZ_TREASURY_ADDRESS"), account.address);
const transport = http(CHILIZ.rpcUrls.default.http[0], { timeout: 20_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: CHILIZ, transport });
const secondaryRpcUrl = process.env.CHILIZ_SECONDARY_RPC_URL?.trim() ||
  (CHILIZ.rpcUrls.default.http[0].includes("rpc.ankr.com")
    ? "https://chiliz-rpc.publicnode.com" : "https://rpc.ankr.com/chiliz");
if (new URL(secondaryRpcUrl).hostname === new URL(CHILIZ.rpcUrls.default.http[0]).hostname) {
  throw new Error("CHILIZ_SECONDARY_RPC_URL must be independent of CHILIZ_RPC_URL.");
}
const secondaryClient = createPublicClient({ chain: CHILIZ,
  transport: http(secondaryRpcUrl, { timeout: 20_000, retryCount: 1 }) });
const workerId = `chiliz:${account.address.toLowerCase()}`;

async function api(body) {
  const response = await fetch(`${baseUrl}/api/internal/workers/automation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${workerToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `SportPad worker API returned ${response.status}.`);
  return payload;
}

async function runMaintenance(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${workerToken}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 503) return;
  if (!response.ok) throw new Error(`maintenance_${path.split("/").at(-1)}_${response.status}`);
}

async function solToChzWei(lamports) {
  positiveAtomic(lamports, "chiliz_quote_input_invalid");
  const key = required("JUPITER_API_KEY");
  const url = new URL("https://api.jup.ag/swap/v2/order");
  url.searchParams.set("inputMint", SOL);
  url.searchParams.set("outputMint", SOLANA_CHZ);
  url.searchParams.set("amount", lamports);
  const response = await fetch(url, { headers: { Accept: "application/json", "x-api-key": key }, signal: AbortSignal.timeout(12_000) });
  const quotedAt = Date.now();
  const quote = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("chiliz_quote_unavailable");
  return chzSpendFromSolanaQuote(quote, lamports, quotedAt, Date.now(), SOL, SOLANA_CHZ);
}

async function markChilizBroadcast(intent) {
  const marked = await api({ action: "mark_chiliz_broadcast", jobId: intent.jobId,
    workerId, txHash: intent.txHash });
  if (marked.marked !== true) throw new Error("chiliz_broadcast_marker_unconfirmed");
}

async function finishChilizIntent(intent) {
  const receipt = await waitForFinalizedChilizReceipt(intent, publicClient, secondaryClient);
  const completion = await api({ action: "complete", jobId: intent.jobId, workerId,
    txHash: intent.txHash,
    ...(intent.kind === "purchase" ? { outputAmountAtomic: purchasedTokenOutput(intent, receipt) } : {}),
  });
  if (completion.completed !== true) throw new Error("chiliz_receipt_not_committed");
}

async function executePurchase(job, arm) {
  if (!CHILIZ_WORKER_V2_EXECUTION_VERIFIED) throw new Error("chiliz_v2_execution_not_verified");
  if (job.attempt !== 1) throw new Error("chiliz_job_replacement_forbidden");
  const payload = job.payload;
  assertOfficialV2Asset(payload, CHILIZ_REWARD_ASSETS);
  const token = payload.fanTokenContract;
  const decimals = await publicClient.readContract({ address: token, abi: ERC20, functionName: "decimals" });
  if (decimals !== 18) throw new Error("chiliz_v2_decimals_mismatch");
  const spend = await solToChzWei(payload.rewardAmountLamports);
  const path = [WCHZ, token];
  const probeInput = spend / 10n;
  const [probeAmounts, fullAmounts] = await Promise.all([
    publicClient.readContract({ address: KAYEN_ROUTER, abi: ROUTER, functionName: "getAmountsOut", args: [probeInput, path] }),
    publicClient.readContract({ address: KAYEN_ROUTER, abi: ROUTER, functionName: "getAmountsOut", args: [spend, path] }),
  ]);
  const quotedAt = Date.now();
  const minimum = validateKayenQuote(spend, probeInput, probeAmounts, fullAmounts, quotedAt, Date.now());
  const signedAtEpochSeconds = Math.floor(Date.now() / 1_000);
  const deadlineEpochSeconds = signedAtEpochSeconds + 120;
  const data = encodeFunctionData({ abi: ROUTER, functionName: "swapExactETHForTokens",
    args: [minimum, path, account.address, BigInt(deadlineEpochSeconds)] });
  const signed = await signChilizTransaction({ publicClient, account,
    to: KAYEN_ROUTER, data, value: spend, kind: "purchase" });
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance <= spend + signed.gasFeeCeilingWei + ONE_CHZ) {
    throw new Error("chiliz_treasury_underfunded");
  }
  assertFreshQuote(quotedAt, Date.now());
  await arm();
  assertFreshQuote(quotedAt, Date.now());
  const intent = await persistChilizIntent({ kind: "purchase", jobId: job.id,
    attempt: 1, treasury: account.address, fanTokenContract: token,
    maxPrincipalWei: spend.toString(), minimumOutputAtomic: minimum.toString(),
    signedAtEpochSeconds, deadlineEpochSeconds,
    rawTransaction: signed.rawTransaction,
    gasFeeCeilingWei: signed.gasFeeCeilingWei.toString(),
  }, api);
  await markChilizBroadcast(intent);
  await sendPersistedChilizIntent(intent, publicClient);
  await finishChilizIntent(intent);
}

async function executeClaim(job, arm) {
  if (!CHILIZ_WORKER_V2_EXECUTION_VERIFIED) throw new Error("chiliz_v2_execution_not_verified");
  if (job.attempt !== 1) throw new Error("chiliz_job_replacement_forbidden");
  const payload = job.payload;
  assertOfficialV2Asset(payload, CHILIZ_REWARD_ASSETS);
  if (typeof payload.destinationAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payload.destinationAddress)) {
    throw new Error("claim_destination_invalid");
  }
  const amount = positiveAtomic(payload.amountAtomic, "claim_amount_invalid");
  const token = payload.fanTokenContract;
  const decimals = await publicClient.readContract({ address: token, abi: ERC20, functionName: "decimals" });
  if (decimals !== 18) throw new Error("chiliz_v2_decimals_mismatch");
  const balance = await publicClient.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  if (balance < amount) throw new Error("reward_inventory_underfunded");
  const data = encodeFunctionData({ abi: ERC20, functionName: "transfer",
    args: [payload.destinationAddress, amount] });
  const signed = await signChilizTransaction({ publicClient, account,
    to: token, data, value: 0n, kind: "claim" });
  const gasBalance = await publicClient.getBalance({ address: account.address });
  if (gasBalance <= signed.gasFeeCeilingWei) throw new Error("chiliz_claim_gas_underfunded");
  await arm();
  const intent = await persistChilizIntent({ kind: "claim", jobId: job.id,
    attempt: 1, treasury: account.address, fanTokenContract: token,
    destination: payload.destinationAddress, amountAtomic: amount.toString(),
    rawTransaction: signed.rawTransaction,
    gasFeeCeilingWei: signed.gasFeeCeilingWei.toString(),
  }, api);
  await markChilizBroadcast(intent);
  await sendPersistedChilizIntent(intent, publicClient);
  await finishChilizIntent(intent);
}

async function reconcilePreparedChilizIntent() {
  if (!CHILIZ_WORKER_V2_EXECUTION_VERIFIED) return false;
  const { prepared, mayBroadcast } = await api({ action: "reconcile_chiliz_intent", workerId });
  if (!prepared) return false;
  const intent = await verifyRecoveredChilizIntent(prepared, account.address);
  const job = prepared.job;
  if (!job || !job.payload ||
    (intent.kind === "purchase" && job.type !== "chiliz_reward_purchase") ||
    (intent.kind === "claim" && job.type !== "chiliz_claim_unwrap") ||
    job.payload.fanTokenContract?.toLowerCase() !== intent.fanTokenContract.toLowerCase() ||
    (intent.kind === "claim" && (
      job.payload.destinationAddress?.toLowerCase() !== intent.destination.toLowerCase() ||
      job.payload.amountAtomic !== intent.amountAtomic))) {
    throw new Error("chiliz_recovered_job_mismatch");
  }
  assertOfficialV2Asset(job.payload, CHILIZ_REWARD_ASSETS);
  try {
    if (mayBroadcast === true) {
      // Only the previously persisted raw transaction can be resent.
      await markChilizBroadcast(intent);
      await sendPersistedChilizIntent(intent, publicClient);
    }
    await finishChilizIntent(intent);
  } catch (error) {
    // Never derive a replacement transaction from an uncertain outcome.
    process.stderr.write(`${new Date().toISOString()} chiliz recovery: ${errorCode(error)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return true;
}

function errorCode(error) {
  const text = error instanceof Error ? error.message : "unknown";
  return text.toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 100) || "worker_failed";
}

function retryable(error) {
  const code = errorCode(error);
  return !code.includes("not_whole_token") && !code.includes("invalid") && !code.includes("reverted");
}

async function runOnce() {
  if (await reconcilePreparedChilizIntent()) return true;
  const { job } = await api({ action: "lease", workerId, jobTypes: ["chiliz_reward_purchase", "chiliz_claim_unwrap"] });
  if (!job) return false;
  try {
    const arm = async () => { await api({ action: "arm", jobId: job.id, workerId }); };
    if (job.type === "chiliz_reward_purchase") await executePurchase(job, arm);
    else if (job.type === "chiliz_claim_unwrap") await executeClaim(job, arm);
    else throw new Error("chiliz_job_type_invalid");
  } catch (error) {
    await api({ action: "fail", jobId: job.id, workerId, errorCode: errorCode(error), retryable: retryable(error) });
  }
  return true;
}

async function main() {
  let nextFeeScan = 0;
  let nextHolderScan = 0;
  let nextTreasuryScan = 0;
  for (;;) {
    const now = Date.now();
    if (now >= nextFeeScan) {
      await runMaintenance("/api/internal/workers/fees").catch((error) => process.stderr.write(`${new Date().toISOString()} ${errorCode(error)}\n`));
      nextFeeScan = now + 60_000;
    }
    if (now >= nextHolderScan) {
      await runMaintenance("/api/internal/workers/holders").catch((error) => process.stderr.write(`${new Date().toISOString()} ${errorCode(error)}\n`));
      nextHolderScan = now + 60_000;
    }
    if (now >= nextTreasuryScan) {
      await runMaintenance("/api/internal/workers/treasury").catch((error) => process.stderr.write(`${new Date().toISOString()} ${errorCode(error)}\n`));
      nextTreasuryScan = now + 5 * 60_000;
    }
    const worked = await runOnce().catch((error) => {
      process.stderr.write(`${new Date().toISOString()} automation loop error: ${errorCode(error)}\n`);
      return false;
    });
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

const isolatedCanaryAction = process.env.SPORTPAD_CHILIZ_CANARY_ACTION?.trim();
if (isolatedCanaryAction === "afc_v2_buy") {
  const { afcCanaryConfig, runAfcV2BuyCanary } = await import(
    "./chiliz-afc-v2-buy-canary-worker.mjs");
  const outcome = await runAfcV2BuyCanary(afcCanaryConfig(
    process.env, account, workerToken, baseUrl));
  process.stdout.write(`${JSON.stringify({ state: outcome.state,
    txHash: outcome.txHash, outputAmountAtomic: outcome.outputAmountAtomic ?? null })}\n`);
} else if (isolatedCanaryAction) {
  throw new Error("chiliz_canary_action_invalid");
} else {
  await main();
}
