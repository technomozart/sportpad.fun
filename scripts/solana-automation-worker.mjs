import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { buybackSafetyLimits, inspectBuybackOrder, inspectBuybackSettlement,
  inspectBuybackBurnReceipt } from "../lib/protocol/buyback-safety.mjs";
import { inspectPersistedBuybackBurn, signBuybackBurn } from "./solana-buyback-burn.mjs";
import { signPersistedBuybackSwap } from "./solana-buyback-swap-replay.mjs";
import { inspectPersistedSolanaClaimTransfer, signSolanaClaimTransfer } from "./solana-claim-transfer.mjs";
import { reconcileRewardPurchases, rewardWorkerJobTypes } from "./solana-reward-recovery.mjs";

const SOL = "So11111111111111111111111111111111111111112";
const ORDER_URL = "https://api.jup.ag/swap/v2/order";
const EXECUTE_URL = "https://api.jup.ag/swap/v2/execute";
// The quote and transaction are now inspected before signing, but the buyback
// lane remains closed until swap and burn have a durable replay-safe ledger.
const BUYBACK_EXECUTION_SAFE = false;
// Claims need the same durable pre-broadcast signature and recovery path as
// purchases. Leave the lane closed until the matching API is verified.
const CLAIM_PAYOUT_EXECUTION_SAFE = false;
// Keep the new purchase lane dark until a funded end-to-end canary has
// exercised the persisted order, finalized receipt, ledger, and claim path.
const REWARD_PURCHASE_EXECUTION_SAFE = false;

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
const buybackWorkerId = buyback ? `solana:${buyback.publicKey.toBase58()}` : null;
const rewardWorkerId = rewards ? `solana:${rewards.publicKey.toBase58()}` : null;

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

async function finalizedBuybackSwap(payload, signature) {
  validateBuybackChunkPayload(payload);
  if (!buyback) throw new Error("buyback_recovery_payload_invalid");
  const mint = new PublicKey(payload.sportpadMint);
  const tokenProgram = await tokenProgramForMint(mint);
  const outputAta = await getAssociatedTokenAddress(mint, buyback.publicKey, false, tokenProgram);
  const [receipt, statuses] = await Promise.all([
    connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
    connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
  ]);
  const status = statuses.value[0];
  if (!receipt?.meta || receipt.meta.err !== null ||
    receipt.transaction.signatures[0] !== signature ||
    !status || status.err !== null || status.confirmationStatus !== "finalized" ||
    status.slot !== receipt.slot) throw new Error("buyback_swap_finality_unverified");
  let accountKeys;
  try {
    accountKeys = receipt.transaction.message.getAccountKeys({
      accountKeysFromLookups: receipt.meta.loadedAddresses ?? { writable: [], readonly: [] },
    });
  } catch { throw new Error("buyback_swap_accounts_unavailable"); }
  const message = receipt.transaction.message;
  if (message.header.numRequiredSignatures !== 1 ||
    !message.staticAccountKeys[0]?.equals(buyback.publicKey) ||
    message.compiledInstructions.filter((ix) =>
      accountKeys.get(ix.programIdIndex)?.toBase58() === buybackSafetyLimits.router).length !== 1) {
    throw new Error("buyback_swap_route_unverified");
  }
  const { purchased } = inspectBuybackSettlement(receipt, {
    accountKeys, outputAta, mint, signer: buyback.publicKey,
    maxDebit: BigInt(payload.amountLamports) + 500_000n, minOutput: 1n,
  });
  return purchased;
}

function validateBuybackChunkPayload(payload, entityId) {
  const positive = /^[1-9][0-9]*$/;
  const nonnegative = /^(0|[1-9][0-9]*)$/;
  if (!payload || typeof payload.stepId !== "string" ||
    (entityId && payload.stepId !== entityId) ||
    !positive.test(payload.buybackTotalLamports ?? "") ||
    !positive.test(payload.amountLamports ?? "") ||
    !nonnegative.test(payload.chunkOffsetAtomic ?? "")) {
    throw new Error("buyback_chunk_payload_invalid");
  }
  const total = BigInt(payload.buybackTotalLamports);
  const offset = BigInt(payload.chunkOffsetAtomic);
  const amount = BigInt(payload.amountLamports);
  if (total > 9_223_372_036_854_775_807n || offset >= total ||
    amount !== (total - offset > 100_000_000n ? 100_000_000n : total - offset)) {
    throw new Error("buyback_chunk_amount_mismatch");
  }
}

