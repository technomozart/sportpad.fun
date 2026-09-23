import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
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
import { inspectBuybackOrder, inspectBuybackSettlement, inspectBuybackBurnReceipt } from "../lib/protocol/buyback-safety.mjs";

const SOL = "So11111111111111111111111111111111111111112";
const ORDER_URL = "https://api.jup.ag/swap/v2/order";
const EXECUTE_URL = "https://api.jup.ag/swap/v2/execute";
// The quote and transaction are now inspected before signing, but the buyback
// lane remains closed until swap and burn have a durable replay-safe ledger.
const BUYBACK_EXECUTION_SAFE = false;

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
if (!rewards && !BUYBACK_EXECUTION_SAFE) throw new Error("Buyback execution is disabled pending durable swap/burn recovery.");
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`, "confirmed");
const workerId = `solana:${(buyback ?? rewards).publicKey.toBase58()}`;

async function assertPublishedTreasuries() {
  const response = await fetch(`${baseUrl}/api/protocol/status`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("published_treasuries_unavailable");
  const status = await response.json();
  if (rewards && status?.treasuries?.reward !== rewards.publicKey.toBase58()) {
    throw new Error("reward_signer_does_not_match_published_treasury");
  }
  if (buyback && status?.treasuries?.buyback !== buyback.publicKey.toBase58()) {
    throw new Error("buyback_signer_does_not_match_published_treasury");
  }
}

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

async function buyAndBurn(payload, arm) {
  if (!BUYBACK_EXECUTION_SAFE) throw new Error("buyback_execution_disabled_pending_durable_recovery");
  if (!buyback) throw new Error("buyback_signer_not_configured");
  const mint = new PublicKey(payload.sportpadMint);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "confirmed", tokenProgram);
  await arm();
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, buyback, mint, buyback.publicKey, false, "confirmed", undefined, tokenProgram,
  );
  const order = new URL(ORDER_URL);
  order.searchParams.set("inputMint", SOL);
  order.searchParams.set("outputMint", mint.toBase58());
  order.searchParams.set("amount", payload.amountLamports);
  order.searchParams.set("taker", buyback.publicKey.toBase58());
  order.searchParams.set("slippageBps", "100");
  order.searchParams.set("excludeRouters", "jupiterz,dflow,okx");
  const orderResponse = await fetch(order, { headers: { Accept: "application/json", "x-api-key": jupiterKey }, signal: AbortSignal.timeout(15_000) });
  const quote = await orderResponse.json().catch(() => ({}));
  if (!orderResponse.ok || !quote.transaction) {
    throw new Error("sportpad_jupiter_route_unavailable");
  }
  const inspection = await inspectBuybackOrder({
    connection,
    quote,
    signer: buyback.publicKey,
    mint,
    tokenProgram,
    amountLamports: payload.amountLamports,
  });
  if (!inspection.outputAta.equals(tokenAccount.address)) throw new Error("sportpad_output_ata_mismatch");
  const transaction = inspection.transaction;
  transaction.sign([buyback]);
  const expectedSignature = bs58.encode(transaction.signatures[0]);
  const executeResponse = await fetch(EXECUTE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": jupiterKey },
    body: JSON.stringify({ signedTransaction: Buffer.from(transaction.serialize()).toString("base64"), requestId: quote.requestId, lastValidBlockHeight: quote.lastValidBlockHeight }),
    signal: AbortSignal.timeout(45_000),
  });
  const executed = await executeResponse.json().catch(() => ({}));
  if (!executeResponse.ok || executed.status !== "Success" || !executed.signature) throw new Error("sportpad_swap_failed");
  if (executed.signature !== expectedSignature) throw new Error("sportpad_swap_signature_mismatch");
  const receipt = await connection.getTransaction(executed.signature, {
    commitment: "confirmed", maxSupportedTransactionVersion: 0,
  });
  const { purchased } = inspectBuybackSettlement(receipt, inspection);
  const balanceAfter = BigInt((await connection.getTokenAccountBalance(tokenAccount.address, "confirmed")).value.amount);
  if (balanceAfter < purchased) throw new Error("sportpad_swap_output_missing");
  const burn = new Transaction().add(createBurnCheckedInstruction(
    tokenAccount.address, mint, buyback.publicKey, purchased, mintState.decimals, [], tokenProgram,
  ));
  const burnSignature = await sendAndConfirmTransaction(connection, burn, [buyback], { commitment: "confirmed", maxRetries: 4 });
  const burnReceipt = await connection.getTransaction(burnSignature, { commitment: "confirmed" });
  inspectBuybackBurnReceipt(burnReceipt, {
    signature: burnSignature, outputAta: tokenAccount.address, mint,
    signer: buyback.publicKey, amount: purchased,
  });
  return { txHash: burnSignature, sourceTxHash: executed.signature, outputAmountAtomic: purchased.toString() };
}

async function paySolanaClaim(payload, arm) {
  if (!rewards) throw new Error("reward_signer_not_configured");
  const mint = new PublicKey(payload.tokenAddress);
  const destination = new PublicKey(payload.destinationAddress);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "confirmed", tokenProgram);
  const source = await getAssociatedTokenAddress(mint, rewards.publicKey, false, tokenProgram);
  const amount = BigInt(payload.amountAtomic);
  const sourceBalance = BigInt((await connection.getTokenAccountBalance(source, "confirmed")).value.amount);
  if (sourceBalance < amount) throw new Error("reward_inventory_underfunded");
  await arm();
  const destinationAccount = await getOrCreateAssociatedTokenAccount(
    connection, rewards, mint, destination, false, "confirmed", undefined, tokenProgram,
  );
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
  if (buyback && BUYBACK_EXECUTION_SAFE) jobTypes.push("sportpad_buyback_burn");
  if (rewards) jobTypes.push("solana_claim_payout");
  const { job } = await api({ action: "lease", workerId, jobTypes });
  if (!job) return false;
  try {
    await assertPublishedTreasuries();
    const arm = async () => { await api({ action: "arm", jobId: job.id, workerId }); };
    const result = job.type === "sportpad_buyback_burn" ? await buyAndBurn(job.payload, arm) : await paySolanaClaim(job.payload, arm);
    await api({ action: "complete", jobId: job.id, workerId, ...result });
  } catch (error) {
    await api({ action: "fail", jobId: job.id, workerId, errorCode: errorCode(error), retryable: retryable(error) });
  }
  return true;
}

await assertPublishedTreasuries();
for (;;) {
  const worked = await runOnce().catch((error) => {
    process.stderr.write(`${new Date().toISOString()} ${errorCode(error)}\n`);
    return false;
  });
  if (!worked) await new Promise((resolve) => setTimeout(resolve, 5_000));
}
