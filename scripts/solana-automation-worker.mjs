import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const SOL = "So11111111111111111111111111111111111111112";
const ORDER_URL = "https://api.jup.ag/swap/v2/order";
const EXECUTE_URL = "https://api.jup.ag/swap/v2/execute";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function keypairFromSecret(value, name) {
  try {
    const bytes = value.trim().startsWith("[") ? Uint8Array.from(JSON.parse(value)) : bs58.decode(value.trim());
    if (bytes.length !== 64) throw new Error("length");
    return Keypair.fromSecretKey(bytes);
  } catch { throw new Error(`${name} must be a base58 64-byte Solana secret key or JSON byte array.`); }
}

const baseUrl = required("SPORTPAD_BASE_URL").replace(/\/$/, "");
const workerToken = required("SPORTPAD_WORKER_TOKEN");
const jupiterKey = required("JUPITER_API_KEY");
const heliusKey = required("HELIUS_API_KEY");
const buyback = process.env.SOLANA_BUYBACK_PRIVATE_KEY?.trim() ? keypairFromSecret(process.env.SOLANA_BUYBACK_PRIVATE_KEY, "SOLANA_BUYBACK_PRIVATE_KEY") : null;
const rewards = process.env.SOLANA_REWARD_VAULT_PRIVATE_KEY?.trim() ? keypairFromSecret(process.env.SOLANA_REWARD_VAULT_PRIVATE_KEY, "SOLANA_REWARD_VAULT_PRIVATE_KEY") : null;
if (!buyback && !rewards) throw new Error("Configure at least one Solana automation key.");
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`, "confirmed");
const workerId = `solana:${(buyback ?? rewards).publicKey.toBase58()}`;

async function tokenProgramForMint(mint) {
  const account = await connection.getAccountInfo(mint, "confirmed");
  if (!account) throw new Error("token_mint_not_found");
  if (account.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error("unsupported_token_program");
}

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

async function buyAndBurn(payload) {
  if (!buyback) throw new Error("buyback_signer_not_configured");
  const mint = new PublicKey(payload.sportpadMint);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "confirmed", tokenProgram);
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, buyback, mint, buyback.publicKey, false, "confirmed", undefined, tokenProgram,
  );
  const balanceBefore = BigInt((await connection.getTokenAccountBalance(tokenAccount.address, "confirmed")).value.amount);
  const supplyBefore = mintState.supply;
  const order = new URL(ORDER_URL);
  order.searchParams.set("inputMint", SOL);
  order.searchParams.set("outputMint", mint.toBase58());
  order.searchParams.set("amount", payload.amountLamports);
  order.searchParams.set("taker", buyback.publicKey.toBase58());
  order.searchParams.set("slippageBps", "100");
  order.searchParams.set("excludeRouters", "jupiterz,dflow");
  const orderResponse = await fetch(order, { headers: { Accept: "application/json", "x-api-key": jupiterKey }, signal: AbortSignal.timeout(15_000) });
  const quote = await orderResponse.json().catch(() => ({}));
  if (!orderResponse.ok || !quote.transaction || !new Set(["metis", "okx"]).has(quote.router)) {
    throw new Error("sportpad_jupiter_route_unavailable");
  }
  if (quote.inputMint !== SOL || quote.outputMint !== mint.toBase58() || quote.inAmount !== payload.amountLamports || quote.taker !== buyback.publicKey.toBase58()) throw new Error("sportpad_jupiter_constraint_changed");
  const impact = Math.abs(Number(quote.priceImpact));
  if (!Number.isFinite(impact) || impact > 5) throw new Error("sportpad_price_impact_limit");
  const transaction = VersionedTransaction.deserialize(Buffer.from(quote.transaction, "base64"));
  if (transaction.message.staticAccountKeys[0]?.toBase58() !== buyback.publicKey.toBase58()) throw new Error("sportpad_fee_payer_mismatch");
  transaction.sign([buyback]);
  const executeResponse = await fetch(EXECUTE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": jupiterKey },
    body: JSON.stringify({ signedTransaction: Buffer.from(transaction.serialize()).toString("base64"), requestId: quote.requestId, lastValidBlockHeight: quote.lastValidBlockHeight }),
    signal: AbortSignal.timeout(45_000),
  });
  const executed = await executeResponse.json().catch(() => ({}));
  if (!executeResponse.ok || executed.status !== "Success" || !executed.signature) throw new Error("sportpad_swap_failed");
  const balanceAfter = BigInt((await connection.getTokenAccountBalance(tokenAccount.address, "confirmed")).value.amount);
  const purchased = balanceAfter - balanceBefore;
  if (purchased <= 0n) throw new Error("sportpad_swap_output_missing");
  const burn = new Transaction().add(createBurnCheckedInstruction(
    tokenAccount.address, mint, buyback.publicKey, purchased, mintState.decimals, [], tokenProgram,
  ));
  const burnSignature = await sendAndConfirmTransaction(connection, burn, [buyback], { commitment: "confirmed", maxRetries: 4 });
  const supplyAfter = (await getMint(connection, mint, "confirmed", tokenProgram)).supply;
  if (supplyBefore - supplyAfter !== purchased) throw new Error("sportpad_supply_delta_mismatch");
  return { txHash: burnSignature, sourceTxHash: executed.signature, outputAmountAtomic: purchased.toString() };
}

async function paySolanaClaim(payload) {
  if (!rewards) throw new Error("reward_signer_not_configured");
  const mint = new PublicKey(payload.tokenAddress);
  const destination = new PublicKey(payload.destinationAddress);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "confirmed", tokenProgram);
  const source = await getAssociatedTokenAddress(mint, rewards.publicKey, false, tokenProgram);
  const destinationAccount = await getOrCreateAssociatedTokenAccount(
    connection, rewards, mint, destination, false, "confirmed", undefined, tokenProgram,
  );
  const amount = BigInt(payload.amountAtomic);
  const sourceBalance = BigInt((await connection.getTokenAccountBalance(source, "confirmed")).value.amount);
  if (sourceBalance < amount) throw new Error("reward_inventory_underfunded");
  const transaction = new Transaction().add(createTransferCheckedInstruction(
    source, mint, destinationAccount.address, rewards.publicKey, amount, mintState.decimals, [], tokenProgram,
  ));
  const signature = await sendAndConfirmTransaction(connection, transaction, [rewards], { commitment: "confirmed", maxRetries: 4 });
  return { txHash: signature };
}

function errorCode(error) {
  const text = error instanceof Error ? error.message : "unknown";
  return text.toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 100) || "worker_failed";
}
function retryable(error) {
  const code = errorCode(error);
  return !code.includes("constraint_changed") && !code.includes("mismatch") && !code.includes("invalid");
}

async function runOnce() {
  const jobTypes = [];
  if (buyback) jobTypes.push("sportpad_buyback_burn");
  if (rewards) jobTypes.push("solana_claim_payout");
  const { job } = await api({ action: "lease", workerId, jobTypes });
  if (!job) return false;
  try {
    const result = job.type === "sportpad_buyback_burn" ? await buyAndBurn(job.payload) : await paySolanaClaim(job.payload);
    await api({ action: "complete", jobId: job.id, workerId, ...result });
  } catch (error) {
    await api({ action: "fail", jobId: job.id, workerId, errorCode: errorCode(error), retryable: retryable(error) });
  }
  return true;
}

for (;;) {
  const worked = await runOnce().catch((error) => {
    process.stderr.write(`${new Date().toISOString()} ${errorCode(error)}\n`);
    return false;
  });
  if (!worked) await new Promise((resolve) => setTimeout(resolve, 5_000));
}
