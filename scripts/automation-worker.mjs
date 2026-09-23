import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHILIZ = {
  id: 88888,
  name: "Chiliz Chain",
  nativeCurrency: { name: "Chiliz", symbol: "CHZ", decimals: 18 },
  rpcUrls: { default: { http: [process.env.CHILIZ_RPC_URL || "https://rpc.chiliz.com"] } },
  blockExplorers: { default: { name: "Chiliz Explorer", url: "https://scan.chiliz.com" } },
};
const KAYEN_ROUTER = "0x1918EbB39492C8b98865c5E53219c3f1AE79e76F";
const WRAPPER_FACTORY = "0xAEdcF2bf41891777c5F638A098bbdE1eDBa7B264";
const WCHZ = "0x677F7e16C7Dd57be1D4C8aD1244883214953DC47";
const SOL = "So11111111111111111111111111111111111111112";
const SOLANA_CHZ = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const ONE_FAN_TOKEN = 1_000_000_000_000_000_000n;
const ERC20 = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const ROUTER = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const WRAPPER = parseAbi(["function unwrap(address account, address wrappedToken, uint256 amount)"]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const baseUrl = required("SPORTPAD_BASE_URL").replace(/\/$/, "");
const workerToken = required("SPORTPAD_WORKER_TOKEN");
const privateKey = required("CHILIZ_TREASURY_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("CHILIZ_TREASURY_PRIVATE_KEY must be a 0x-prefixed private key.");
const account = privateKeyToAccount(privateKey);
const transport = http(CHILIZ.rpcUrls.default.http[0], { timeout: 20_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: CHILIZ, transport });
const walletClient = createWalletClient({ account, chain: CHILIZ, transport });
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
  const key = required("JUPITER_API_KEY");
  const url = new URL("https://api.jup.ag/swap/v2/order");
  url.searchParams.set("inputMint", SOL);
  url.searchParams.set("outputMint", SOLANA_CHZ);
  url.searchParams.set("amount", lamports);
  const response = await fetch(url, { headers: { Accept: "application/json", "x-api-key": key }, signal: AbortSignal.timeout(12_000) });
  const quote = await response.json().catch(() => ({}));
  if (!response.ok || !/^[1-9][0-9]*$/.test(quote.outAmount || "")) throw new Error("chz_quote_unavailable");
  const impact = Math.abs(Number(quote.priceImpact));
  if (!Number.isFinite(impact) || impact > 5) throw new Error("chz_quote_price_impact");
  return BigInt(quote.outAmount) * 10_000_000_000n;
}

async function executePurchase(payload, arm) {
  const spend = await solToChzWei(payload.rewardAmountLamports);
  const gasReserve = 3n * ONE_FAN_TOKEN;
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance <= spend + gasReserve) throw new Error("chiliz_treasury_underfunded");
  const path = [WCHZ, payload.wrappedContract];
  const amounts = await publicClient.readContract({ address: KAYEN_ROUTER, abi: ROUTER, functionName: "getAmountsOut", args: [spend, path] });
  const expected = amounts.at(-1);
  if (!expected || expected <= 0n) throw new Error("kayen_route_unavailable");
  const minimum = expected * 975n / 1_000n;
  const before = await publicClient.readContract({ address: payload.wrappedContract, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  await arm();
  const hash = await walletClient.writeContract({
    address: KAYEN_ROUTER,
    abi: ROUTER,
    functionName: "swapExactETHForTokens",
    args: [minimum, path, account.address, BigInt(Math.floor(Date.now() / 1_000) + 180)],
    value: spend,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("kayen_swap_reverted");
  const after = await publicClient.readContract({ address: payload.wrappedContract, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  const acquired = after - before;
  if (acquired < minimum) throw new Error("kayen_output_below_minimum");
  return { txHash: hash, outputAmountAtomic: acquired.toString() };
}

async function executeClaim(payload, arm) {
  const amount = BigInt(payload.amountAtomic);
  if (amount <= 0n || amount % ONE_FAN_TOKEN !== 0n) throw new Error("claim_amount_not_whole_token");
  const balance = await publicClient.readContract({ address: payload.wrappedContract, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  if (balance < amount) throw new Error("reward_inventory_underfunded");
  const allowance = await publicClient.readContract({ address: payload.wrappedContract, abi: ERC20, functionName: "allowance", args: [account.address, WRAPPER_FACTORY] });
  await arm();
  if (allowance < amount) {
    const approvalHash = await walletClient.writeContract({
      address: payload.wrappedContract,
      abi: ERC20,
      functionName: "approve",
      args: [WRAPPER_FACTORY, 2n ** 256n - 1n],
      account,
    });
    const approval = await publicClient.waitForTransactionReceipt({ hash: approvalHash, confirmations: 2, timeout: 120_000 });
    if (approval.status !== "success") throw new Error("wrapper_approval_reverted");
  }
  const hash = await walletClient.writeContract({
    address: WRAPPER_FACTORY,
    abi: WRAPPER,
    functionName: "unwrap",
    args: [payload.destinationAddress, payload.wrappedContract, amount],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("reward_unwrap_reverted");
  return { txHash: hash };
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
  const { job } = await api({ action: "lease", workerId, jobTypes: ["chiliz_reward_purchase", "chiliz_claim_unwrap"] });
  if (!job) return false;
  try {
    const arm = async () => { await api({ action: "arm", jobId: job.id, workerId }); };
    const result = job.type === "chiliz_reward_purchase"
      ? await executePurchase(job.payload, arm)
      : await executeClaim(job.payload, arm);
    await api({ action: "complete", jobId: job.id, workerId, ...result });
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

await main();