async function finalizePreparedBuybackBurn(payload, sourceTxHash, amount, prepared) {
  if (!buyback) throw new Error("buyback_signer_not_configured");
  const mint = new PublicKey(payload.sportpadMint);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "finalized", tokenProgram);
  const checked = inspectPersistedBuybackBurn({
    signedTransactionBase64: prepared.signedTransactionBase64,
    signature: prepared.burnSignature,
    signer: buyback.publicKey.toBase58(), mint: mint.toBase58(),
    tokenProgram: tokenProgram.toBase58(), amountAtomic: amount.toString(),
    decimals: mintState.decimals,
  });
  if (!Number.isSafeInteger(prepared.lastValidBlockHeight) ||
    prepared.lastValidBlockHeight <= 0) throw new Error("buyback_burn_blockheight_invalid");
  let status = (await connection.getSignatureStatuses([prepared.burnSignature],
    { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error("buyback_burn_failed_on_chain");
  if (status?.confirmationStatus !== "finalized") {
    const currentHeight = await connection.getBlockHeight("finalized");
    if (currentHeight > prepared.lastValidBlockHeight) {
      throw new Error("buyback_burn_expired_without_finality");
    }
    const sent = await connection.sendRawTransaction(checked.bytes,
      { skipPreflight: false, maxRetries: 4 });
    if (sent !== prepared.burnSignature) throw new Error("buyback_burn_signature_mismatch");
    const confirmation = await connection.confirmTransaction({
      signature: prepared.burnSignature,
      blockhash: checked.transaction.recentBlockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    }, "finalized");
    if (confirmation.value.err) throw new Error("buyback_burn_not_finalized");
    status = (await connection.getSignatureStatuses([prepared.burnSignature],
      { searchTransactionHistory: true })).value[0];
  }
  if (!status || status.err !== null || status.confirmationStatus !== "finalized") {
    throw new Error("buyback_burn_finality_unverified");
  }
  const receipt = await connection.getTransaction(prepared.burnSignature,
    { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  inspectBuybackBurnReceipt(receipt, {
    signature: prepared.burnSignature, outputAta: checked.source, mint,
    signer: buyback.publicKey, amount,
  });
  return { txHash: prepared.burnSignature, sourceTxHash,
    outputAmountAtomic: amount.toString() };
}

async function burnPurchasedBuybackTokens(payload, jobId, workerId, sourceTxHash, amount,
  replacesBurnSignature = null) {
  if (!buyback) throw new Error("buyback_signer_not_configured");
  const mint = new PublicKey(payload.sportpadMint);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "finalized", tokenProgram);
  const tokenAccount = await getAssociatedTokenAddress(mint, buyback.publicKey, false, tokenProgram);
  const balanceAfter = BigInt((await connection.getTokenAccountBalance(tokenAccount, "finalized")).value.amount);
  if (balanceAfter < amount) throw new Error("sportpad_swap_output_missing");
  const latest = await connection.getLatestBlockhash("confirmed");
  const burn = signBuybackBurn({ signer: buyback, mint, tokenProgram,
    amountAtomic: amount, decimals: mintState.decimals, blockhash: latest.blockhash });
  if (!burn.source.equals(tokenAccount)) throw new Error("sportpad_burn_source_mismatch");
  const burnIntent = await api({ action: "prepare_buyback_burn", jobId, workerId,
    sourceTxHash, burnAmountAtomic: amount.toString(),
    signedTransactionBase64: burn.base64,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    ...(replacesBurnSignature ? { replacesBurnSignature } : {}) });
  if (!burnIntent.prepared || burnIntent.txSignature !== burn.signature) {
    throw new Error("sportpad_burn_intent_not_persisted");
  }
  return finalizePreparedBuybackBurn(payload, sourceTxHash, amount, {
    burnSignature: burn.signature, signedTransactionBase64: burn.base64,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
}

async function replayPreparedBuybackSwap(stage) {
  if (!buyback || !buybackWorkerId) throw new Error("buyback_replay_signer_not_configured");
  validateBuybackChunkPayload(stage.payload);
  if (typeof stage.jobId !== "string" ||
    typeof stage.providerRequestId !== "string" || !stage.providerRequestId ||
    !Number.isSafeInteger(stage.lastValidBlockHeight) ||
    stage.lastValidBlockHeight <= 0) throw new Error("buyback_replay_stage_invalid");
  const replay = signPersistedBuybackSwap({
    unsignedTransactionBase64: stage.unsignedTransactionBase64,
    signature: stage.signature, signer: buyback,
  });
  const currentHeight = await connection.getBlockHeight("finalized");
  if (currentHeight > stage.lastValidBlockHeight ||
    !(await connection.isBlockhashValid(replay.blockhash,
      { commitment: "confirmed" })).value) {
    throw new Error("buyback_replay_blockhash_expired");
  }
  const executeResponse = await fetch(EXECUTE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": jupiterKey },
    body: JSON.stringify({ signedTransaction: replay.signedTransactionBase64,
      requestId: stage.providerRequestId, lastValidBlockHeight: stage.lastValidBlockHeight }),
    signal: AbortSignal.timeout(45_000),
  });
  const executed = await executeResponse.json().catch(() => ({}));
  if (executed.signature && executed.signature !== stage.signature) {
    throw new Error("buyback_replay_provider_signature_mismatch");
  }
  if (executeResponse.ok && executed.status === "Success") {
    const confirmation = await connection.confirmTransaction({
      signature: stage.signature, blockhash: replay.blockhash,
      lastValidBlockHeight: stage.lastValidBlockHeight,
    }, "finalized");
    if (confirmation.value.err) throw new Error("buyback_replay_swap_failed");
  }
  // The provider may return an already-submitted error after a crash. Only
  // independent finalized-chain proof can advance to the burn either way.
  const purchased = await finalizedBuybackSwap(stage.payload, stage.signature);
  return burnPurchasedBuybackTokens(stage.payload, stage.jobId, buybackWorkerId,
    stage.signature, purchased);
}

async function reconcileBuybackJobs() {
  if (!BUYBACK_EXECUTION_SAFE || !buybackWorkerId) {
    return { reconciled: false, pending: false };
  }
  const recovery = await api({ action: "reconcile_buyback", workerId: buybackWorkerId });
  if (!recovery || typeof recovery.reconciled !== "boolean" ||
    typeof recovery.pending !== "boolean" ||
    [recovery.swapPrepared, recovery.swapRequired, recovery.burnRequired, recovery.burnPrepared]
      .filter(Boolean).length > 1) {
    throw new Error("buyback_recovery_response_invalid");
  }
  if (recovery.reconciled) return { reconciled: true, pending: recovery.pending };
  if (recovery.swapRequired) {
    const stage = recovery.swapRequired;
    if (!recovery.pending || typeof stage.jobId !== "string" ||
      !stage.payload || typeof stage.payload !== "object" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(stage.replacesSwapSignature ?? "")) {
      throw new Error("buyback_recovery_new_swap_stage_invalid");
    }
    await assertPublishedTreasuries();
    const result = await buyAndBurn(stage.payload, async () => {}, stage.jobId,
      buybackWorkerId, stage.payload.stepId, stage.replacesSwapSignature);
    await api({ action: "complete", jobId: stage.jobId,
      workerId: buybackWorkerId, ...result });
    return { reconciled: true, pending: true };
  }
  if (recovery.swapPrepared) {
    if (!recovery.pending || !recovery.swapPrepared.payload ||
      typeof recovery.swapPrepared.signature !== "string") {
      throw new Error("buyback_recovery_swap_stage_invalid");
    }
    await assertPublishedTreasuries();
    const result = await replayPreparedBuybackSwap(recovery.swapPrepared);
    await api({ action: "complete", jobId: recovery.swapPrepared.jobId,
      workerId: buybackWorkerId, ...result });
    return { reconciled: true, pending: true };
  }
  const stage = recovery.burnRequired ?? recovery.burnPrepared;
  if (!stage) return { reconciled: false, pending: recovery.pending };
  if (!recovery.pending || typeof stage.jobId !== "string" ||
    !stage.payload || typeof stage.payload !== "object" ||
    typeof stage.sourceTxHash !== "string" ||
    !/^[1-9][0-9]*$/.test(stage.purchasedAmountAtomic ?? "") ||
    (stage.replacesBurnSignature &&
      !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(stage.replacesBurnSignature))) {
    throw new Error("buyback_recovery_stage_invalid");
  }
  await assertPublishedTreasuries();
  const purchased = await finalizedBuybackSwap(stage.payload, stage.sourceTxHash);
  if (purchased.toString() !== stage.purchasedAmountAtomic) {
    throw new Error("buyback_recovery_swap_amount_mismatch");
  }
  const result = recovery.burnRequired
    ? await burnPurchasedBuybackTokens(stage.payload, stage.jobId, buybackWorkerId,
      stage.sourceTxHash, purchased, stage.replacesBurnSignature)
    : await finalizePreparedBuybackBurn(stage.payload, stage.sourceTxHash,
      purchased, stage);
  await api({ action: "complete", jobId: stage.jobId, workerId: buybackWorkerId, ...result });
  return { reconciled: true, pending: true };
}

async function buyAndBurn(payload, arm, jobId, workerId, entityId,
  replacesSwapSignature) {
  if (!BUYBACK_EXECUTION_SAFE) throw new Error("buyback_execution_disabled_pending_durable_recovery");
  if (!buyback) throw new Error("buyback_signer_not_configured");
  validateBuybackChunkPayload(payload, entityId);
  const mint = new PublicKey(payload.sportpadMint);
  const tokenProgram = await tokenProgramForMint(mint);
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
  const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString("base64");
  const prepared = await api({
    action: "prepare_buyback_swap",
    jobId,
    workerId,
    providerRequestId: quote.requestId,
    unsignedTransactionBase64: quote.transaction,
    signedTransactionBase64,
    inputAmountLamports: payload.amountLamports,
    outputMint: mint.toBase58(),
    minimumOutputAtomic: inspection.minOutput.toString(),
    lastValidBlockHeight: quote.lastValidBlockHeight,
    ...(replacesSwapSignature ? { replacesSwapSignature } : {}),
  });
  if (!prepared.prepared || prepared.txSignature !== expectedSignature) {
    throw new Error("buyback_order_intent_not_persisted");
  }
  const executeResponse = await fetch(EXECUTE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": jupiterKey },
    body: JSON.stringify({ signedTransaction: signedTransactionBase64, requestId: quote.requestId, lastValidBlockHeight: quote.lastValidBlockHeight }),
    signal: AbortSignal.timeout(45_000),
  });
  const executed = await executeResponse.json().catch(() => ({}));
  if (!executeResponse.ok || executed.status !== "Success" || !executed.signature) throw new Error("sportpad_swap_failed");
  if (executed.signature !== expectedSignature) throw new Error("sportpad_swap_signature_mismatch");
  const swapConfirmation = await connection.confirmTransaction({
    signature: executed.signature,
    blockhash: inspection.transaction.message.recentBlockhash,
    lastValidBlockHeight: quote.lastValidBlockHeight,
  }, "finalized");
  if (swapConfirmation.value.err) throw new Error("sportpad_swap_not_finalized");
  const receipt = await connection.getTransaction(executed.signature, {
    commitment: "finalized", maxSupportedTransactionVersion: 0,
  });
  const { purchased } = inspectBuybackSettlement(receipt, inspection);
  return burnPurchasedBuybackTokens(payload, jobId, workerId, executed.signature, purchased);
}

async function buyRewards(payload, arm, jobId, workerId, entityId,
  replacesSwapSignature) {
  if (!REWARD_PURCHASE_EXECUTION_SAFE) throw new Error("reward_purchase_execution_disabled_pending_funded_canary");
  if (!rewards) throw new Error("reward_signer_not_configured");
  const canonicalPositive = /^[1-9][0-9]*$/;
  const canonicalNonnegative = /^(0|[1-9][0-9]*)$/;
  const isBatch = payload.batchId === entityId && typeof payload.batchId === "string";
  if (!canonicalPositive.test(payload.rewardAmountLamports ?? "") ||
    (isBatch ? payload.stepId !== undefined :
      payload.stepId !== entityId || !canonicalPositive.test(payload.rewardTotalLamports ?? "") ||
      !canonicalNonnegative.test(payload.chunkOffsetAtomic ?? ""))) {
    throw new Error("reward_chunk_payload_invalid");
  }
  const amount = BigInt(payload.rewardAmountLamports);
  if (isBatch) {
    if (amount < 1_000_000n || amount > 100_000_000n) throw new Error("reward_batch_amount_mismatch");
  } else {
    const total = BigInt(payload.rewardTotalLamports);
    const offset = BigInt(payload.chunkOffsetAtomic);
    if (total > 9_223_372_036_854_775_807n || offset >= total ||
      amount !== (total - offset > 100_000_000n ? 100_000_000n : total - offset)) {
      throw new Error("reward_chunk_amount_mismatch");
    }
  }
  const mint = new PublicKey(payload.rewardMint);
  const tokenProgram = await tokenProgramForMint(mint);
  // A route failure for dust must happen while the job is still leased, so
  // the queued batch can absorb later fee shares instead of being frozen.
  if (!isBatch) await arm();
  // A separate confirmed ATA creation is required so the swap receipt has a
  // pre-balance. It must never be mistaken for the swap's reward inventory.
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, rewards, mint, rewards.publicKey, false, "confirmed", undefined, tokenProgram,
  );
  const order = new URL(ORDER_URL);
  order.searchParams.set("inputMint", SOL);
  order.searchParams.set("outputMint", mint.toBase58());
  order.searchParams.set("amount", payload.rewardAmountLamports);
  order.searchParams.set("taker", rewards.publicKey.toBase58());
  order.searchParams.set("slippageBps", "100");
  order.searchParams.set("excludeRouters", "jupiterz,dflow,okx");
  const orderResponse = await fetch(order, {
    headers: { Accept: "application/json", "x-api-key": jupiterKey },
    signal: AbortSignal.timeout(15_000),
  });
  const quote = await orderResponse.json().catch(() => ({}));
  if (!orderResponse.ok || !quote.transaction) throw new Error("reward_jupiter_route_unavailable");
  const inspection = await inspectBuybackOrder({
    connection, quote, signer: rewards.publicKey, mint, tokenProgram,
    amountLamports: payload.rewardAmountLamports,
  });
  if (!inspection.outputAta.equals(tokenAccount.address)) throw new Error("reward_output_ata_mismatch");
  if (isBatch) await arm();
  const transaction = inspection.transaction;
  transaction.sign([rewards]);
  const expectedSignature = bs58.encode(transaction.signatures[0]);
  const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString("base64");
  const prepared = await api({
    action: "prepare_reward_swap", jobId, workerId,
    providerRequestId: quote.requestId,
    unsignedTransactionBase64: quote.transaction,
    signedTransactionBase64,
    inputAmountLamports: payload.rewardAmountLamports,
    outputMint: mint.toBase58(),
    minimumOutputAtomic: inspection.minOutput.toString(),
    lastValidBlockHeight: quote.lastValidBlockHeight,
    ...(replacesSwapSignature ? { replacesSwapSignature } : {}),
  });
  if (!prepared.prepared || prepared.txSignature !== expectedSignature) {
    throw new Error("reward_order_intent_not_persisted");
  }
  const executeResponse = await fetch(EXECUTE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": jupiterKey },
    body: JSON.stringify({ signedTransaction: signedTransactionBase64,
      requestId: quote.requestId, lastValidBlockHeight: quote.lastValidBlockHeight }),
    signal: AbortSignal.timeout(45_000),
  });
  const executed = await executeResponse.json().catch(() => ({}));
  if (!executeResponse.ok || executed.status !== "Success" ||
    executed.signature !== expectedSignature) throw new Error("reward_swap_broadcast_unknown_or_failed");
  const receipt = await connection.getTransaction(executed.signature, {
    commitment: "confirmed", maxSupportedTransactionVersion: 0,
  });
  const { purchased } = inspectBuybackSettlement(receipt, inspection);
  return { txHash: executed.signature, outputAmountAtomic: purchased.toString() };
}

async function finalizePreparedSolanaClaim(payload, prepared) {
  if (!rewards) throw new Error("reward_signer_not_configured");
  const mint = new PublicKey(payload.tokenAddress);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "finalized", tokenProgram);
  const checked = inspectPersistedSolanaClaimTransfer({
    signedTransactionBase64: prepared.signedTransactionBase64,
    signature: prepared.signature, signer: rewards.publicKey.toBase58(),
    mint: mint.toBase58(), destinationAddress: payload.destinationAddress,
    tokenProgram: tokenProgram.toBase58(), amountAtomic: payload.amountAtomic,
    decimals: mintState.decimals,
  });
  if (!Number.isSafeInteger(prepared.lastValidBlockHeight) ||
    prepared.lastValidBlockHeight <= 0) throw new Error("solana_claim_blockheight_invalid");
  let status = (await connection.getSignatureStatuses([prepared.signature],
    { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error("solana_claim_failed_on_chain");
  if (status?.confirmationStatus !== "finalized") {
    const currentHeight = await connection.getBlockHeight("finalized");
    if (currentHeight > prepared.lastValidBlockHeight) {
      throw new Error("solana_claim_expired_without_finality");
    }
    const sent = await connection.sendRawTransaction(checked.bytes,
      { skipPreflight: false, maxRetries: 4 });
    if (sent !== prepared.signature) throw new Error("solana_claim_signature_mismatch");
    const confirmation = await connection.confirmTransaction({
      signature: prepared.signature,
      blockhash: checked.transaction.recentBlockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    }, "finalized");
    if (confirmation.value.err) throw new Error("solana_claim_not_finalized");
    status = (await connection.getSignatureStatuses([prepared.signature],
      { searchTransactionHistory: true })).value[0];
  }
  if (!status || status.err !== null || status.confirmationStatus !== "finalized") {
    throw new Error("solana_claim_finality_unverified");
  }
  return { txHash: prepared.signature };
}

async function paySolanaClaim(payload, arm, jobId, workerId) {
  if (!CLAIM_PAYOUT_EXECUTION_SAFE) throw new Error("claim_payout_execution_disabled_pending_recovery_canary");
  if (!rewards) throw new Error("reward_signer_not_configured");
  const mint = new PublicKey(payload.tokenAddress);
  const destination = new PublicKey(payload.destinationAddress);
  const tokenProgram = await tokenProgramForMint(mint);
  const mintState = await getMint(connection, mint, "finalized", tokenProgram);
  const source = await getAssociatedTokenAddress(mint, rewards.publicKey, false, tokenProgram);
  const amount = BigInt(payload.amountAtomic);
  const sourceBalance = BigInt((await connection.getTokenAccountBalance(source, "confirmed")).value.amount);
  if (sourceBalance < amount) throw new Error("reward_inventory_underfunded");
  await arm();
  const destinationAccount = await getOrCreateAssociatedTokenAccount(
    connection, rewards, mint, destination, false, "confirmed", undefined, tokenProgram,
  );
  const latest = await connection.getLatestBlockhash("confirmed");
  const signed = signSolanaClaimTransfer({ signer: rewards, mint,
    destinationAddress: destination, tokenProgram, amountAtomic: amount,
    decimals: mintState.decimals, blockhash: latest.blockhash });
  if (!signed.source.equals(source) || !signed.destination.equals(destinationAccount.address)) {
    throw new Error("solana_claim_token_account_mismatch");
  }
  const intent = await api({ action: "prepare_solana_claim_payout", jobId, workerId,
    signedTransactionBase64: signed.base64, tokenAddress: mint.toBase58(),
    destinationAddress: destination.toBase58(), amountAtomic: amount.toString(),
    lastValidBlockHeight: latest.lastValidBlockHeight });
  if (!intent.prepared || intent.txSignature !== signed.signature) {
    throw new Error("solana_claim_intent_not_persisted");
  }
  return finalizePreparedSolanaClaim(payload, { signature: signed.signature,
    signedTransactionBase64: signed.base64,
    lastValidBlockHeight: latest.lastValidBlockHeight });
}

async function reconcileSolanaClaims() {
  if (!CLAIM_PAYOUT_EXECUTION_SAFE || !rewardWorkerId) {
    return { reconciled: false, pending: false };
  }
  const recovery = await api({ action: "reconcile_claim", workerId: rewardWorkerId });
  if (!recovery || typeof recovery.reconciled !== "boolean" ||
    typeof recovery.pending !== "boolean") throw new Error("solana_claim_recovery_response_invalid");
  if (recovery.reconciled) return { reconciled: true, pending: recovery.pending };
  if (!recovery.prepared) return { reconciled: false, pending: recovery.pending };
  const prepared = recovery.prepared;
  if (!recovery.pending || typeof prepared.jobId !== "string" ||
    !prepared.payload || typeof prepared.payload !== "object") {
    throw new Error("solana_claim_recovery_stage_invalid");
  }
  await assertPublishedTreasuries();
  const result = await finalizePreparedSolanaClaim(prepared.payload, prepared);
  await api({ action: "complete", jobId: prepared.jobId, workerId: rewardWorkerId, ...result });
  return { reconciled: true, pending: true };
}

function errorCode(error) {
  const text = error instanceof Error ? error.message : "unknown";
  return text.toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 100) || "worker_failed";
}
function retryable(error) {
  const code = errorCode(error);
  return !code.includes("constraint_changed") && !code.includes("mismatch") && !code.includes("invalid");
}

async function replayPreparedRewardSwap(prepared) {
  if (!rewards) throw new Error("reward_replay_signer_missing");
  // The generic signed-order verifier reproduces only the original Jupiter
  // message and signature. No new quote or extra spend is permitted here.
  const checked = signPersistedBuybackSwap({
    unsignedTransactionBase64: prepared.unsignedTransactionBase64,
    signature: prepared.signature, signer: rewards,
  });
  if (await connection.getBlockHeight("finalized") > prepared.lastValidBlockHeight ||
    !(await connection.isBlockhashValid(checked.blockhash,
      { commitment: "confirmed" })).value) {
    throw new Error("reward_replay_original_blockhash_expired");
  }
  const status = (await connection.getSignatureStatuses([prepared.signature],
    { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error("reward_replay_transaction_failed");
  if (status?.confirmationStatus === "finalized") return;
  const sent = await connection.sendRawTransaction(
    Buffer.from(checked.signedTransactionBase64, "base64"),
    { skipPreflight: false, maxRetries: 4 },
  );
  if (sent !== prepared.signature) throw new Error("reward_replay_signature_mismatch");
}

async function runOnce() {
  // The API holds the signed swap intent before Jupiter sees it. Ask the
  // server to settle any finalized purchase from that durable signature on
  // every cycle, including after a worker restart or an /execute timeout.
  // Recovery may rebroadcast only the exact persisted signature while its
  // original blockhash is live. Finalization remains server-verified.
  const recovery = await reconcileRewardPurchases(api, rewardWorkerId,
    REWARD_PURCHASE_EXECUTION_SAFE, replayPreparedRewardSwap, async (stage) => {
      await assertPublishedTreasuries();
      const result = await buyRewards(stage.payload, async () => {}, stage.jobId,
        rewardWorkerId, stage.entityId, stage.replacesSwapSignature);
      await api({ action: "complete", jobId: stage.jobId,
        workerId: rewardWorkerId, ...result });
    });
  if (recovery.reconciled) return true;
  const claimRecovery = await reconcileSolanaClaims();
  if (claimRecovery.reconciled) return true;
  const buybackRecovery = await reconcileBuybackJobs();
  if (buybackRecovery.reconciled) return true;
  const lanes = [];
  if (rewardWorkerId) {
    const jobTypes = rewardWorkerJobTypes(REWARD_PURCHASE_EXECUTION_SAFE, recovery)
      .filter((jobType) => jobType !== "solana_claim_payout" ||
        (CLAIM_PAYOUT_EXECUTION_SAFE && !claimRecovery.pending));
    if (jobTypes.length) lanes.push({ workerId: rewardWorkerId, jobTypes });
  }
  if (buybackWorkerId && BUYBACK_EXECUTION_SAFE && !buybackRecovery.pending) lanes.push({ workerId: buybackWorkerId,
    jobTypes: ["sportpad_buyback_burn"] });
  for (const lane of lanes) {
    const { workerId, jobTypes } = lane;
    const { job } = await api({ action: "lease", workerId, jobTypes });
    if (!job) continue;
    try {
      await assertPublishedTreasuries();
      const arm = async () => { await api({ action: "arm", jobId: job.id, workerId }); };
      const result = job.type === "sportpad_buyback_burn"
        ? await buyAndBurn(job.payload, arm, job.id, workerId, job.entityId)
        : job.type === "solana_reward_purchase"
          ? await buyRewards(job.payload, arm, job.id, workerId, job.entityId)
          : await paySolanaClaim(job.payload, arm, job.id, workerId);
      await api({ action: "complete", jobId: job.id, workerId, ...result });
    } catch (error) {
      await api({ action: "fail", jobId: job.id, workerId,
        errorCode: errorCode(error), retryable: retryable(error) });
    }
    return true;
  }
  return false;
}

await assertPublishedTreasuries();
for (;;) {
  const worked = await runOnce().catch((error) => {
    process.stderr.write(`${new Date().toISOString()} ${errorCode(error)}\n`);
    return false;
  });
  if (!worked) await new Promise((resolve) => setTimeout(resolve, 5_000));
}
