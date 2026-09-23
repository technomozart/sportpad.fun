import { env } from "cloudflare:workers";
import { getAssociatedTokenAddressSync, getMint, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createPublicClient, http, parseAbi } from "viem";
import { z } from "zod";

import { allocateEpochRewards } from "@/lib/protocol/accounting";
import { CHILIZ_CHAIN, getChilizRewardAsset } from "@/lib/protocol/chiliz-reward-assets";
import { CHILIZ_ASSET_MIGRATION_VERIFIED, verifyChilizPurchaseReceipt,
  verifyChilizTransferReceipt } from "@/lib/protocol/chiliz-receipts";
import { createChilizSignedIntent, reconcileChilizSignedIntent,
  verifyChilizPurchasePrincipal,
  type ChilizSignedIntent } from "@/lib/protocol/chiliz-signed-intent";
import { ASSERT_ONE_ROW_CHANGED_SQL, COMPLETE_BROADCAST_JOB_SQL, COMPLETE_CLAIM_SQL,
  COMPLETE_CLAIM_VAULT_SQL, COMPLETE_PURCHASE_SETTLEMENT_SQL, COMPLETE_PURCHASE_VAULT_SQL,
  COMPLETE_RECONCILED_JOB_SQL,
  COMPLETE_SOLANA_PURCHASE_VAULT_SQL,
  DEFER_CHILIZ_EPOCH_SQL, ELIGIBLE_COMMUNITY_BUYBACK_SETTLEMENTS_SQL,
  failureDisposition, FENCE_CHILIZ_EPOCH_SQL,
  FINANCIAL_LEDGER_VERIFIED, HOLD_BROADCAST_RECEIPT_SQL, laneAllowsJob,
  ownsActiveLease, ownsBroadcast, pauseConditionSql,
  REQUEUE_UNPREPARED_REWARD_JOB_SQL,
  type AutomationLaneControls } from "@/lib/protocol/automation-safety";
import { canonicalRewardAllocation } from "@/lib/protocol/holder-rewards";
import { COMPLETE_FINALIZED_HOLDER_SNAPSHOT_SQL } from "@/lib/protocol/holder-indexer-sql";
import { getRewardOption } from "@/lib/protocol/reward-options";
import { quoteChilizPurchaseSpendCeiling } from "@/lib/server/chiliz-spend-bound";
import { verifyChilizDualRpcFinality } from "@/lib/server/chiliz-finality";
import { CHILIZ_FIRST_LEASE_ELIGIBLE_SQL,
  REQUEUE_UNPREPARED_CHILIZ_FIRST_LEASE_SQL } from "@/lib/server/chiliz-first-lease-recovery";
import { FINALIZE_CHILIZ_INTENT_SQL, FINALIZE_REVERTED_CHILIZ_JOB_SQL,
  INSERT_CHILIZ_SIGNED_INTENT_SQL,
  MARK_CHILIZ_INTENT_BROADCAST_SQL,
  REQUEUE_UNPREPARED_CHILIZ_JOB_SQL,
  REQUEUE_STALE_UNPREPARED_CHILIZ_BROADCAST_SQL,
  RESERVE_CHILIZ_INTENT_POLICY_SQL,
  SELECT_CHILIZ_SIGNED_INTENT_SQL, chilizSignedIntentInsertBindings,
  parsePersistedChilizSignedIntent, type PersistedChilizIntentRow } from "@/lib/server/chiliz-intent-sql";
import { DEFAULT_PROTOCOL_CONTROLS, readExecutionConfig, readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { observedSolanaRewardPurchaseOutput, verifySolanaClaimPayoutReceipt,
  verifySolanaRewardPurchaseReceipt,
  verifySportpadBuybackReceipts } from "@/lib/server/solana/automation-receipt";
import { inspectPersistedPreparedBuybackSwap, inspectPersistedPreparedRewardSwap,
  inspectPreparedAutomaticBuybackOrder,
  verifyPersistedAutomaticBuybackChunkIntent,
  verifyPersistedAutomaticRewardBatchIntent, verifyPersistedAutomaticRewardChunkIntent,
  type PersistedAutomaticBuybackIntent } from "@/lib/server/solana/buyback-intent-proof";
import { inspectPreparedAutomaticClaimPayout, verifyPersistedAutomaticClaimIntent,
  type PersistedAutomaticClaimIntent } from "@/lib/server/solana/claim-intent-proof";
import { captureClaimHistoryAnchor, proveExpiredClaimTransferAbsent } from
  "@/lib/server/solana/claim-expiry-proof";
import { ARCHIVE_PROVEN_ABSENT_CLAIM_INTENT_SQL,
  COMPLETE_AUTOMATIC_CLAIM_INTENT_SQL, INSERT_AUTOMATIC_CLAIM_INTENT_SQL,
  REQUEUE_PROVEN_ABSENT_CLAIM_JOB_SQL, REQUEUE_UNPREPARED_CLAIM_JOB_SQL } from
  "@/lib/server/solana/claim-intent-sql";
import { inspectPreparedAutomaticBuybackBurn, verifyPersistedAutomaticBuybackBurnIntent,
  type PersistedAutomaticBurnIntent } from "@/lib/server/solana/buyback-burn-intent-proof";
import { proveExpiredBuybackBurnAbsent } from "@/lib/server/solana/buyback-expiry-proof";
import { proveExpiredSwapAbsent } from "@/lib/server/solana/swap-expiry-proof";
import { ARCHIVE_EXPIRED_SWAP_INTENT_SQL } from "@/lib/server/solana/swap-replacement-sql";
import { ARCHIVE_FINALIZED_FAILED_REWARD_BATCH_INTENT_SQL,
  REARM_PROVEN_FAILED_REWARD_BATCH_JOB_SQL } from
  "@/lib/server/solana/reward-batch-failure-sql";
import { COMPLETE_AUTOMATIC_BUYBACK_BURN_INTENT_SQL } from "@/lib/server/solana/buyback-burn-intent-sql";
import { ADVANCE_AUTOMATIC_BUYBACK_SETTLEMENT_SQL, automaticBuybackChunkKey,
  ARCHIVE_EXPIRED_BUYBACK_CHUNK_BURN_INTENT_SQL,
  COMPLETE_AUTOMATIC_BUYBACK_CHUNK_SQL, CONFIRM_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL, INSERT_AUTOMATIC_BUYBACK_CHUNK_JOB_SQL,
  INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL, INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL,
  planAutomaticBuybackChunk, RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL } from "@/lib/server/solana/buyback-chunk-sql";
import { readSolanaRewardVaultSolvency } from "@/lib/server/solana/vault-solvency";
import { readSolanaVaultFence, UPDATE_SOLANA_VAULT_FENCE_SQL } from "@/lib/server/solana/vault-fence";
import { ADVANCE_AUTOMATIC_REWARD_SETTLEMENT_SQL, automaticRewardChunkKey,
  COMPLETE_AUTOMATIC_REWARD_CHUNK_SQL, INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL,
  planAutomaticRewardChunk } from "@/lib/server/solana/reward-chunk-sql";
import { ADVANCE_REWARD_BATCH_SETTLEMENTS_SQL, ADVANCE_REWARD_BATCH_TOTAL_SQL,
  ARM_REWARD_BATCH_SQL, ASSERT_REWARD_BATCH_SETTLEMENTS_ADVANCED_SQL,
  ASSERT_REWARD_BATCH_SOURCES_VERIFIED_SQL, COMPLETE_REWARD_BATCH_SQL,
  INSERT_REWARD_BATCH_INTENT_SQL, INSERT_REWARD_BATCH_SOURCE_SQL,
  INSERT_REWARD_BATCH_SQL, MARK_REWARD_BATCH_QUEUED_SQL,
  planRewardBatchSource, QUEUE_REWARD_BATCH_JOB_SQL, rewardBatchIntentKey,
  UPDATE_QUEUED_REWARD_BATCH_PAYLOAD_SQL, VERIFY_REWARD_BATCH_SOURCES_SQL,
} from "@/lib/server/solana/reward-batch-sql";
import { getMainnetConnection } from "@/lib/server/solana/devnet";
import { proveFinalizedFailedRewardSwap } from "@/lib/server/solana/reward-swap-failure-proof";
import { secureTokenEqual, workerUnauthorized } from "@/lib/server/workers/auth";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("lease"),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    jobTypes: z.array(z.enum(["chiliz_reward_purchase", "chiliz_claim_unwrap", "solana_reward_purchase", "solana_claim_payout", "sportpad_buyback_burn"])).min(1).max(5),
  }).strict(),
  z.object({
    action: z.literal("reconcile"),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }).strict(),
  z.object({
    action: z.literal("reconcile_claim"),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }).strict(),
  z.object({
    action: z.literal("reconcile_buyback"),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }).strict(),
  z.object({
    action: z.literal("reconcile_chiliz_intent"),
    workerId: z.string().regex(/^chiliz:0x[0-9a-fA-F]{40}$/),
  }).strict(),
  z.object({
    action: z.literal("arm"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
  }).strict(),
  z.object({
    action: z.literal("prepare_chiliz_intent"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^chiliz:0x[0-9a-fA-F]{40}$/),
    kind: z.enum(["purchase", "claim"]),
    attempt: z.literal(1),
    treasury: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    rawTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/).max(10_000),
    gasFeeCeilingWei: z.string().regex(/^[1-9][0-9]*$/).max(40),
    fanTokenContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    maxPrincipalWei: z.string().regex(/^[1-9][0-9]*$/).max(40).optional(),
    minimumOutputAtomic: z.string().regex(/^[1-9][0-9]*$/).max(78).optional(),
    deadlineEpochSeconds: z.number().int().positive().safe().optional(),
    signedAtEpochSeconds: z.number().int().positive().safe().optional(),
    destination: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/).max(78).optional(),
  }).strict(),
  z.object({
    action: z.literal("mark_chiliz_broadcast"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^chiliz:0x[0-9a-fA-F]{40}$/),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }).strict(),
  z.object({
    action: z.literal("prepare_buyback_swap"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    providerRequestId: z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/),
    unsignedTransactionBase64: z.string().min(1).max(20_000),
    signedTransactionBase64: z.string().min(1).max(20_000),
    inputAmountLamports: z.string().regex(/^[1-9][0-9]{0,19}$/),
    outputMint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    minimumOutputAtomic: z.string().regex(/^[1-9][0-9]{0,19}$/),
    lastValidBlockHeight: z.number().int().positive().safe(),
    replacesSwapSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/).optional(),
  }).strict(),
  z.object({
    action: z.literal("prepare_reward_swap"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    providerRequestId: z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/),
    unsignedTransactionBase64: z.string().min(1).max(20_000),
    signedTransactionBase64: z.string().min(1).max(20_000),
    inputAmountLamports: z.string().regex(/^[1-9][0-9]{0,19}$/),
    outputMint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    minimumOutputAtomic: z.string().regex(/^[1-9][0-9]{0,19}$/),
    lastValidBlockHeight: z.number().int().positive().safe(),
    replacesSwapSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/).optional(),
  }).strict(),
  z.object({
    action: z.literal("prepare_buyback_burn"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    sourceTxHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/),
    burnAmountAtomic: z.string().regex(/^[1-9][0-9]{0,19}$/),
    signedTransactionBase64: z.string().min(1).max(20_000),
    lastValidBlockHeight: z.number().int().positive().safe(),
    replacesBurnSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/).optional(),
  }).strict(),
  z.object({
    action: z.literal("prepare_solana_claim_payout"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    signedTransactionBase64: z.string().min(1).max(20_000),
    tokenAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    destinationAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    amountAtomic: z.string().regex(/^[1-9][0-9]{0,19}$/),
    lastValidBlockHeight: z.number().int().positive().safe(),
  }).strict(),
  z.object({
    action: z.literal("complete"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    txHash: z.string().regex(/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,96})$/),
    sourceTxHash: z.string().regex(/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,96})$/).optional(),
    outputAmountAtomic: z.string().max(78).regex(/^[1-9][0-9]*$/).optional(),
  }).strict(),
  z.object({
    action: z.literal("fail"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    errorCode: z.string().regex(/^[a-z0-9_:-]{2,100}$/),
    retryable: z.boolean(),
  }).strict(),
]);

// Each unattended payout needs a funded end-to-end canary before activation.
const CLAIM_PAYOUT_EXECUTION_SAFE = false;
const BUYBACK_BURN_EXECUTION_SAFE = false;

type AutomationRow = {
  id: string; job_type: string; entity_type: string; entity_id: string; chain: string;
  payload_json: string; state: string; attempt: number; leased_until: number | null; error_code: string | null;
  tx_hash: string | null;
};

async function authorize(request: Request) {
  const configured = readWorkerToken();
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(configured && supplied && await secureTokenEqual(configured, supplied));
}

async function readAutomationControls(database: D1Database): Promise<AutomationLaneControls> {
  const row = await database.prepare(`
    SELECT settlement_paused, rewards_paused, buyback_paused
    FROM protocol_controls WHERE key = 'global' LIMIT 1
  `).first<{ settlement_paused: number; rewards_paused: number; buyback_paused: number }>();
  const controls = row ? {
    ...DEFAULT_PROTOCOL_CONTROLS,
    settlementPaused: Boolean(row.settlement_paused),
    rewardsPaused: Boolean(row.rewards_paused),
    buybackPaused: Boolean(row.buyback_paused),
  } : DEFAULT_PROTOCOL_CONTROLS;
  const execution = readExecutionConfig(controls);
  return {
    mainnetEnabled: execution.mainnet.enabled,
    settlementEnabled: execution.flags.settlementEnabled,
    rewardsEnabled: execution.flags.rewardsEnabled,
    claimsEnabled: execution.flags.claimsEnabled,
    buybackEnabled: execution.flags.buybackEnabled,
    settlementPaused: controls.settlementPaused,
    rewardsPaused: controls.rewardsPaused,
    buybackPaused: controls.buybackPaused,
  };
}

async function seedPurchaseJobs(database: D1Database) {
  const rows = await database.prepare(`
    SELECT s.id AS settlement_id, s.reward_amount_atomic, f.launch_id,
      l.reward_symbol, l.reward_mint
    FROM settlements s
    JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    WHERE l.reward_chain = 'chiliz' AND l.reward_mint IS NOT NULL AND l.reward_wrapped_contract IS NULL
      AND s.reward_swap_signature IS NULL AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    ORDER BY s.created_at ASC LIMIT 25
  `).all<{
    settlement_id: string; reward_amount_atomic: string; launch_id: string;
    reward_symbol: string; reward_mint: string;
  }>();
  const eligible = rows.results.filter((row) => {
    const asset = getChilizRewardAsset(row.reward_symbol);
    return asset?.routeStatus === "current_verified" &&
      asset.currentV2Contract.toLowerCase() === row.reward_mint.toLowerCase();
  });
  if (!eligible.length) return;
  const now = Date.now();
  await database.batch(eligible.map((row) => database.prepare(`
    INSERT OR IGNORE INTO automation_jobs
      (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
    VALUES (?1, 'chiliz_reward_purchase', 'settlement', ?2, 'chiliz', ?3, 'queued', ?4)
  `).bind(crypto.randomUUID(), row.settlement_id, JSON.stringify({
    settlementId: row.settlement_id,
    launchId: row.launch_id,
    rewardAmountLamports: row.reward_amount_atomic,
    rewardSymbol: row.reward_symbol,
    fanTokenContract: row.reward_mint,
  }), now)));
}

async function seedSolanaPurchaseJobs(database: D1Database) {
  const config = readMainnetConfig();
  const setting = await database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
    .first<{ value: string }>();
  if (!config.rewardTreasury ||
    (config.sportpadMint && setting?.value && config.sportpadMint !== setting.value)) return;
  const platformMint = setting?.value ?? config.sportpadMint ?? null;
  const rows = await database.prepare(`
    SELECT s.id AS settlement_id, s.reward_amount_atomic, s.reward_spent_atomic, f.launch_id,
      l.reward_symbol, l.reward_mint
    FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    WHERE l.reward_chain = 'solana' AND l.reward_mint IS NOT NULL
      AND l.mainnet_mint IS NOT NULL AND (?1 IS NULL OR l.mainnet_mint <> ?1)
      AND l.mainnet_reward_treasury = ?2
      AND l.status = 'mainnet_published'
      AND s.reward_swap_signature IS NULL
      AND s.reward_spent_atomic <> s.reward_amount_atomic
      AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
      AND NOT EXISTS (SELECT 1 FROM settlement_steps step
        WHERE step.settlement_id = s.id AND step.stage = 'automatic_reward_chunk'
          AND step.state <> 'verified')
      AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src
        WHERE src.settlement_id = s.id AND src.state = 'reserved')
      AND NOT EXISTS (SELECT 1 FROM automation_jobs old_job
        WHERE old_job.entity_id = s.id AND old_job.entity_type = 'settlement'
          AND old_job.job_type = 'solana_reward_purchase')
    ORDER BY s.created_at ASC LIMIT 100
  `).bind(platformMint, config.rewardTreasury).all<{
    settlement_id: string; reward_amount_atomic: string; reward_spent_atomic: string; launch_id: string;
    reward_symbol: string; reward_mint: string;
  }>();
  const eligible = rows.results.filter((row) => {
    const asset = getRewardOption("solana", row.reward_symbol);
    return asset?.tokenAddress === row.reward_mint;
  });
  const now = Date.now();
  for (const row of eligible) {
    let batch = await database.prepare(`
      SELECT id, input_amount_atomic, state FROM reward_swap_batches
      WHERE launch_id = ?1 AND state IN ('collecting', 'queued') LIMIT 1
    `).bind(row.launch_id).first<{ id: string; input_amount_atomic: string; state: string }>();
    if (!batch) {
      const id = crypto.randomUUID();
      try {
        await database.batch([
          database.prepare(INSERT_REWARD_BATCH_SQL).bind(id, row.launch_id,
            row.reward_mint, config.rewardTreasury, config.sportpadMint ?? null),
          database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        if (!message.includes("sportpad_cas_conflict") && !message.includes("UNIQUE constraint failed")) throw error;
      }
      batch = await database.prepare(`
        SELECT id, input_amount_atomic, state FROM reward_swap_batches
        WHERE launch_id = ?1 AND state IN ('collecting', 'queued') LIMIT 1
      `).bind(row.launch_id).first<{ id: string; input_amount_atomic: string; state: string }>();
    }
    if (!batch) continue;
    let source;
    try { source = planRewardBatchSource(row.reward_amount_atomic,
      row.reward_spent_atomic, batch.input_amount_atomic); }
    catch { continue; }
    if (!source) continue;
    try {
      const statements: D1PreparedStatement[] = [
        database.prepare(INSERT_REWARD_BATCH_SOURCE_SQL).bind(batch.id,
          row.settlement_id, source.offsetAtomic, source.inputAmountLamports,
          source.totalAtomic, batch.input_amount_atomic, config.sportpadMint ?? null),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        database.prepare(ADVANCE_REWARD_BATCH_TOTAL_SQL).bind(batch.id,
          batch.input_amount_atomic, source.nextBatchAtomic),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      ];
      if (batch.state === "queued") statements.push(
        database.prepare(UPDATE_QUEUED_REWARD_BATCH_PAYLOAD_SQL).bind(batch.id,
          batch.input_amount_atomic, source.nextBatchAtomic),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      );
      await database.batch(statements);
    } catch (error) {
      // A concurrent seeder or worker may have changed this open batch.
      const message = error instanceof Error ? error.message : "unknown";
      if (!message.includes("sportpad_cas_conflict") && !message.includes("UNIQUE constraint failed")) throw error;
    }
  }
  const ready = await database.prepare(`
    SELECT b.id, b.launch_id, b.reward_mint, b.input_amount_atomic,
      l.reward_symbol FROM reward_swap_batches b
    JOIN launch_drafts l ON l.id = b.launch_id
    WHERE b.state = 'collecting' AND CAST(b.input_amount_atomic AS INTEGER) >= 1000000
    ORDER BY b.created_at ASC LIMIT 25
  `).all<{ id: string; launch_id: string; reward_mint: string;
    input_amount_atomic: string; reward_symbol: string }>();
  for (const batch of ready.results) {
    if (getRewardOption("solana", batch.reward_symbol)?.tokenAddress !== batch.reward_mint) continue;
    const payload = JSON.stringify({ batchId: batch.id, launchId: batch.launch_id,
      rewardMint: batch.reward_mint, rewardSymbol: batch.reward_symbol,
      rewardAmountLamports: batch.input_amount_atomic });
    try {
      await database.batch([
        database.prepare(QUEUE_REWARD_BATCH_JOB_SQL).bind(
          crypto.randomUUID(), batch.id, payload, now),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        database.prepare(MARK_REWARD_BATCH_QUEUED_SQL).bind(batch.id),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (!message.includes("sportpad_cas_conflict") && !message.includes("UNIQUE constraint failed")) throw error;
    }
  }
}

async function seedBuybackJobs(database: D1Database) {
  const setting = await database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
    .first<{ value: string }>();
  if (!setting?.value) return;
  const rows = await database.prepare(ELIGIBLE_COMMUNITY_BUYBACK_SETTLEMENTS_SQL)
    .bind(setting.value).all<{ settlement_id: string; buyback_amount_atomic: string;
      buyback_spent_atomic: string; launch_id: string }>();
  if (!rows.results.length) return;
  const now = Date.now();
  const config = readMainnetConfig();
  if (!config.buybackTreasury || (config.sportpadMint && config.sportpadMint !== setting.value)) return;
  for (const row of rows.results) {
    let chunk;
    try { chunk = planAutomaticBuybackChunk(row.buyback_amount_atomic, row.buyback_spent_atomic); }
    catch { continue; }
    if (!chunk) continue;
    const stepId = crypto.randomUUID();
    const payload = JSON.stringify({
      settlementId: row.settlement_id, stepId, launchId: row.launch_id,
      amountLamports: chunk.inputAmountLamports,
      buybackTotalLamports: row.buyback_amount_atomic,
      chunkOffsetAtomic: chunk.offsetAtomic,
      sportpadMint: setting.value,
    });
    try {
      await database.batch([
        database.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL).bind(
          stepId, automaticBuybackChunkKey(row.settlement_id, chunk.offsetAtomic),
          chunk.inputAmountLamports, row.settlement_id, chunk.offsetAtomic,
          row.buyback_amount_atomic, config.buybackTreasury, setting.value),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        database.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_JOB_SQL).bind(
          crypto.randomUUID(), stepId, payload, now),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (!message.includes("sportpad_cas_conflict") && !message.includes("UNIQUE constraint failed")) throw error;
    }
  }
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function closeMatureRewardEpoch(database: D1Database, chain: "chiliz" | "solana",
  launchId: string | null = null) {
  const epoch = await database.prepare(`
    SELECT e.id, e.launch_id, e.funded_amount_atomic, e.reward_decimals,
      e.state, l.reward_mint
    FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
    WHERE e.state IN ('accruing', 'allocating') AND datetime(e.ends_at) <= CURRENT_TIMESTAMP
      AND l.status = 'mainnet_published'
      AND l.reward_chain = ?1 AND (?1 <> 'chiliz' OR l.reward_wrapped_contract IS NULL)
      AND (?2 IS NULL OR e.launch_id = ?2)
      AND ${COMPLETE_FINALIZED_HOLDER_SNAPSHOT_SQL}
      AND (?1 <> 'solana' OR EXISTS (SELECT 1 FROM protocol_events p
        WHERE p.entity_type = 'epoch' AND p.entity_id = e.id
          AND p.event_type = 'automatic_reward_epoch_opened'))
    ORDER BY CASE WHEN e.state = 'allocating' THEN 0 ELSE 1 END, e.ends_at ASC LIMIT 1
  `).bind(chain, launchId).first<{
    id: string; launch_id: string; funded_amount_atomic: string; state: string;
    reward_mint: string; reward_decimals: number | null;
  }>();
  if (!epoch) return;
  if (epoch.reward_decimals === null || epoch.reward_decimals < 0 || epoch.reward_decimals > 18) {
    throw new Error("reward_epoch_decimals_unverified");
  }
  if (epoch.state === "accruing") {
    // Fence holder writes before reading positions. A crash leaves an
    // allocating epoch that the next lease can resume, not a half-closed one.
    const fenced = await database.prepare(FENCE_CHILIZ_EPOCH_SQL)
      .bind(epoch.id, epoch.funded_amount_atomic).run();
    if (fenced.meta.changes !== 1) return;
  }
  const positionRows = await database.prepare(`
    SELECT wallet, token_seconds_atomic, last_observed_slot FROM holder_epoch_positions
    WHERE epoch_id = ?1 AND excluded = 0 ORDER BY wallet
  `).bind(epoch.id).all<{ wallet: string; token_seconds_atomic: string; last_observed_slot: number | null }>();
  const positions = positionRows.results
    .map((row) => ({ ...row, weight: BigInt(row.token_seconds_atomic) }))
    .filter((row) => row.weight > 0n);
  const fundedAtomic = BigInt(epoch.funded_amount_atomic);
  if (!positions.length || fundedAtomic <= 0n) {
    const deferred = await database.prepare(DEFER_CHILIZ_EPOCH_SQL)
      .bind(epoch.id, epoch.funded_amount_atomic).run();
    if (deferred.meta.changes !== 1) throw new Error("epoch_defer_conflict");
    return;
  }
  const allocation = allocateEpochRewards(fundedAtomic, positions.map((row) => ({ wallet: row.wallet, tokenSeconds: row.weight })));
  const claims = allocation.allocations
    .filter((entry) => entry.rewardAtomic > 0n)
    .map((entry) => ({ wallet: entry.wallet, amount: entry.rewardAtomic }));
  if (!claims.length) {
    const deferred = await database.prepare(DEFER_CHILIZ_EPOCH_SQL)
      .bind(epoch.id, epoch.funded_amount_atomic).run();
    if (deferred.meta.changes !== 1) throw new Error("epoch_defer_conflict");
    return;
  }
  const allocatedAtomic = claims.reduce((sum, claim) => sum + claim.amount, 0n);
  const dustAtomic = fundedAtomic - allocatedAtomic;
  const cutoffSlot = positions.reduce((max, row) => Math.max(max, row.last_observed_slot ?? 0), 0);
  const allocationHash = await sha256Hex(canonicalRewardAllocation(claims.map((claim) => ({ wallet: claim.wallet, rewardAtomic: claim.amount }))));
  const vault = await database.prepare(`
    SELECT inventory_atomic, allocated_atomic, reserved_atomic FROM reward_vaults
    WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = ?3
  `).bind(epoch.launch_id, epoch.reward_mint, chain).first<{
    inventory_atomic: string; allocated_atomic: string; reserved_atomic: string;
  }>();
  if (!vault) throw new Error("reward_vault_missing");
  const nextAllocated = (BigInt(vault.allocated_atomic) + allocatedAtomic).toString();
  const nextReserved = (BigInt(vault.reserved_atomic) + allocatedAtomic).toString();
  if (BigInt(nextReserved) > BigInt(vault.inventory_atomic)) throw new Error("reward_vault_inventory_insufficient");
  const statements: D1PreparedStatement[] = [
    database.prepare(`
      UPDATE reward_epochs SET state = 'claimable', allocated_amount_atomic = ?2, dust_amount_atomic = ?3,
        reward_decimals = ?7, cutoff_slot = ?4, allocation_hash = ?5, closed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'allocating'
          AND funded_amount_atomic = ?6 AND datetime(ends_at) <= CURRENT_TIMESTAMP
          AND EXISTS (SELECT 1 FROM launch_drafts l WHERE l.id = reward_epochs.launch_id
            AND l.status = 'mainnet_published')
          AND EXISTS (SELECT 1 FROM holder_snapshot_checkpoints c WHERE c.epoch_id = reward_epochs.id
            AND c.first_finalized_at IS NOT NULL
            AND c.first_finalized_at <= CAST(strftime('%s', reward_epochs.starts_at) AS INTEGER)
            AND c.last_observed_at >= CAST(strftime('%s', reward_epochs.ends_at) AS INTEGER))
    `).bind(epoch.id, allocatedAtomic.toString(), dustAtomic.toString(), cutoffSlot,
      allocationHash, epoch.funded_amount_atomic, epoch.reward_decimals),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    ...claims.flatMap((claim) => [
      database.prepare(`
        INSERT OR IGNORE INTO reward_claims (id, epoch_id, solana_wallet, amount_atomic, destination_chain, state)
        VALUES (?1, ?2, ?3, ?4, ?5, 'claimable')
      `).bind(crypto.randomUUID(), epoch.id, claim.wallet, claim.amount.toString(), chain),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    ]),
    database.prepare(`
      INSERT OR IGNORE INTO protocol_events
        (id, category, entity_type, entity_id, event_type, idempotency_key, state, slot, amount_atomic, mint, evidence_hash)
      VALUES (?1, 'rewards', 'epoch', ?2, ?7, ?1, 'verified', ?3, ?4, ?5, ?6)
    `).bind(`${chain}-allocation:${epoch.id}`, epoch.id, cutoffSlot,
      allocatedAtomic.toString(), epoch.reward_mint, allocationHash,
      `${chain}_reward_allocation_committed`),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    database.prepare(`
      UPDATE reward_vaults SET allocated_atomic = ?3, reserved_atomic = ?4, updated_at = CURRENT_TIMESTAMP
      WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = ?8
        AND allocated_atomic = ?5 AND reserved_atomic = ?6 AND inventory_atomic = ?7
    `).bind(
      epoch.launch_id,
      epoch.reward_mint,
      nextAllocated,
      nextReserved,
      vault.allocated_atomic,
      vault.reserved_atomic,
      vault.inventory_atomic,
      chain,
    ),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
  ];
  await database.batch(statements);
}

async function leaseJob(database: D1Database, workerId: string, jobTypes: string[]) {
  const now = Date.now();
  if (jobTypes.includes("chiliz_reward_purchase") || jobTypes.includes("chiliz_claim_unwrap")) {
    await database.prepare(REQUEUE_UNPREPARED_CHILIZ_FIRST_LEASE_SQL).bind(now, workerId,
      Number(jobTypes.includes("chiliz_reward_purchase")),
      Number(jobTypes.includes("chiliz_claim_unwrap"))).run();
  }
  const placeholders = jobTypes.map((_, index) => `?${index + 2}`).join(", ");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await database.prepare(`
      SELECT id, job_type, entity_type, entity_id, chain, payload_json, state, attempt, leased_until, error_code, tx_hash
      FROM automation_jobs
      WHERE job_type IN (${placeholders}) AND available_at <= ?1
        AND (job_type <> 'solana_reward_purchase' OR entity_type IN ('settlement_step', 'reward_swap_batch'))
        AND (job_type <> 'sportpad_buyback_burn' OR entity_type = 'settlement_step')
        AND ${CHILIZ_FIRST_LEASE_ELIGIBLE_SQL}
        AND (state = 'queued' OR (state = 'leased' AND leased_until < ?1))
      ORDER BY available_at ASC, created_at ASC LIMIT 1
    `).bind(now, ...jobTypes).first<AutomationRow>();
    if (!row) return null;
    const leasedUntil = now + 60_000;
    const result = await database.prepare(`
      UPDATE automation_jobs SET state = 'leased', leased_until = ?2, error_code = ?3,
        attempt = attempt + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND ${CHILIZ_FIRST_LEASE_ELIGIBLE_SQL}
        AND (state = 'queued' OR (state = 'leased' AND leased_until < ?4))
    `).bind(row.id, leasedUntil, `leased:${workerId}`, now).run();
    if (result.meta.changes === 1) {
      return { ...row, attempt: row.attempt + 1, leased_until: leasedUntil, error_code: `leased:${workerId}` };
    }
  }
  return null;
}

type VerifiedChilizFinalization = {
  outputAmountAtomic?: string;
  receiptBlockHash: string;
  receiptBlockNumber: string;
  finalizedBlockNumber: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  networkFeeWei: string;
  principalSpentWei: string;
  totalSpentWei: string;
};

async function completeJob(database: D1Database, job: AutomationRow, workerId: string, txHash: string,
  outputAmountAtomic?: string, sourceTxHash?: string, verifiedSlot?: number,
  chilizFinalization?: VerifiedChilizFinalization) {
  // Claim the completion first, then apply every ledger effect in the same D1
  // transaction. Each zero-row compare-and-swap must throw so D1 rolls back.
  const statements: D1PreparedStatement[] = [
    job.state === "reconciliation_required" && job.job_type === "solana_reward_purchase" &&
      job.entity_type === "reward_swap_batch"
      ? database.prepare(`
          UPDATE automation_jobs SET state = 'complete', tx_hash = ?2, error_code = NULL,
            leased_until = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND state = 'reconciliation_required'
            AND job_type = 'solana_reward_purchase' AND entity_type = 'reward_swap_batch'
            AND (tx_hash IS NULL OR tx_hash = ?2)
        `).bind(job.id, txHash)
      : job.state === "reconciliation_required" && job.job_type === "solana_reward_purchase"
      ? database.prepare(COMPLETE_RECONCILED_JOB_SQL).bind(job.id, txHash)
      : job.state === "reconciliation_required" && job.job_type === "sportpad_buyback_burn"
        ? database.prepare(`
          UPDATE automation_jobs SET state = 'complete', tx_hash = ?2, error_code = NULL,
            leased_until = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND state = 'reconciliation_required'
            AND job_type = 'sportpad_buyback_burn' AND entity_type = 'settlement_step'
            AND (tx_hash IS NULL OR tx_hash = ?2)
        `).bind(job.id, txHash)
      : job.state === "reconciliation_required" && job.job_type === "solana_claim_payout"
        ? database.prepare(`
          UPDATE automation_jobs SET state = 'complete', tx_hash = ?2, error_code = NULL,
            leased_until = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND state = 'reconciliation_required'
            AND job_type = 'solana_claim_payout'
            AND (tx_hash IS NULL OR tx_hash = ?2)
        `).bind(job.id, txHash)
        : database.prepare(COMPLETE_BROADCAST_JOB_SQL).bind(job.id, txHash, `broadcasting:${workerId}`),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
  ];
  if (job.job_type === "chiliz_claim_unwrap" || job.job_type === "solana_claim_payout") {
    const claim = await database.prepare(`
      SELECT c.amount_atomic, e.launch_id, l.reward_chain, l.reward_mint, l.reward_wrapped_contract
      FROM reward_claims c
      JOIN reward_epochs e ON e.id = c.epoch_id
      JOIN launch_drafts l ON l.id = e.launch_id
      WHERE c.id = ?1 AND c.state = 'queued'
    `).bind(job.entity_id).first<{
      amount_atomic: string; launch_id: string; reward_chain: string;
      reward_mint: string; reward_wrapped_contract: string | null;
    }>();
    if (!claim) throw new Error("claim_not_queued");
    if (claim.reward_chain === "chiliz" && claim.reward_wrapped_contract) {
      throw new Error("legacy_chiliz_claim_not_supported");
    }
    const vaultMint = claim.reward_mint;
    if (!vaultMint) throw new Error("claim_vault_mint_missing");
    let vaultFence: Awaited<ReturnType<typeof readSolanaVaultFence>> | null = null;
    if (job.job_type === "solana_claim_payout") {
      const rewardTreasury = readMainnetConfig().rewardTreasury;
      if (!rewardTreasury || workerId !== `solana:${rewardTreasury}` ||
        claim.reward_chain !== "solana") throw new Error("claim_vault_treasury_mismatch");
      vaultFence = await readSolanaVaultFence(database, rewardTreasury, vaultMint);
    }
    const vault = await database.prepare(`
      SELECT inventory_atomic, reserved_atomic, claimed_atomic FROM reward_vaults
      WHERE launch_id = ?1 AND reward_mint = ?2
    `).bind(claim.launch_id, vaultMint).first<{
      inventory_atomic: string; reserved_atomic: string; claimed_atomic: string;
    }>();
    if (!vault) throw new Error("claim_vault_missing");
    const claimAmount = BigInt(claim.amount_atomic);
    if (claimAmount <= 0n) throw new Error("claim_amount_invalid");
    const inventory = BigInt(vault.inventory_atomic);
    const reserved = BigInt(vault.reserved_atomic);
    if (inventory < claimAmount || reserved < claimAmount) throw new Error("claim_vault_accounting_underflow");
    if (vaultFence) {
      statements.push(database.prepare(UPDATE_SOLANA_VAULT_FENCE_SQL).bind(
        vaultFence.key, vaultFence.priorValue, vaultFence.nextValue));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    }
    statements.push(database.prepare(COMPLETE_CLAIM_VAULT_SQL).bind(
      claim.launch_id,
      vaultMint,
      (inventory - claimAmount).toString(),
      (reserved - claimAmount).toString(),
      (BigInt(vault.claimed_atomic) + claimAmount).toString(),
      vault.inventory_atomic,
      vault.reserved_atomic,
      vault.claimed_atomic,
      claim.reward_chain,
    ));
    statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    statements.push(database.prepare(COMPLETE_CLAIM_SQL).bind(job.entity_id, txHash));
    statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    if (job.job_type === "solana_claim_payout") {
      statements.push(database.prepare(COMPLETE_AUTOMATIC_CLAIM_INTENT_SQL).bind(
        `automation:claim:payout:${job.id}:${job.attempt}`, job.entity_id, txHash));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    }
  } else if (job.job_type === "chiliz_reward_purchase") {
    if (!outputAmountAtomic) throw new Error("purchase_output_missing");
    const payload = JSON.parse(job.payload_json) as { launchId: string; fanTokenContract: string };
    const owner = workerId.startsWith("chiliz:") ? workerId.slice("chiliz:".length) : env.CHILIZ_TREASURY_ADDRESS?.trim();
    if (!owner) throw new Error("chiliz_treasury_missing");
    const [vault, epoch] = await Promise.all([
      database.prepare("SELECT inventory_atomic FROM reward_vaults WHERE launch_id = ?1 AND reward_mint = ?2")
        .bind(payload.launchId, payload.fanTokenContract).first<{ inventory_atomic: string }>(),
      database.prepare("SELECT id, funded_amount_atomic FROM reward_epochs WHERE launch_id = ?1 AND state = 'accruing' ORDER BY created_at DESC LIMIT 1")
        .bind(payload.launchId).first<{ id: string; funded_amount_atomic: string }>(),
    ]);
    const nextInventory = (BigInt(vault?.inventory_atomic ?? "0") + BigInt(outputAmountAtomic)).toString();
    const nextFunding = epoch ? (BigInt(epoch.funded_amount_atomic) + BigInt(outputAmountAtomic)).toString() : null;
    statements.push(
      database.prepare(COMPLETE_PURCHASE_SETTLEMENT_SQL).bind(job.entity_id, txHash, payload.launchId, payload.fanTokenContract),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      database.prepare(COMPLETE_PURCHASE_VAULT_SQL).bind(crypto.randomUUID(), payload.launchId,
        payload.fanTokenContract, owner, nextInventory, vault?.inventory_atomic ?? "0"),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    );
    if (epoch && nextFunding) {
      statements.push(database.prepare(`
        UPDATE reward_epochs SET funded_amount_atomic = ?2, reward_decimals = 18, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'accruing' AND funded_amount_atomic = ?3
      `).bind(epoch.id, nextFunding, epoch.funded_amount_atomic));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    } else if (!epoch) {
      // Give the finalized holder indexer time to establish a pre-start
      // checkpoint. A missed warm-up makes this epoch fail closed.
      const startsAt = new Date(Date.now() + 5 * 60 * 1_000);
      const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1_000);
      statements.push(database.prepare(`
        INSERT INTO reward_epochs
          (id, launch_id, starts_at, ends_at, funded_amount_atomic, reward_decimals, state)
        VALUES (?1, ?2, ?3, ?4, ?5, 18, 'accruing')
      `).bind(crypto.randomUUID(), payload.launchId, startsAt.toISOString(), endsAt.toISOString(), outputAmountAtomic));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    }
  } else if (job.job_type === "solana_reward_purchase" && job.entity_type === "reward_swap_batch") {
    if (!outputAmountAtomic || sourceTxHash || !Number.isSafeInteger(verifiedSlot) ||
      !verifiedSlot || verifiedSlot <= 0) throw new Error("solana_reward_batch_receipt_missing");
    const payload = JSON.parse(job.payload_json) as { batchId: string; launchId: string;
      rewardMint: string; rewardSymbol: string; rewardAmountLamports: string };
    const owner = readMainnetConfig().rewardTreasury;
    if (!owner || workerId !== `solana:${owner}`) throw new Error("solana_reward_batch_owner_mismatch");
    const batch = await database.prepare(`
      SELECT b.launch_id, b.reward_mint, b.treasury, b.input_amount_atomic,
        b.state, l.reward_chain, l.reward_symbol, l.status AS launch_status,
        (SELECT COUNT(*) FROM reward_swap_batch_sources src WHERE src.batch_id = b.id
          AND src.state = 'reserved') AS source_count,
        (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER)) FROM reward_swap_batch_sources src
          WHERE src.batch_id = b.id AND src.state = 'reserved') AS source_sum
      FROM reward_swap_batches b JOIN launch_drafts l ON l.id = b.launch_id
      WHERE b.id = ?1
    `).bind(job.entity_id).first<{ launch_id: string; reward_mint: string; treasury: string;
      input_amount_atomic: string; state: string; reward_chain: string; reward_symbol: string;
      launch_status: string; source_count: number; source_sum: number | null }>();
    if (!batch || batch.state !== "broadcasting" || batch.treasury !== owner ||
      batch.reward_chain !== "solana" ||
      !["mainnet_published", "mainnet_suspended"].includes(batch.launch_status) ||
      getRewardOption("solana", batch.reward_symbol)?.tokenAddress !== batch.reward_mint ||
      batch.source_count <= 0 || batch.source_sum?.toString() !== batch.input_amount_atomic ||
      payload.batchId !== job.entity_id || payload.launchId !== batch.launch_id ||
      payload.rewardMint !== batch.reward_mint || payload.rewardSymbol !== batch.reward_symbol ||
      payload.rewardAmountLamports !== batch.input_amount_atomic) {
      throw new Error("solana_reward_batch_completion_snapshot_mismatch");
    }
    await closeMatureRewardEpoch(database, "solana", payload.launchId);
    const mint = new PublicKey(payload.rewardMint);
    const mintAccount = await getMainnetConnection().getAccountInfo(mint, "finalized");
    if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
      !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error("solana_reward_mint_invalid");
    const mintState = await getMint(getMainnetConnection(), mint, "finalized", mintAccount.owner);
    const tokenAccount = getAssociatedTokenAddressSync(mint, new PublicKey(owner), false,
      mintAccount.owner).toBase58();
    const [vault, epoch] = await Promise.all([
      database.prepare(`
        SELECT inventory_atomic FROM reward_vaults
        WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = 'solana'
      `).bind(payload.launchId, payload.rewardMint).first<{ inventory_atomic: string }>(),
      database.prepare(`
        SELECT e.id, e.state, e.funded_amount_atomic, e.ends_at,
          EXISTS (SELECT 1 FROM protocol_events p WHERE p.entity_type = 'epoch'
            AND p.entity_id = e.id AND p.event_type = 'automatic_reward_epoch_opened')
            AS automatic_owned
        FROM reward_epochs e WHERE launch_id = ?1 AND state IN ('accruing', 'allocating') LIMIT 1
      `).bind(payload.launchId).first<{ id: string; state: string;
        funded_amount_atomic: string; ends_at: string; automatic_owned: number }>(),
    ]);
    if (epoch && epoch.automatic_owned !== 1) throw new Error("manual_epoch_conflicts_with_automation");
    if (epoch?.state === "allocating") throw new Error("solana_epoch_allocation_in_progress");
    if (epoch && Date.parse(epoch.ends_at) <= Date.now()) {
      throw new Error("solana_epoch_final_snapshot_pending");
    }
    const fence = await readSolanaVaultFence(database, owner, payload.rewardMint);
    await readSolanaRewardVaultSolvency(database, getMainnetConnection(), {
      mint: payload.rewardMint, treasury: owner,
      change: { type: "purchase_completed", amountAtomic: outputAmountAtomic },
    });
    const nextInventory = (BigInt(vault?.inventory_atomic ?? "0") + BigInt(outputAmountAtomic)).toString();
    statements.push(
      database.prepare(UPDATE_SOLANA_VAULT_FENCE_SQL).bind(fence.key, fence.priorValue, fence.nextValue),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      database.prepare(COMPLETE_REWARD_BATCH_SQL).bind(job.entity_id, txHash,
        outputAmountAtomic, verifiedSlot, batch.input_amount_atomic, batch.reward_mint,
        job.id, rewardBatchIntentKey(job.entity_id)),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      database.prepare(VERIFY_REWARD_BATCH_SOURCES_SQL).bind(job.entity_id, txHash),
      database.prepare(ASSERT_REWARD_BATCH_SOURCES_VERIFIED_SQL).bind(job.entity_id, txHash),
      database.prepare(ADVANCE_REWARD_BATCH_SETTLEMENTS_SQL).bind(job.entity_id, txHash),
      database.prepare(ASSERT_REWARD_BATCH_SETTLEMENTS_ADVANCED_SQL).bind(job.entity_id, txHash),
      database.prepare(COMPLETE_SOLANA_PURCHASE_VAULT_SQL).bind(crypto.randomUUID(),
        payload.launchId, payload.rewardMint, owner, tokenAccount, nextInventory, verifiedSlot,
        vault?.inventory_atomic ?? "0"),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    );
    if (epoch) {
      statements.push(database.prepare(`
        UPDATE reward_epochs SET funded_amount_atomic = ?2, reward_decimals = ?3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'accruing' AND funded_amount_atomic = ?4
      `).bind(epoch.id, (BigInt(epoch.funded_amount_atomic) + BigInt(outputAmountAtomic)).toString(),
        mintState.decimals, epoch.funded_amount_atomic));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    } else {
      const startsAt = new Date(Date.now() + 15 * 60 * 1_000);
      const epochId = crypto.randomUUID();
      statements.push(database.prepare(`
        INSERT INTO reward_epochs
          (id, launch_id, starts_at, ends_at, funded_amount_atomic, reward_decimals, state)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'accruing')
      `).bind(epochId, payload.launchId, startsAt.toISOString(),
        new Date(startsAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        outputAmountAtomic, mintState.decimals));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
      statements.push(database.prepare(`
        INSERT INTO protocol_events
          (id, category, entity_type, entity_id, event_type, idempotency_key,
           state, signature, amount_atomic, mint)
        VALUES (?1, 'rewards', 'epoch', ?2, 'automatic_reward_epoch_opened',
          ?1, 'verified', ?3, ?4, ?5)
      `).bind(`automatic-epoch:${epochId}`, epochId, txHash, outputAmountAtomic,
        payload.rewardMint));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    }
  } else if (job.job_type === "solana_reward_purchase") {
    if (!outputAmountAtomic || sourceTxHash || !Number.isSafeInteger(verifiedSlot) ||
      !verifiedSlot || verifiedSlot <= 0) throw new Error("solana_reward_receipt_missing");
    const payload = JSON.parse(job.payload_json) as {
      settlementId: string; stepId: string; launchId: string; rewardMint: string;
      rewardAmountLamports: string; rewardTotalLamports: string; chunkOffsetAtomic: string;
    };
    const owner = readMainnetConfig().rewardTreasury;
    if (!owner || workerId !== `solana:${owner}`) throw new Error("solana_reward_owner_mismatch");
    const step = await database.prepare(`
      SELECT step.settlement_id, step.state, step.input_amount_atomic, step.output_mint,
        step.idempotency_key, s.reward_amount_atomic, s.reward_spent_atomic,
        s.reward_swap_signature, s.state AS settlement_state,
        f.launch_id, l.status AS launch_status, l.reward_chain, l.reward_mint,
        l.mainnet_reward_treasury
      FROM settlement_steps step JOIN settlements s ON s.id = step.settlement_id
      JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE step.id = ?1 AND step.stage = 'automatic_reward_chunk'
    `).bind(job.entity_id).first<{
      settlement_id: string; state: string; input_amount_atomic: string; output_mint: string;
      idempotency_key: string; reward_amount_atomic: string; reward_spent_atomic: string;
      reward_swap_signature: string | null; settlement_state: string; launch_id: string;
      launch_status: string; reward_chain: string; reward_mint: string;
      mainnet_reward_treasury: string | null;
    }>();
    const chunk = step && planAutomaticRewardChunk(step.reward_amount_atomic, step.reward_spent_atomic);
    if (!step || !chunk || job.entity_type !== "settlement_step" ||
      step.state !== "planned" || step.reward_swap_signature !== null ||
      !["reconciled", "distributed", "buyback_burned"].includes(step.settlement_state) ||
      !["mainnet_published", "mainnet_suspended"].includes(step.launch_status) ||
      step.reward_chain !== "solana" ||
      step.mainnet_reward_treasury !== owner || step.reward_mint !== payload.rewardMint ||
      step.output_mint !== payload.rewardMint || step.launch_id !== payload.launchId ||
      step.settlement_id !== payload.settlementId || payload.stepId !== job.entity_id ||
      step.input_amount_atomic !== chunk.inputAmountLamports ||
      step.idempotency_key !== automaticRewardChunkKey(step.settlement_id, chunk.offsetAtomic) ||
      payload.rewardAmountLamports !== chunk.inputAmountLamports ||
      payload.rewardTotalLamports !== step.reward_amount_atomic ||
      payload.chunkOffsetAtomic !== chunk.offsetAtomic) throw new Error("solana_reward_chunk_snapshot_mismatch");
    await closeMatureRewardEpoch(database, "solana", payload.launchId);
    const mint = new PublicKey(payload.rewardMint);
    const mintAccount = await getMainnetConnection().getAccountInfo(mint, "finalized");
    if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
      !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error("solana_reward_mint_invalid");
    const mintState = await getMint(getMainnetConnection(), mint, "finalized", mintAccount.owner);
    const tokenAccount = getAssociatedTokenAddressSync(mint, new PublicKey(owner), false, mintAccount.owner).toBase58();
    const [vault, epoch] = await Promise.all([
      database.prepare(`
        SELECT inventory_atomic FROM reward_vaults
        WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = 'solana'
      `).bind(payload.launchId, payload.rewardMint).first<{ inventory_atomic: string }>(),
      database.prepare(`
        SELECT e.id, e.state, e.funded_amount_atomic, e.ends_at,
          EXISTS (SELECT 1 FROM protocol_events p WHERE p.entity_type = 'epoch'
            AND p.entity_id = e.id AND p.event_type = 'automatic_reward_epoch_opened')
            AS automatic_owned
        FROM reward_epochs e
        WHERE launch_id = ?1 AND state IN ('accruing', 'allocating') LIMIT 1
      `).bind(payload.launchId).first<{
        id: string; state: string; funded_amount_atomic: string;
        ends_at: string; automatic_owned: number;
      }>(),
    ]);
    if (epoch && epoch.automatic_owned !== 1) throw new Error("manual_epoch_conflicts_with_automation");
    if (epoch?.state === "allocating") throw new Error("solana_epoch_allocation_in_progress");
    if (epoch && Date.parse(epoch.ends_at) <= Date.now()) {
      throw new Error("solana_epoch_final_snapshot_pending");
    }
    const fence = await readSolanaVaultFence(database, owner, payload.rewardMint);
    await readSolanaRewardVaultSolvency(database, getMainnetConnection(), {
      mint: payload.rewardMint, treasury: owner,
      change: { type: "purchase_completed", amountAtomic: outputAmountAtomic },
    });
    const nextInventory = (BigInt(vault?.inventory_atomic ?? "0") + BigInt(outputAmountAtomic)).toString();
    statements.push(
      database.prepare(UPDATE_SOLANA_VAULT_FENCE_SQL).bind(fence.key, fence.priorValue, fence.nextValue),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      database.prepare(COMPLETE_AUTOMATIC_REWARD_CHUNK_SQL).bind(
        job.entity_id, txHash, outputAmountAtomic, verifiedSlot,
        chunk.inputAmountLamports, payload.rewardMint, job.id,
        `automation:reward:swap:${job.entity_id}`),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      database.prepare(ADVANCE_AUTOMATIC_REWARD_SETTLEMENT_SQL).bind(
        step.settlement_id, chunk.offsetAtomic, step.reward_amount_atomic,
        chunk.nextSpentAtomic, txHash, job.entity_id, chunk.inputAmountLamports,
        readMainnetConfig().sportpadMint ?? null, owner),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      database.prepare(COMPLETE_SOLANA_PURCHASE_VAULT_SQL).bind(crypto.randomUUID(),
        payload.launchId, payload.rewardMint, owner, tokenAccount, nextInventory, verifiedSlot,
        vault?.inventory_atomic ?? "0"),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    );
    if (epoch) {
      statements.push(database.prepare(`
        UPDATE reward_epochs SET funded_amount_atomic = ?2, reward_decimals = ?3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'accruing' AND funded_amount_atomic = ?4
      `).bind(epoch.id, (BigInt(epoch.funded_amount_atomic) + BigInt(outputAmountAtomic)).toString(),
        mintState.decimals, epoch.funded_amount_atomic));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    } else {
      // Require a finalized holder snapshot before the first eligible second.
      const startsAt = new Date(Date.now() + 15 * 60 * 1_000);
      const epochId = crypto.randomUUID();
      statements.push(database.prepare(`
        INSERT INTO reward_epochs
          (id, launch_id, starts_at, ends_at, funded_amount_atomic, reward_decimals, state)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'accruing')
      `).bind(epochId, payload.launchId, startsAt.toISOString(),
        new Date(startsAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        outputAmountAtomic, mintState.decimals));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
      statements.push(database.prepare(`
        INSERT INTO protocol_events
          (id, category, entity_type, entity_id, event_type, idempotency_key,
           state, signature, amount_atomic, mint)
        VALUES (?1, 'rewards', 'epoch', ?2, 'automatic_reward_epoch_opened',
          ?1, 'verified', ?3, ?4, ?5)
      `).bind(`automatic-epoch:${epochId}`, epochId, txHash, outputAmountAtomic, payload.rewardMint));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    }
  } else if (job.job_type === "sportpad_buyback_burn") {
    if (!sourceTxHash || !outputAmountAtomic) throw new Error("buyback_swap_receipt_missing");
    const payload = JSON.parse(job.payload_json) as {
      settlementId: string; stepId: string; launchId: string; sportpadMint: string;
      amountLamports: string; buybackTotalLamports: string; chunkOffsetAtomic: string;
    };
    const step = await database.prepare(`
      SELECT step.settlement_id, step.state AS step_state, step.input_amount_atomic,
        step.output_amount_atomic, step.output_mint, step.tx_signature, step.idempotency_key,
        s.buyback_amount_atomic, s.buyback_spent_atomic, s.state AS settlement_state,
        f.launch_id, l.status AS launch_status, l.mainnet_buyback_treasury
      FROM settlement_steps step JOIN settlements s ON s.id = step.settlement_id
      JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE step.id = ?1 AND step.stage = 'automatic_buyback_chunk'
    `).bind(job.entity_id).first<{
      settlement_id: string; step_state: string; input_amount_atomic: string;
      output_amount_atomic: string | null; output_mint: string | null;
      tx_signature: string | null; idempotency_key: string;
      buyback_amount_atomic: string; buyback_spent_atomic: string; settlement_state: string;
      launch_id: string; launch_status: string; mainnet_buyback_treasury: string | null;
    }>();
    const chunk = step && planAutomaticBuybackChunk(step.buyback_amount_atomic, step.buyback_spent_atomic);
    const config = readMainnetConfig();
    if (!step || !chunk || !config.buybackTreasury ||
      workerId !== `solana:${config.buybackTreasury}` || job.entity_type !== "settlement_step" ||
      step.step_state !== "swap_verified" || step.tx_signature !== sourceTxHash ||
      step.output_amount_atomic !== outputAmountAtomic || step.output_mint !== payload.sportpadMint ||
      step.input_amount_atomic !== chunk.inputAmountLamports ||
      step.idempotency_key !== automaticBuybackChunkKey(step.settlement_id, chunk.offsetAtomic) ||
      step.settlement_id !== payload.settlementId || payload.stepId !== job.entity_id ||
      step.launch_id !== payload.launchId ||
      !["mainnet_published", "mainnet_suspended"].includes(step.launch_status) ||
      !["reconciled", "distributed", "reward_acquired"].includes(step.settlement_state) ||
      step.mainnet_buyback_treasury !== config.buybackTreasury ||
      payload.amountLamports !== chunk.inputAmountLamports ||
      payload.buybackTotalLamports !== step.buyback_amount_atomic ||
      payload.chunkOffsetAtomic !== chunk.offsetAtomic) throw new Error("buyback_chunk_snapshot_mismatch");
    statements.push(database.prepare(COMPLETE_AUTOMATIC_BUYBACK_BURN_INTENT_SQL).bind(
      `automation:buyback:burn:${job.entity_id}`, step.settlement_id, txHash));
    statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    statements.push(database.prepare(COMPLETE_AUTOMATIC_BUYBACK_CHUNK_SQL).bind(
      job.entity_id, sourceTxHash, txHash, outputAmountAtomic, job.id,
      `automation:buyback:swap:${job.entity_id}`, `automation:buyback:burn:${job.entity_id}`));
    statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    statements.push(database.prepare(ADVANCE_AUTOMATIC_BUYBACK_SETTLEMENT_SQL).bind(
      step.settlement_id, chunk.offsetAtomic, step.buyback_amount_atomic,
      chunk.nextSpentAtomic, sourceTxHash, txHash, job.entity_id, chunk.inputAmountLamports));
    statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
  } else {
    throw new Error("automation_job_type_invalid");
  }
  if (job.chain === "chiliz") {
    if (!chilizFinalization) throw new Error("chiliz_finalized_intent_proof_missing");
    statements.push(database.prepare(FINALIZE_CHILIZ_INTENT_SQL).bind(
      job.id, txHash.toLowerCase(), "finalized_success", "success",
      chilizFinalization.receiptBlockHash, chilizFinalization.receiptBlockNumber,
      chilizFinalization.receiptBlockHash, chilizFinalization.finalizedBlockNumber,
      chilizFinalization.gasUsed, chilizFinalization.effectiveGasPriceWei,
      chilizFinalization.networkFeeWei, chilizFinalization.principalSpentWei,
      chilizFinalization.totalSpentWei, JSON.stringify(chilizFinalization),
    ));
    statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
  }
  await database.batch(statements);
}

async function verifiedChilizOutput(database: D1Database, job: AutomationRow, workerId: string,
  txHash: string, reportedOutput?: string) {
  if (job.chain !== "chiliz" || !/^chiliz:0x[0-9a-fA-F]{40}$/.test(workerId)) {
    throw new Error("chiliz_worker_identity_invalid");
  }
  const treasury = env.CHILIZ_TREASURY_ADDRESS?.trim();
  if (!treasury || !/^0x[0-9a-fA-F]{40}$/.test(treasury) ||
    workerId.toLowerCase() !== `chiliz:${treasury.toLowerCase()}`) {
    throw new Error("chiliz_treasury_unconfigured_or_mismatched");
  }
  const signedRow = await database.prepare(SELECT_CHILIZ_SIGNED_INTENT_SQL)
    .bind(job.id).first<PersistedChilizIntentRow>();
  if (!signedRow) throw new Error("chiliz_signed_intent_missing");
  const signedIntent = await parsePersistedChilizSignedIntent(signedRow);
  if (signedIntent.txHash.toLowerCase() !== txHash.toLowerCase() ||
    signedIntent.treasury.toLowerCase() !== treasury.toLowerCase() ||
    signedIntent.kind !== (job.job_type === "chiliz_reward_purchase" ? "purchase" : "claim")) {
    throw new Error("chiliz_signed_intent_job_mismatch");
  }
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  let expectedPurchase: { txHash: string; treasury: string; fanTokenContract: string; outputAmountAtomic: string } | null = null;
  let purchaseRewardAmountLamports: string | null = null;
  let expectedTransfer: { txHash: string; treasury: string; destination: string;
    fanTokenContract: string; amountAtomic: string } | null = null;
  if (job.job_type === "chiliz_reward_purchase") {
    const row = await database.prepare(`
      SELECT s.reward_amount_atomic, f.launch_id, l.reward_symbol, l.reward_chain,
        l.reward_mint, l.reward_wrapped_contract
      FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE s.id = ?1 AND s.reward_swap_signature IS NULL
        AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    `).bind(job.entity_id).first<{
      reward_amount_atomic: string; launch_id: string; reward_symbol: string; reward_chain: string;
      reward_mint: string; reward_wrapped_contract: string | null;
    }>();
    const asset = row && getChilizRewardAsset(row.reward_symbol);
    if (!row || !asset || job.entity_type !== "settlement" || row.reward_chain !== "chiliz" ||
      asset.routeStatus !== "current_verified" || row.reward_wrapped_contract !== null ||
      row.reward_mint.toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
      payload.settlementId !== job.entity_id || payload.launchId !== row.launch_id ||
      payload.rewardAmountLamports !== row.reward_amount_atomic || payload.rewardSymbol !== row.reward_symbol ||
      payload.fanTokenContract?.toString().toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
      !reportedOutput) throw new Error("chiliz_purchase_job_snapshot_mismatch");
    expectedPurchase = { txHash, treasury, fanTokenContract: asset.currentV2Contract,
      outputAmountAtomic: reportedOutput };
    purchaseRewardAmountLamports = row.reward_amount_atomic;
  } else if (job.job_type === "chiliz_claim_unwrap") {
    // Keep the historical internal job type for DB compatibility. The V2
    // worker sends a direct ERC-20 transfer, never a legacy Kayen unwrap.
    const row = await database.prepare(`
      SELECT c.amount_atomic, c.destination_address, c.destination_chain,
        l.reward_symbol, l.reward_chain, l.reward_mint, l.reward_wrapped_contract
      FROM reward_claims c JOIN reward_epochs e ON e.id = c.epoch_id
      JOIN launch_drafts l ON l.id = e.launch_id
      WHERE c.id = ?1 AND c.state = 'queued'
    `).bind(job.entity_id).first<{
      amount_atomic: string; destination_address: string; destination_chain: string;
      reward_symbol: string; reward_chain: string; reward_mint: string; reward_wrapped_contract: string | null;
    }>();
    const asset = row && getChilizRewardAsset(row.reward_symbol);
    if (!row || !asset || job.entity_type !== "reward_claim" ||
      row.reward_chain !== "chiliz" || row.destination_chain !== "chiliz" ||
      !/^0x[0-9a-fA-F]{40}$/.test(row.destination_address) ||
      asset.routeStatus !== "current_verified" || row.reward_wrapped_contract !== null ||
      row.reward_mint.toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
      payload.claimId !== job.entity_id || payload.amountAtomic !== row.amount_atomic ||
      payload.rewardSymbol !== row.reward_symbol ||
      payload.destinationAddress?.toString().toLowerCase() !== row.destination_address.toLowerCase() ||
      payload.fanTokenContract?.toString().toLowerCase() !== asset.currentV2Contract.toLowerCase()) {
      throw new Error("chiliz_claim_job_snapshot_mismatch");
    }
    expectedTransfer = { txHash, treasury, destination: row.destination_address,
      fanTokenContract: asset.currentV2Contract, amountAtomic: row.amount_atomic };
  } else {
    throw new Error("chiliz_job_type_invalid");
  }
  const primaryRpcUrl = env.CHILIZ_RPC_URL?.trim() || CHILIZ_CHAIN.rpcUrl;
  const secondaryRpcUrl = new URL(primaryRpcUrl).hostname === "rpc.ankr.com"
    ? "https://chiliz-rpc.publicnode.com" : "https://rpc.ankr.com/chiliz";
  const client = createPublicClient({ transport: http(primaryRpcUrl,
    { timeout: 12_000, retryCount: 1 }) });
  const [chainId, latestBlock, transaction, receipt] = await Promise.all([
    client.getChainId(), client.getBlockNumber(),
    client.getTransaction({ hash: txHash as `0x${string}` }),
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
  ]);
  const finalityProof = await verifyChilizDualRpcFinality({ primaryRpcUrl, secondaryRpcUrl,
    receipt: { transactionHash: receipt.transactionHash, blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber, status: receipt.status } });
  const finalization = await reconcileChilizSignedIntent(signedIntent, {
    chainId,
    transaction: {
      hash: transaction.hash, from: transaction.from, to: transaction.to,
      input: transaction.input, value: transaction.value, chainId: transaction.chainId,
      nonce: transaction.nonce, gas: transaction.gas,
      maxFeePerGas: transaction.maxFeePerGas ?? null,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ?? null,
      type: transaction.type, blockHash: transaction.blockHash,
      blockNumber: transaction.blockNumber,
    },
    receipt: {
      transactionHash: receipt.transactionHash, status: receipt.status,
      blockHash: receipt.blockHash, blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
    },
    canonicalReceiptBlockHash: finalityProof.canonicalBlockHash,
    finalizedBlockNumber: finalityProof.finalizedBlockNumber,
  });
  if (finalization.state !== "finalized_success") {
    throw new Error("chiliz_signed_intent_not_finalized_successfully");
  }
  const tokenContract = (expectedPurchase?.fanTokenContract ?? expectedTransfer?.fanTokenContract) as `0x${string}`;
  const tokenDecimals = await client.readContract({ address: tokenContract,
    abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals",
    blockNumber: receipt.blockNumber });
  const evidence = { chainId, latestBlock, tokenDecimals, transaction, receipt };
  const verifiedFinalization: VerifiedChilizFinalization = {
    receiptBlockHash: receipt.blockHash,
    receiptBlockNumber: receipt.blockNumber.toString(),
    finalizedBlockNumber: finalityProof.finalizedBlockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    networkFeeWei: finalization.networkFeeWei,
    principalSpentWei: finalization.principalSpentWei,
    totalSpentWei: finalization.totalSpentWei,
  };
  if (expectedPurchase) {
    if (!purchaseRewardAmountLamports || signedIntent.kind !== "purchase") {
      throw new Error("chiliz_purchase_signed_intent_invalid");
    }
    return { ...verifiedFinalization, outputAmountAtomic:
      verifyChilizPurchaseReceipt(evidence, { ...expectedPurchase,
        maxSpendChzWei: signedIntent.maxPrincipalWei }).acquiredAtomic.toString() };
  }
  verifyChilizTransferReceipt(evidence, expectedTransfer!);
  return verifiedFinalization;
}

/** A finalized revert spends gas but acquires or pays no Fan Tokens. Record it
 * as a terminal loss without discharging the settlement or claim liability. */
async function finalizeRevertedChilizIntent(database: D1Database, jobId: string,
  intent: ChilizSignedIntent): Promise<boolean> {
  const primaryRpcUrl = env.CHILIZ_RPC_URL?.trim() || CHILIZ_CHAIN.rpcUrl;
  const secondaryRpcUrl = new URL(primaryRpcUrl).hostname === "rpc.ankr.com"
    ? "https://chiliz-rpc.publicnode.com" : "https://rpc.ankr.com/chiliz";
  const client = createPublicClient({ transport: http(primaryRpcUrl,
    { timeout: 12_000, retryCount: 1 }) });
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  try { receipt = await client.getTransactionReceipt({ hash: intent.txHash }); }
  catch { return false; }
  if (receipt.status !== "reverted") return false;
  const [chainId, transaction] = await Promise.all([
    client.getChainId(), client.getTransaction({ hash: intent.txHash }),
  ]);
  const proof = await verifyChilizDualRpcFinality({ primaryRpcUrl, secondaryRpcUrl,
    receipt: { transactionHash: receipt.transactionHash, blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber, status: "reverted" } });
  const result = await reconcileChilizSignedIntent(intent, {
    chainId,
    transaction: { hash: transaction.hash, from: transaction.from, to: transaction.to,
      input: transaction.input, value: transaction.value, chainId: transaction.chainId,
      nonce: transaction.nonce, gas: transaction.gas,
      maxFeePerGas: transaction.maxFeePerGas ?? null,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ?? null,
      type: transaction.type, blockHash: transaction.blockHash,
      blockNumber: transaction.blockNumber },
    receipt: { transactionHash: receipt.transactionHash, status: receipt.status,
      blockHash: receipt.blockHash, blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice },
    canonicalReceiptBlockHash: proof.canonicalBlockHash,
    finalizedBlockNumber: proof.finalizedBlockNumber,
  });
  if (result.state !== "finalized_reverted" || result.principalSpentWei !== "0") {
    throw new Error("chiliz_revert_finality_unverified");
  }
  const evidence = { txHash: intent.txHash, receiptBlockHash: receipt.blockHash,
    receiptBlockNumber: receipt.blockNumber.toString(),
    finalizedBlockNumber: proof.finalizedBlockNumber.toString(),
    networkFeeWei: result.networkFeeWei, principalSpentWei: "0",
    totalSpentWei: result.totalSpentWei, state: "finalized_reverted" };
  await database.batch([
    database.prepare(FINALIZE_CHILIZ_INTENT_SQL).bind(jobId, intent.txHash.toLowerCase(),
      "finalized_reverted", "reverted", receipt.blockHash,
      receipt.blockNumber.toString(), proof.canonicalBlockHash,
      proof.finalizedBlockNumber.toString(), receipt.gasUsed.toString(),
      receipt.effectiveGasPrice.toString(), result.networkFeeWei, "0",
      result.totalSpentWei, JSON.stringify(evidence)),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    database.prepare(FINALIZE_REVERTED_CHILIZ_JOB_SQL)
      .bind(jobId, intent.txHash.toLowerCase(), JSON.stringify(evidence)),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
  ]);
  return true;
}

async function verifiedSolanaOutput(database: D1Database, job: AutomationRow,
  workerId: string, txHash: string, sourceTxHash?: string, reportedOutput?: string) {
  if (job.chain !== "solana" || !/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(workerId)) {
    throw new Error("solana_worker_identity_invalid");
  }
  const config = readMainnetConfig();
  const expectedWorkerTreasury = job.job_type === "sportpad_buyback_burn"
    ? config.buybackTreasury : config.rewardTreasury;
  if (!expectedWorkerTreasury || workerId !== `solana:${expectedWorkerTreasury}`) {
    throw new Error("solana_treasury_unconfigured_or_mismatched");
  }
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  let expected: {
    mint: string; treasury: string; recipient?: string; amountAtomic?: string;
    inputAmountLamports?: string; purchasedAmountAtomic?: string;
    anchorSettlementId?: string;
  };
  if (job.job_type === "solana_claim_payout") {
    const row = await database.prepare(`
      SELECT c.amount_atomic, c.destination_address, c.destination_chain,
        l.reward_chain, l.reward_mint, l.reward_symbol
      FROM reward_claims c JOIN reward_epochs e ON e.id = c.epoch_id
      JOIN launch_drafts l ON l.id = e.launch_id
      WHERE c.id = ?1 AND c.state = 'queued'
    `).bind(job.entity_id).first<{
      amount_atomic: string; destination_address: string; destination_chain: string;
      reward_chain: string; reward_mint: string; reward_symbol: string;
    }>();
    const asset = row && getRewardOption("solana", row.reward_symbol);
    if (!row || row.reward_chain !== "solana" || row.destination_chain !== "solana" ||
      !asset || asset.tokenAddress !== row.reward_mint ||
      payload.claimId !== job.entity_id || payload.tokenAddress !== row.reward_mint ||
      payload.destinationAddress !== row.destination_address ||
      payload.amountAtomic !== row.amount_atomic || sourceTxHash || reportedOutput) {
      throw new Error("solana_claim_job_snapshot_mismatch");
    }
    expected = { mint: row.reward_mint, treasury: expectedWorkerTreasury,
      recipient: row.destination_address, amountAtomic: row.amount_atomic };
  } else if (job.job_type === "solana_reward_purchase" && job.entity_type === "reward_swap_batch") {
    const batch = await database.prepare(`
      SELECT b.launch_id, b.reward_mint, b.treasury, b.input_amount_atomic,
        b.state, l.reward_symbol, l.reward_chain, l.status AS launch_status,
        (SELECT src.settlement_id FROM reward_swap_batch_sources src
          WHERE src.batch_id = b.id ORDER BY src.created_at, src.settlement_id LIMIT 1)
          AS anchor_settlement_id,
        (SELECT COUNT(*) FROM reward_swap_batch_sources src WHERE src.batch_id = b.id
          AND src.state = 'reserved') AS source_count,
        (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
          FROM reward_swap_batch_sources src WHERE src.batch_id = b.id
            AND src.state = 'reserved') AS source_sum,
        (SELECT COUNT(*) FROM reward_swap_batch_sources src
          JOIN settlements s ON s.id = src.settlement_id
          WHERE src.batch_id = b.id AND (s.reward_spent_atomic <> src.offset_atomic
            OR s.reward_amount_atomic <> src.total_atomic
            OR s.reward_swap_signature IS NOT NULL)) AS changed_count
      FROM reward_swap_batches b JOIN launch_drafts l ON l.id = b.launch_id
      WHERE b.id = ?1
    `).bind(job.entity_id).first<{ launch_id: string; reward_mint: string;
      treasury: string; input_amount_atomic: string; state: string;
      reward_symbol: string; reward_chain: string; launch_status: string;
      anchor_settlement_id: string | null; source_count: number;
      source_sum: number | null; changed_count: number }>();
    const asset = batch && getRewardOption("solana", batch.reward_symbol);
    if (!batch || !asset || batch.state !== "broadcasting" ||
      batch.reward_chain !== "solana" || asset.tokenAddress !== batch.reward_mint ||
      !["mainnet_published", "mainnet_suspended"].includes(batch.launch_status) ||
      batch.treasury !== expectedWorkerTreasury ||
      !batch.anchor_settlement_id || batch.source_count <= 0 || batch.changed_count !== 0 ||
      batch.source_sum?.toString() !== batch.input_amount_atomic ||
      payload.batchId !== job.entity_id || payload.launchId !== batch.launch_id ||
      payload.rewardMint !== batch.reward_mint || payload.rewardSymbol !== batch.reward_symbol ||
      payload.rewardAmountLamports !== batch.input_amount_atomic ||
      !reportedOutput || sourceTxHash) {
      throw new Error("solana_reward_batch_snapshot_mismatch");
    }
    expected = { mint: batch.reward_mint, treasury: expectedWorkerTreasury,
      inputAmountLamports: batch.input_amount_atomic, purchasedAmountAtomic: reportedOutput,
      anchorSettlementId: batch.anchor_settlement_id };
  } else if (job.job_type === "solana_reward_purchase") {
    const [row, setting] = await Promise.all([
      database.prepare(`
        SELECT step.settlement_id, step.state AS step_state, step.idempotency_key,
          step.input_amount_atomic, s.reward_amount_atomic, s.reward_spent_atomic,
          f.launch_id, l.mainnet_mint,
          l.mainnet_reward_treasury, l.reward_chain, l.reward_symbol, l.reward_mint,
          l.status AS launch_status
        FROM settlement_steps step JOIN settlements s ON s.id = step.settlement_id
        JOIN fee_events f ON f.id = s.fee_event_id
        JOIN launch_drafts l ON l.id = f.launch_id
        WHERE step.id = ?1 AND step.stage = 'automatic_reward_chunk'
          AND s.reward_swap_signature IS NULL
          AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
      `).bind(job.entity_id).first<{
        settlement_id: string; step_state: string; idempotency_key: string;
        input_amount_atomic: string; reward_amount_atomic: string; reward_spent_atomic: string;
        launch_id: string; mainnet_mint: string | null;
        mainnet_reward_treasury: string | null; reward_chain: string;
        reward_symbol: string; reward_mint: string | null; launch_status: string;
      }>(),
      database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
        .first<{ value: string }>(),
    ]);
    const asset = row && getRewardOption("solana", row.reward_symbol);
    const platformMint = setting?.value ?? config.sportpadMint ?? null;
    const chunk = row && planAutomaticRewardChunk(row.reward_amount_atomic, row.reward_spent_atomic);
    if (!row || !asset || !chunk || job.entity_type !== "settlement_step" ||
      row.step_state !== "planned" || row.idempotency_key !==
        automaticRewardChunkKey(row.settlement_id, chunk.offsetAtomic) ||
      row.input_amount_atomic !== chunk.inputAmountLamports ||
      row.reward_chain !== "solana" || asset.tokenAddress !== row.reward_mint ||
      !row.mainnet_mint || (platformMint && row.mainnet_mint === platformMint) ||
      row.mainnet_reward_treasury !== config.rewardTreasury ||
      !["mainnet_published", "mainnet_suspended"].includes(row.launch_status) ||
      payload.settlementId !== row.settlement_id || payload.stepId !== job.entity_id ||
      payload.launchId !== row.launch_id ||
      payload.rewardAmountLamports !== chunk.inputAmountLamports ||
      payload.rewardTotalLamports !== row.reward_amount_atomic ||
      payload.chunkOffsetAtomic !== chunk.offsetAtomic ||
      payload.rewardSymbol !== row.reward_symbol || payload.rewardMint !== row.reward_mint ||
      !reportedOutput || sourceTxHash ||
      (config.sportpadMint && setting?.value && config.sportpadMint !== setting.value)) {
      throw new Error("solana_reward_job_snapshot_mismatch");
    }
    expected = { mint: row.reward_mint, treasury: expectedWorkerTreasury,
      inputAmountLamports: chunk.inputAmountLamports, purchasedAmountAtomic: reportedOutput };
  } else if (job.job_type === "sportpad_buyback_burn") {
    const [row, setting] = await Promise.all([
      database.prepare(`
        SELECT step.settlement_id, step.state AS step_state, step.idempotency_key,
          step.input_amount_atomic, step.output_amount_atomic, step.output_mint,
          step.tx_signature, s.buyback_amount_atomic, s.buyback_spent_atomic,
          s.buyback_swap_signature, s.burn_signature, f.launch_id,
          l.mainnet_mint, l.mainnet_buyback_treasury, l.status AS launch_status
        FROM settlement_steps step JOIN settlements s ON s.id = step.settlement_id
        JOIN fee_events f ON f.id = s.fee_event_id
        JOIN launch_drafts l ON l.id = f.launch_id
        WHERE step.id = ?1 AND step.stage = 'automatic_buyback_chunk'
          AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
          AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
      `).bind(job.entity_id).first<{
        settlement_id: string; step_state: string; idempotency_key: string;
        input_amount_atomic: string; output_amount_atomic: string | null;
        output_mint: string | null; tx_signature: string | null;
        buyback_amount_atomic: string; buyback_spent_atomic: string;
        buyback_swap_signature: string | null;
        burn_signature: string | null; launch_id: string; mainnet_mint: string | null;
        mainnet_buyback_treasury: string | null; launch_status: string;
      }>(),
      database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
        .first<{ value: string }>(),
    ]);
    const chunk = row && planAutomaticBuybackChunk(row.buyback_amount_atomic, row.buyback_spent_atomic);
    if (!row || !chunk || !setting?.value || !sourceTxHash || !reportedOutput ||
      job.entity_type !== "settlement_step" || row.step_state !== "swap_verified" ||
      row.idempotency_key !== automaticBuybackChunkKey(row.settlement_id, chunk.offsetAtomic) ||
      row.input_amount_atomic !== chunk.inputAmountLamports ||
      row.output_amount_atomic !== reportedOutput || row.output_mint !== setting.value ||
      row.tx_signature !== sourceTxHash ||
      !row.mainnet_mint || row.mainnet_mint === setting.value ||
      row.mainnet_buyback_treasury !== config.buybackTreasury ||
      !["mainnet_published", "mainnet_suspended"].includes(row.launch_status) ||
      payload.settlementId !== row.settlement_id || payload.stepId !== job.entity_id ||
      payload.launchId !== row.launch_id ||
      payload.amountLamports !== chunk.inputAmountLamports ||
      payload.buybackTotalLamports !== row.buyback_amount_atomic ||
      payload.chunkOffsetAtomic !== chunk.offsetAtomic ||
      payload.sportpadMint !== setting.value ||
      (config.sportpadMint && config.sportpadMint !== setting.value)) {
      throw new Error("solana_buyback_job_snapshot_mismatch");
    }
    expected = { mint: setting.value, treasury: expectedWorkerTreasury,
      inputAmountLamports: chunk.inputAmountLamports, purchasedAmountAtomic: reportedOutput };
  } else {
    throw new Error("solana_job_type_invalid");
  }
  const rpc = getMainnetConnection();
  const mint = new PublicKey(expected.mint);
  const mintAccount = await rpc.getAccountInfo(mint, "finalized");
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
    !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) {
    throw new Error("solana_reward_or_sportpad_mint_unverified");
  }
  const mintState = await getMint(rpc, mint, "finalized", mintAccount.owner);
  const loadEvidence = async (signature: string) => {
    const [receipt, statuses] = await Promise.all([
      rpc.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    ]);
    return { signature, receipt, status: statuses.value[0] ?? null };
  };
  if (job.job_type === "solana_claim_payout") {
    const payout = await loadEvidence(txHash);
    verifySolanaClaimPayoutReceipt({
      ...payout,
      mint: expected.mint, tokenProgram: mintAccount.owner.toBase58(), decimals: mintState.decimals,
      treasury: expected.treasury, recipient: expected.recipient!, amountAtomic: expected.amountAtomic!,
    });
    const intent = await database.prepare(`
      SELECT idempotency_key, claim_id, signer_role, signer_address, action, state,
        expected_programs_json, expected_mints_json, maximum_spend_lamports,
        provider_request_id, unsigned_transaction_base64, transaction_message_hash,
        last_valid_block_height, claim_history_anchor_signature,
        input_mint, input_amount_atomic, tx_signature
      FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
    `).bind(`automation:claim:payout:${job.id}:${job.attempt}`)
      .first<PersistedAutomaticClaimIntent>();
    await verifyPersistedAutomaticClaimIntent({ intent, expected: {
      claimId: job.entity_id, jobId: job.id, attempt: job.attempt,
      signature: txHash, treasury: expected.treasury, mint: expected.mint,
      recipient: expected.recipient!, amountAtomic: expected.amountAtomic!,
      decimals: mintState.decimals, tokenProgram: mintAccount.owner.toBase58(),
    }, receipt: payout.receipt, status: payout.status });
    return undefined;
  }
  if (job.job_type === "solana_reward_purchase") {
    const intentKey = job.entity_type === "reward_swap_batch"
      ? rewardBatchIntentKey(job.entity_id) : `automation:reward:swap:${job.entity_id}`;
    const intent = await database.prepare(`
      SELECT idempotency_key, settlement_id, reward_batch_id,
        signer_role, signer_address, action, state,
        provider_request_id, unsigned_transaction_base64, transaction_message_hash,
        tx_signature, input_mint, output_mint, input_amount_atomic,
        minimum_output_atomic, maximum_spend_lamports, expected_mints_json,
        expected_programs_json
      FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
    `).bind(intentKey).first<PersistedAutomaticBuybackIntent>();
    if (!intent?.minimum_output_atomic) throw new Error("solana_reward_intent_missing");
    const swap = await loadEvidence(txHash);
    const verified = verifySolanaRewardPurchaseReceipt({
      ...swap, mint: expected.mint, tokenProgram: mintAccount.owner.toBase58(),
      decimals: mintState.decimals, treasury: expected.treasury,
      inputAmountLamports: expected.inputAmountLamports!,
      purchasedAmountAtomic: expected.purchasedAmountAtomic!,
      minimumOutputAtomic: intent.minimum_output_atomic,
    });
    if (job.entity_type === "reward_swap_batch") {
      await verifyPersistedAutomaticRewardBatchIntent({ intent,
        expected: { settlementId: expected.anchorSettlementId!, batchId: job.entity_id,
          treasury: expected.treasury, rewardMint: expected.mint,
          inputAmountLamports: expected.inputAmountLamports!,
          purchasedAmountAtomic: verified.purchasedAmountAtomic, swapSignature: txHash },
        swapReceipt: swap.receipt, swapStatus: swap.status });
    } else {
      const purchasePayload = payload as { settlementId: string };
      await verifyPersistedAutomaticRewardChunkIntent({
        intent,
        expected: { settlementId: purchasePayload.settlementId, stepId: job.entity_id,
          treasury: expected.treasury,
          rewardMint: expected.mint, inputAmountLamports: expected.inputAmountLamports!,
          purchasedAmountAtomic: verified.purchasedAmountAtomic, swapSignature: txHash },
        swapReceipt: swap.receipt,
        swapStatus: swap.status,
      });
    }
    return { outputAmountAtomic: verified.purchasedAmountAtomic, verifiedSlot: verified.swapSlot };
  }
  const [swap, burn] = await Promise.all([loadEvidence(sourceTxHash!), loadEvidence(txHash)]);
  const verified = verifySportpadBuybackReceipts({
    swap, burn, mint: expected.mint, tokenProgram: mintAccount.owner.toBase58(),
    decimals: mintState.decimals, treasury: expected.treasury,
    inputAmountLamports: expected.inputAmountLamports!,
    purchasedAmountAtomic: expected.purchasedAmountAtomic!,
  });
  const intent = await database.prepare(`
    SELECT idempotency_key, settlement_id, signer_role, signer_address, action, state,
      provider_request_id, unsigned_transaction_base64, transaction_message_hash,
      tx_signature, input_mint, output_mint, input_amount_atomic,
      minimum_output_atomic, maximum_spend_lamports, expected_mints_json,
      expected_programs_json
    FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
  `).bind(`automation:buyback:swap:${job.entity_id}`).first<PersistedAutomaticBuybackIntent>();
  await verifyPersistedAutomaticBuybackChunkIntent({
    intent,
    expected: { settlementId: payload.settlementId as string, stepId: job.entity_id,
      treasury: expected.treasury,
      sportpadMint: expected.mint, inputAmountLamports: expected.inputAmountLamports!,
      purchasedAmountAtomic: verified.boughtAndBurnedAtomic, swapSignature: sourceTxHash! },
    swapReceipt: swap.receipt,
    swapStatus: swap.status,
  });
  const burnIntent = await database.prepare(`
    SELECT idempotency_key, settlement_id, signer_role, signer_address, action, state,
      expected_programs_json, expected_mints_json, maximum_spend_lamports,
      provider_request_id, unsigned_transaction_base64, transaction_message_hash,
      last_valid_block_height, input_mint, input_amount_atomic, tx_signature
    FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
  `).bind(`automation:buyback:burn:${job.entity_id}`).first<PersistedAutomaticBurnIntent>();
  await verifyPersistedAutomaticBuybackBurnIntent({ intent: burnIntent, expected: {
    settlementId: payload.settlementId as string, stepId: job.entity_id,
    signature: txHash, treasury: expected.treasury, mint: expected.mint,
    amountAtomic: verified.boughtAndBurnedAtomic, decimals: mintState.decimals,
    tokenProgram: mintAccount.owner.toBase58(),
  }, receipt: burn.receipt, status: burn.status });
  return verified.boughtAndBurnedAtomic;
}

async function verifiedBuybackSwap(database: D1Database, job: AutomationRow,
  workerId: string, signature: string, claimedAmount?: string) {
  const config = readMainnetConfig();
  if (!config.buybackTreasury || workerId !== `solana:${config.buybackTreasury}` ||
    job.job_type !== "sportpad_buyback_burn" || job.entity_type !== "settlement_step" ||
    job.chain !== "solana") throw new Error("buyback_swap_worker_mismatch");
  const [step, setting, intent] = await Promise.all([
    database.prepare(`
      SELECT step.settlement_id, step.state AS step_state, step.idempotency_key,
        step.input_amount_atomic, step.output_amount_atomic, step.output_mint,
        step.tx_signature, step.verified_slot,
        s.buyback_amount_atomic, s.buyback_spent_atomic, s.state AS settlement_state,
        f.launch_id, l.status AS launch_status, l.mainnet_mint,
        l.mainnet_buyback_treasury
      FROM settlement_steps step JOIN settlements s ON s.id = step.settlement_id
      JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE step.id = ?1 AND step.stage = 'automatic_buyback_chunk'
        AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
    `).bind(job.entity_id).first<{
      settlement_id: string; step_state: string; idempotency_key: string;
      input_amount_atomic: string; output_amount_atomic: string | null;
      output_mint: string | null; tx_signature: string | null; verified_slot: number | null;
      buyback_amount_atomic: string; buyback_spent_atomic: string; settlement_state: string;
      launch_id: string; launch_status: string; mainnet_mint: string | null;
      mainnet_buyback_treasury: string | null;
    }>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
    database.prepare(`
      SELECT idempotency_key, settlement_id, signer_role, signer_address, action, state,
        provider_request_id, unsigned_transaction_base64, transaction_message_hash,
        tx_signature, input_mint, output_mint, input_amount_atomic,
        minimum_output_atomic, maximum_spend_lamports, expected_mints_json,
        expected_programs_json
      FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
    `).bind(`automation:buyback:swap:${job.entity_id}`).first<PersistedAutomaticBuybackIntent>(),
  ]);
  const chunk = step && planAutomaticBuybackChunk(step.buyback_amount_atomic, step.buyback_spent_atomic);
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  if (!step || !chunk || !setting?.value || !intent?.minimum_output_atomic ||
    !["planned", "swap_verified"].includes(step.step_state) ||
    !["reconciled", "distributed", "reward_acquired"].includes(step.settlement_state) ||
    !["mainnet_published", "mainnet_suspended"].includes(step.launch_status) ||
    !step.mainnet_mint || step.mainnet_mint === setting.value ||
    step.mainnet_buyback_treasury !== config.buybackTreasury ||
    (config.sportpadMint && config.sportpadMint !== setting.value) ||
    step.idempotency_key !== automaticBuybackChunkKey(step.settlement_id, chunk.offsetAtomic) ||
    step.input_amount_atomic !== chunk.inputAmountLamports || step.output_mint !== setting.value ||
    payload.settlementId !== step.settlement_id || payload.stepId !== job.entity_id ||
    payload.launchId !== step.launch_id || payload.sportpadMint !== setting.value ||
    payload.amountLamports !== chunk.inputAmountLamports ||
    payload.buybackTotalLamports !== step.buyback_amount_atomic ||
    payload.chunkOffsetAtomic !== chunk.offsetAtomic || intent.tx_signature !== signature) {
    throw new Error("buyback_swap_chunk_snapshot_mismatch");
  }
  const rpc = getMainnetConnection();
  const mint = new PublicKey(setting.value);
  const mintAccount = await rpc.getAccountInfo(mint, "finalized");
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
    !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error("buyback_mint_invalid");
  const mintState = await getMint(rpc, mint, "finalized", mintAccount.owner);
  const [receipt, statuses] = await Promise.all([
    rpc.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
    rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }),
  ]);
  const status = statuses.value[0] ?? null;
  const purchased = observedSolanaRewardPurchaseOutput({ signature, receipt, status,
    mint: setting.value, tokenProgram: mintAccount.owner.toBase58(),
    decimals: mintState.decimals, treasury: config.buybackTreasury });
  if (claimedAmount && claimedAmount !== purchased) throw new Error("buyback_swap_reported_output_mismatch");
  const verified = verifySolanaRewardPurchaseReceipt({ signature, receipt, status,
    mint: setting.value, tokenProgram: mintAccount.owner.toBase58(),
    decimals: mintState.decimals, treasury: config.buybackTreasury,
    inputAmountLamports: chunk.inputAmountLamports, purchasedAmountAtomic: purchased,
    minimumOutputAtomic: intent.minimum_output_atomic });
  await verifyPersistedAutomaticBuybackChunkIntent({ intent, expected: {
    settlementId: step.settlement_id, stepId: job.entity_id,
    treasury: config.buybackTreasury, sportpadMint: setting.value,
    inputAmountLamports: chunk.inputAmountLamports,
    purchasedAmountAtomic: verified.purchasedAmountAtomic, swapSignature: signature,
  }, swapReceipt: receipt, swapStatus: status });
  if (step.step_state === "swap_verified" &&
    (step.tx_signature !== signature || step.output_amount_atomic !== purchased ||
      step.verified_slot !== verified.swapSlot || intent.state !== "confirmed")) {
    throw new Error("buyback_swap_recorded_output_mismatch");
  }
  return { step, chunk, payload, amountAtomic: purchased,
    slot: verified.swapSlot, mint: setting.value, tokenProgram: mintAccount.owner.toBase58(),
    decimals: mintState.decimals };
}

async function recordVerifiedBuybackSwap(database: D1Database, job: AutomationRow,
  workerId: string, signature: string, amountAtomic?: string) {
  const verified = await verifiedBuybackSwap(database, job, workerId, signature, amountAtomic);
  if (verified.step.step_state === "swap_verified") return verified;
  await database.batch([
    database.prepare(CONFIRM_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL).bind(
      `automation:buyback:swap:${job.entity_id}`, verified.step.settlement_id, signature),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    database.prepare(RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL).bind(
      job.entity_id, signature, verified.amountAtomic, verified.slot,
      verified.chunk.inputAmountLamports, verified.mint, job.id,
      `automation:buyback:swap:${job.entity_id}`),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
  ]);
  return verified;
}

async function swapFeeAnchor(database: D1Database, entityType: string, entityId: string) {
  const row = entityType === "reward_swap_batch"
    ? await database.prepare(`
        SELECT f.source_signature, f.source_slot FROM reward_swap_batch_sources src
        JOIN settlements s ON s.id = src.settlement_id
        JOIN fee_events f ON f.id = s.fee_event_id
        WHERE src.batch_id = ?1 AND src.state = 'reserved' AND f.state = 'reconciled'
        ORDER BY f.source_slot DESC, f.source_signature DESC LIMIT 1
      `).bind(entityId).first<{ source_signature: string; source_slot: number }>()
    : await database.prepare(`
        SELECT f.source_signature, f.source_slot FROM settlement_steps step
        JOIN settlements s ON s.id = step.settlement_id
        JOIN fee_events f ON f.id = s.fee_event_id
        WHERE step.id = ?1 AND step.state = 'planned' AND f.state = 'reconciled'
        LIMIT 1
      `).bind(entityId).first<{ source_signature: string; source_slot: number }>();
  if (!row?.source_signature || !Number.isSafeInteger(row.source_slot) ||
    row.source_slot <= 0) throw new Error("swap_fee_anchor_unavailable");
  return row;
}

async function provePersistedSwapExpired(database: D1Database,
  entityType: string, entityId: string, treasury: string,
  prepared: { txSignature: string; blockhash: string; lastValidBlockHeight: number }) {
  const anchor = await swapFeeAnchor(database, entityType, entityId);
  await proveExpiredSwapAbsent(getMainnetConnection(), {
    treasury: new PublicKey(treasury),
    sourceFeeSignature: anchor.source_signature, sourceFeeSlot: anchor.source_slot,
    swapSignature: prepared.txSignature, swapBlockhash: prepared.blockhash,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
  });
}

async function proveFailedRewardBatchForRetry(database: D1Database, job: AutomationRow,
  intent: PersistedAutomaticBuybackIntent | null, treasury: string,
  evidence: Pick<Parameters<typeof proveFinalizedFailedRewardSwap>[0], "receipt" | "status">) {
  if (job.job_type !== "solana_reward_purchase" || job.entity_type !== "reward_swap_batch" ||
    job.chain !== "solana" || job.tx_hash !== null) {
    throw new Error("reward_batch_failure_job_invalid");
  }
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  const canonicalKey = rewardBatchIntentKey(job.entity_id);
  const batch = await database.prepare(`
    SELECT b.input_amount_atomic, b.reward_mint, b.treasury,
      b.launch_id, b.state, b.tx_signature, l.reward_symbol,
      l.reward_chain, l.mainnet_reward_treasury, l.status AS launch_status,
      (SELECT COUNT(*) FROM reward_swap_batch_sources src
        WHERE src.batch_id = b.id) AS source_count,
      (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER)) FROM reward_swap_batch_sources src
        WHERE src.batch_id = b.id AND src.state = 'reserved') AS source_sum,
      (SELECT COUNT(*) FROM reward_swap_batch_sources src
        LEFT JOIN settlements s ON s.id = src.settlement_id
        WHERE src.batch_id = b.id AND (src.state <> 'reserved'
          OR src.verified_signature IS NOT NULL OR s.id IS NULL
          OR s.reward_spent_atomic <> src.offset_atomic
          OR s.reward_amount_atomic <> src.total_atomic
          OR s.reward_swap_signature IS NOT NULL
          OR s.state NOT IN ('reconciled', 'distributed', 'buyback_burned'))) AS changed_count,
      (SELECT COUNT(*) FROM transaction_intents prior
        WHERE prior.idempotency_key LIKE ?2 || ':failed:%') AS failed_predecessors,
      (SELECT COUNT(*) FROM solana_reward_purchase_canary c
        WHERE c.reward_batch_id = b.id) AS canary_reservations
    FROM reward_swap_batches b JOIN launch_drafts l ON l.id = b.launch_id
    WHERE b.id = ?1
  `).bind(job.entity_id, canonicalKey).first<{
    input_amount_atomic: string; reward_mint: string; treasury: string;
    launch_id: string; state: string; tx_signature: string | null;
    reward_symbol: string; reward_chain: string; mainnet_reward_treasury: string | null;
    launch_status: string; source_count: number; source_sum: number | null;
    changed_count: number; failed_predecessors: number; canary_reservations: number;
  }>();
  const inputAmount = batch && /^[1-9][0-9]*$/.test(batch.input_amount_atomic)
    ? BigInt(batch.input_amount_atomic) : 0n;
  if (!batch || inputAmount < 1_000_000n || inputAmount > 100_000_000n ||
    batch.state !== "broadcasting" || batch.tx_signature !== null ||
    batch.treasury !== treasury || batch.mainnet_reward_treasury !== treasury ||
    batch.reward_chain !== "solana" || batch.launch_status !== "mainnet_published" ||
    getRewardOption("solana", batch.reward_symbol)?.tokenAddress !== batch.reward_mint ||
    batch.source_count < 1 || batch.source_sum?.toString() !== batch.input_amount_atomic ||
    batch.changed_count !== 0 || batch.failed_predecessors !== 0 ||
    batch.canary_reservations !== 0 ||
    payload.batchId !== job.entity_id || payload.launchId !== batch.launch_id ||
    payload.rewardMint !== batch.reward_mint || payload.rewardSymbol !== batch.reward_symbol ||
    payload.rewardAmountLamports !== batch.input_amount_atomic ||
    intent?.idempotency_key !== canonicalKey || intent.reward_batch_id !== job.entity_id) {
    throw new Error("reward_batch_failure_snapshot_mismatch_or_retry_exhausted");
  }
  const rpc = getMainnetConnection();
  const mint = new PublicKey(batch.reward_mint);
  const mintAccount = await rpc.getAccountInfo(mint, "finalized");
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
    !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) {
    throw new Error("reward_batch_failure_mint_unverified");
  }
  const mintState = await getMint(rpc, mint, "finalized", mintAccount.owner);
  return proveFinalizedFailedRewardSwap({
    intent, expected: { idempotencyKey: canonicalKey, treasury,
      rewardMint: batch.reward_mint, inputAmountLamports: batch.input_amount_atomic,
      rewardBatchId: job.entity_id, tokenProgram: mintAccount.owner.toBase58(),
      decimals: mintState.decimals }, ...evidence,
  });
}

async function replacementSwapArchive(database: D1Database, job: AutomationRow,
  options: {
    canonicalKey: string; replacesSignature: string | undefined;
    newSignature: string; treasury: string; outputMint: string;
    inputAmountLamports: string; settlementId?: string;
  }): Promise<D1PreparedStatement | null> {
  if (!options.replacesSignature) return null;
  if (job.state !== "broadcasting" || job.tx_hash ||
    options.replacesSignature === options.newSignature) {
    throw new Error("swap_replacement_job_or_signature_invalid");
  }
  const intent = await database.prepare(`
    SELECT idempotency_key, settlement_id, reward_batch_id, signer_role,
      signer_address, action, state, provider_request_id,
      unsigned_transaction_base64, transaction_message_hash,
      last_valid_block_height, tx_signature, input_mint, output_mint,
      input_amount_atomic, minimum_output_atomic, maximum_spend_lamports,
      expected_mints_json, expected_programs_json
    FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
  `).bind(options.canonicalKey).first<PersistedAutomaticBuybackIntent>();
  if (!intent || intent.tx_signature !== options.replacesSignature ||
    (options.settlementId && intent.settlement_id !== options.settlementId)) {
    throw new Error("swap_replacement_intent_mismatch");
  }
  const prepared = job.job_type === "sportpad_buyback_burn"
    ? await inspectPersistedPreparedBuybackSwap(intent, {
        settlementId: options.settlementId!, stepId: job.entity_id,
        treasury: options.treasury, sportpadMint: options.outputMint,
        inputAmountLamports: options.inputAmountLamports,
      })
    : await inspectPersistedPreparedRewardSwap(intent, {
        idempotencyKey: options.canonicalKey, treasury: options.treasury,
        rewardMint: options.outputMint, inputAmountLamports: options.inputAmountLamports,
        rewardBatchId: job.entity_type === "reward_swap_batch" ? job.entity_id : null,
      });
  if (prepared.txSignature !== options.replacesSignature ||
    !intent.transaction_message_hash) throw new Error("swap_replacement_message_mismatch");
  if (job.entity_type === "reward_swap_batch") {
    const rpc = getMainnetConnection();
    const [receipt, statuses] = await Promise.all([
      rpc.getTransaction(prepared.txSignature,
        { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      rpc.getSignatureStatuses([prepared.txSignature], { searchTransactionHistory: true }),
    ]);
    const status = statuses.value[0] ?? null;
    if (status?.err != null || receipt?.meta?.err != null) {
      const proof = await proveFailedRewardBatchForRetry(database, job, intent,
        options.treasury, { receipt, status });
      return database.prepare(ARCHIVE_FINALIZED_FAILED_REWARD_BATCH_INTENT_SQL).bind(
        options.canonicalKey, proof.signature, intent.transaction_message_hash,
        options.treasury, job.id, job.entity_id,
        `broadcasting:solana:${options.treasury}`, proof.feeLamports, proof.slot.toString(),
      );
    }
  }
  await provePersistedSwapExpired(database, job.entity_type, job.entity_id,
    options.treasury, prepared);
  return database.prepare(ARCHIVE_EXPIRED_SWAP_INTENT_SQL).bind(
    options.canonicalKey, options.replacesSignature, intent.transaction_message_hash,
    options.treasury, intent.action, job.id, job.entity_type, job.entity_id,
    job.job_type, `broadcasting:solana:${options.treasury}`,
  );
}

async function reconcilePreparedBuyback(database: D1Database, workerId: string,
  mayBroadcast: boolean) {
  const config = readMainnetConfig();
  if (!config.buybackTreasury || workerId !== `solana:${config.buybackTreasury}`) {
    throw new Error("buyback_reconciliation_worker_mismatch");
  }
  const row = await database.prepare(`
    SELECT j.id, j.job_type, j.entity_type, j.entity_id, j.chain,
      j.payload_json, j.state, j.attempt, j.leased_until, j.error_code, j.tx_hash,
      swap.tx_signature AS swap_signature,
      burn.tx_signature AS burn_signature,
      burn.unsigned_transaction_base64 AS burn_signed_base64,
      burn.last_valid_block_height AS burn_last_valid_height
    FROM automation_jobs j
    JOIN transaction_intents swap
      ON swap.idempotency_key = 'automation:buyback:swap:' || j.entity_id
    LEFT JOIN transaction_intents burn
      ON burn.idempotency_key = 'automation:buyback:burn:' || j.entity_id
    WHERE j.job_type = 'sportpad_buyback_burn' AND j.entity_type = 'settlement_step'
      AND j.chain = 'solana' AND j.state IN ('broadcasting', 'reconciliation_required')
      AND (j.state = 'reconciliation_required' OR j.error_code = ?1)
      AND j.available_at <= ?2
    ORDER BY j.updated_at ASC LIMIT 1
  `).bind(`broadcasting:${workerId}`, Date.now()).first<AutomationRow & {
    swap_signature: string | null; burn_signature: string | null;
    burn_signed_base64: string | null; burn_last_valid_height: number | null;
  }>();
  if (!row) return { reconciled: false };
  const defer = async () => database.prepare(`
    UPDATE automation_jobs SET available_at = ?2
    WHERE id = ?1 AND state IN ('broadcasting', 'reconciliation_required')
  `).bind(row.id, Date.now() + 30_000).run();
  try {
    if (!row.swap_signature) throw new Error("buyback_recovery_swap_intent_invalid");
    if (!row.burn_signature) {
      const rpc = getMainnetConnection();
      const [receipt, statuses] = await Promise.all([
        rpc.getTransaction(row.swap_signature,
          { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
        rpc.getSignatureStatuses([row.swap_signature], { searchTransactionHistory: true }),
      ]);
      if (!receipt && !statuses.value[0]) {
        if (!mayBroadcast) {
          await defer();
          return { reconciled: false };
        }
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        const [step, intent] = await Promise.all([
          database.prepare(`
            SELECT settlement_id, input_amount_atomic, output_mint, state
            FROM settlement_steps WHERE id = ?1 AND stage = 'automatic_buyback_chunk'
          `).bind(row.entity_id).first<{ settlement_id: string;
            input_amount_atomic: string; output_mint: string; state: string }>(),
          database.prepare(`
            SELECT idempotency_key, settlement_id, signer_role, signer_address, action, state,
              provider_request_id, unsigned_transaction_base64, transaction_message_hash,
              last_valid_block_height, tx_signature, input_mint, output_mint,
              input_amount_atomic, minimum_output_atomic, maximum_spend_lamports,
              expected_mints_json, expected_programs_json
            FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
          `).bind(`automation:buyback:swap:${row.entity_id}`)
            .first<PersistedAutomaticBuybackIntent>(),
        ]);
        if (!step || step.state !== "planned" ||
          payload.stepId !== row.entity_id || payload.settlementId !== step.settlement_id ||
          payload.amountLamports !== step.input_amount_atomic ||
          payload.sportpadMint !== step.output_mint) {
          throw new Error("buyback_recovery_swap_step_mismatch");
        }
        const prepared = await inspectPersistedPreparedBuybackSwap(intent, {
          settlementId: step.settlement_id, stepId: row.entity_id,
          treasury: config.buybackTreasury, sportpadMint: step.output_mint,
          inputAmountLamports: step.input_amount_atomic,
        });
        const currentHeight = await rpc.getBlockHeight("finalized");
        if (currentHeight > prepared.lastValidBlockHeight ||
          !(await rpc.isBlockhashValid(prepared.blockhash,
            { commitment: "confirmed" })).value) {
          await provePersistedSwapExpired(database, row.entity_type, row.entity_id,
            config.buybackTreasury, prepared);
          if (row.tx_hash) throw new Error("buyback_recovery_swap_hash_ambiguous");
          if (row.state === "reconciliation_required") {
            const reset = await database.prepare(`
              UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?1 AND state = 'reconciliation_required' AND tx_hash IS NULL
            `).bind(row.id, `broadcasting:${workerId}`).run();
            if (reset.meta.changes !== 1) throw new Error("buyback_recovery_swap_rearm_conflict");
          }
          await defer();
          return { reconciled: false, swapRequired: {
            jobId: row.id, payload, replacesSwapSignature: prepared.txSignature,
          } };
        }
        if (row.state === "reconciliation_required") {
          const reset = await database.prepare(`
            UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?1 AND state = 'reconciliation_required' AND tx_hash IS NULL
          `).bind(row.id, `broadcasting:${workerId}`).run();
          if (reset.meta.changes !== 1) throw new Error("buyback_recovery_swap_rearm_conflict");
        }
        await defer();
        return { reconciled: false, swapPrepared: {
          jobId: row.id, payload,
          signature: prepared.txSignature,
          unsignedTransactionBase64: prepared.unsignedTransactionBase64,
          providerRequestId: prepared.providerRequestId,
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        } };
      }
    }
    const swap = await recordVerifiedBuybackSwap(database, row, workerId, row.swap_signature);
    if (!row.burn_signature) {
      if (!mayBroadcast) {
        await defer();
        return { reconciled: false };
      }
      if (row.tx_hash) throw new Error("buyback_recovery_burn_hash_without_intent");
      if (row.state === "reconciliation_required") {
        const reset = await database.prepare(`
          UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND state = 'reconciliation_required' AND tx_hash IS NULL
            AND NOT EXISTS (SELECT 1 FROM transaction_intents i
              WHERE i.idempotency_key = 'automation:buyback:burn:' || automation_jobs.entity_id)
        `).bind(row.id, `broadcasting:${workerId}`).run();
        if (reset.meta.changes !== 1) throw new Error("buyback_recovery_rearm_conflict");
      }
      await defer();
      return { reconciled: false, burnRequired: {
        jobId: row.id, payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        sourceTxHash: row.swap_signature, purchasedAmountAtomic: swap.amountAtomic,
      } };
    }
    if (!row.burn_signed_base64 || !Number.isSafeInteger(row.burn_last_valid_height) ||
      !row.burn_last_valid_height) throw new Error("buyback_recovery_burn_intent_invalid");
    const inspected = await inspectPreparedAutomaticBuybackBurn(row.burn_signed_base64, {
      treasury: config.buybackTreasury, mint: swap.mint,
      amountAtomic: swap.amountAtomic, decimals: swap.decimals,
      tokenProgram: swap.tokenProgram,
    });
    if (inspected.txSignature !== row.burn_signature ||
      (row.tx_hash && row.tx_hash !== row.burn_signature)) {
      throw new Error("buyback_recovery_burn_signature_mismatch");
    }
    const rpc = getMainnetConnection();
    const [receipt, statuses] = await Promise.all([
      rpc.getTransaction(row.burn_signature,
        { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      rpc.getSignatureStatuses([row.burn_signature], { searchTransactionHistory: true }),
    ]);
    const status = statuses.value[0] ?? null;
    if (receipt && status?.confirmationStatus === "finalized" && status.err === null) {
      const verified = await verifiedSolanaOutput(database, row, workerId,
        row.burn_signature, row.swap_signature, swap.amountAtomic);
      if (typeof verified !== "string") throw new Error("buyback_recovery_output_invalid");
      await completeJob(database, row, workerId, row.burn_signature,
        verified, row.swap_signature);
      return { reconciled: true };
    }
    if (status?.err || status?.confirmationStatus === "finalized" || receipt?.meta?.err) {
      throw new Error("buyback_recovery_burn_failed_or_ambiguous");
    }
    if (!mayBroadcast) {
      await defer();
      return { reconciled: false };
    }
    const currentHeight = await rpc.getBlockHeight("finalized");
    if (currentHeight > row.burn_last_valid_height) {
      await proveExpiredBuybackBurnAbsent(rpc, {
        sourceAta: getAssociatedTokenAddressSync(new PublicKey(swap.mint),
          new PublicKey(config.buybackTreasury), false, new PublicKey(swap.tokenProgram)),
        sourceSwapSignature: row.swap_signature,
        burnSignature: row.burn_signature,
        burnBlockhash: inspected.blockhash,
        lastValidBlockHeight: row.burn_last_valid_height,
      });
      if (row.state === "reconciliation_required") {
        const reset = await database.prepare(`
          UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND state = 'reconciliation_required'
            AND (tx_hash IS NULL OR tx_hash = ?3)
        `).bind(row.id, `broadcasting:${workerId}`, row.burn_signature).run();
        if (reset.meta.changes !== 1) throw new Error("buyback_recovery_rearm_conflict");
      }
      await defer();
      return { reconciled: false, burnRequired: {
        jobId: row.id, payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        sourceTxHash: row.swap_signature, purchasedAmountAtomic: swap.amountAtomic,
        replacesBurnSignature: row.burn_signature,
      } };
    }
    if (row.state === "reconciliation_required") {
      const reset = await database.prepare(`
        UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'reconciliation_required'
          AND (tx_hash IS NULL OR tx_hash = ?3)
      `).bind(row.id, `broadcasting:${workerId}`, row.burn_signature).run();
      if (reset.meta.changes !== 1) throw new Error("buyback_recovery_rearm_conflict");
    }
    await defer();
    return { reconciled: false, burnPrepared: {
      jobId: row.id, payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      sourceTxHash: row.swap_signature, purchasedAmountAtomic: swap.amountAtomic,
      burnSignature: row.burn_signature, signedTransactionBase64: row.burn_signed_base64,
      lastValidBlockHeight: row.burn_last_valid_height,
    } };
  } catch (error) {
    console.error("buyback_reconciliation_pending",
      error instanceof Error ? error.message : "unknown");
    await defer();
    return { reconciled: false };
  }
}

async function reconcilePreparedSolanaPurchase(database: D1Database, workerId: string,
  mayBroadcast: boolean) {
  const config = readMainnetConfig();
  if (!config.rewardTreasury || workerId !== `solana:${config.rewardTreasury}`) {
    throw new Error("reward_reconciliation_worker_mismatch");
  }
  const row = await database.prepare(`
    SELECT j.id, j.job_type, j.entity_type, j.entity_id, j.chain,
      j.payload_json, j.state, j.attempt, j.leased_until, j.error_code,
      j.tx_hash, i.tx_signature AS prepared_signature
    FROM automation_jobs j JOIN transaction_intents i
      ON i.idempotency_key = CASE j.entity_type
        WHEN 'reward_swap_batch' THEN 'automation:reward:batch:' || j.entity_id
        ELSE 'automation:reward:swap:' || j.entity_id END
    WHERE j.job_type = 'solana_reward_purchase'
      AND j.entity_type IN ('settlement_step', 'reward_swap_batch')
      AND j.state IN ('broadcasting', 'reconciliation_required')
      AND i.tx_signature IS NOT NULL
      AND (j.state = 'reconciliation_required' OR j.error_code = ?1)
      AND (j.tx_hash IS NULL OR j.tx_hash = i.tx_signature)
      AND j.available_at <= ?2
    ORDER BY j.updated_at ASC LIMIT 1
  `).bind(`broadcasting:${workerId}`, Date.now())
    .first<AutomationRow & { prepared_signature: string }>();
  if (!row) return { reconciled: false };
  const defer = async () => database.prepare(`
    UPDATE automation_jobs SET available_at = ?2
    WHERE id = ?1 AND state IN ('broadcasting', 'reconciliation_required')
      AND (tx_hash IS NULL OR tx_hash = ?3)
  `).bind(row.id, Date.now() + 30_000, row.prepared_signature).run();
  try {
    const rpc = getMainnetConnection();
    const [receipt, statuses] = await Promise.all([
      rpc.getTransaction(row.prepared_signature,
        { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      rpc.getSignatureStatuses([row.prepared_signature], { searchTransactionHistory: true }),
    ]);
    const status = statuses.value[0] ?? null;
    if (row.entity_type === "reward_swap_batch" &&
      (status?.err != null || receipt?.meta?.err != null)) {
      if (!mayBroadcast) {
        await defer();
        return { reconciled: false };
      }
      const idempotencyKey = rewardBatchIntentKey(row.entity_id);
      const intent = await database.prepare(`
        SELECT idempotency_key, settlement_id, reward_batch_id, signer_role,
          signer_address, action, state, provider_request_id,
          unsigned_transaction_base64, transaction_message_hash,
          last_valid_block_height, tx_signature, input_mint, output_mint,
          input_amount_atomic, minimum_output_atomic, maximum_spend_lamports,
          expected_mints_json, expected_programs_json
        FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
      `).bind(idempotencyKey).first<PersistedAutomaticBuybackIntent>();
      const proof = await proveFailedRewardBatchForRetry(database, row, intent,
        config.rewardTreasury, { receipt, status });
      if (proof.signature !== row.prepared_signature) {
        throw new Error("reward_batch_failure_signature_mismatch");
      }
      const restored = await database.prepare(REARM_PROVEN_FAILED_REWARD_BATCH_JOB_SQL)
        .bind(row.id, `broadcasting:${workerId}`, Date.now() + 30_000,
        row.state, row.error_code, row.entity_id, idempotencyKey,
        row.prepared_signature).run();
      if (restored.meta.changes !== 1) throw new Error("reward_batch_failure_rearm_conflict");
      return { reconciled: false, orderRequired: {
        jobId: row.id, entityId: row.entity_id,
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        replacesSwapSignature: proof.signature,
      } };
    }
    if (!receipt || !status || status.confirmationStatus !== "finalized" ||
      status.err !== null) {
      // A pause blocks replay and replacement, but it cannot undo a finalized
      // swap. Keep inspecting later cycles for a landed receipt so inventory
      // can still be credited while the economic lane is paused.
      if (!mayBroadcast) {
        await defer();
        return { reconciled: false };
      }
      // The original signed message may have been persisted immediately
      // before a worker crash. Replay only that same signature while its
      // blockhash is live; an expired or ambiguous order stays held.
      if (status?.err || receipt?.meta?.err ||
        status?.confirmationStatus === "finalized" || receipt) {
        await defer();
        return { reconciled: false };
      }
      const idempotencyKey = row.entity_type === "reward_swap_batch"
        ? `automation:reward:batch:${row.entity_id}`
        : `automation:reward:swap:${row.entity_id}`;
      const intent = await database.prepare(`
        SELECT idempotency_key, settlement_id, reward_batch_id, signer_role,
          signer_address, action, state, provider_request_id,
          unsigned_transaction_base64, transaction_message_hash,
          last_valid_block_height, tx_signature, input_mint, output_mint,
          input_amount_atomic, minimum_output_atomic, maximum_spend_lamports,
          expected_mints_json, expected_programs_json
        FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
      `).bind(idempotencyKey).first<PersistedAutomaticBuybackIntent>();
      const payload = JSON.parse(row.payload_json) as {
        rewardMint?: string; rewardAmountLamports?: string;
      };
      if (!payload.rewardMint || !payload.rewardAmountLamports) {
        throw new Error("reward_recovery_payload_invalid");
      }
      const prepared = await inspectPersistedPreparedRewardSwap(intent, {
        idempotencyKey, treasury: config.rewardTreasury,
        rewardMint: payload.rewardMint,
        inputAmountLamports: payload.rewardAmountLamports,
        rewardBatchId: row.entity_type === "reward_swap_batch" ? row.entity_id : null,
      });
      if (prepared.txSignature !== row.prepared_signature ||
        (row.tx_hash && row.tx_hash !== prepared.txSignature)) {
        throw new Error("reward_recovery_signature_mismatch");
      }
      const height = await rpc.getBlockHeight("finalized");
      const valid = await rpc.isBlockhashValid(prepared.blockhash,
        { commitment: "confirmed" });
      if (height > prepared.lastValidBlockHeight || !valid.value) {
        await provePersistedSwapExpired(database, row.entity_type, row.entity_id,
          config.rewardTreasury, prepared);
        if (row.tx_hash) throw new Error("reward_recovery_swap_hash_ambiguous");
        if (row.state === "reconciliation_required") {
          const reset = await database.prepare(`
            UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?1 AND state = 'reconciliation_required' AND tx_hash IS NULL
          `).bind(row.id, `broadcasting:${workerId}`).run();
          if (reset.meta.changes !== 1) throw new Error("reward_recovery_rearm_conflict");
        }
        await defer();
        return { reconciled: false, orderRequired: {
          jobId: row.id, entityId: row.entity_id,
          payload: JSON.parse(row.payload_json) as Record<string, unknown>,
          replacesSwapSignature: prepared.txSignature,
        } };
      }
      await defer();
      return { reconciled: false, prepared: {
        jobId: row.id, signature: prepared.txSignature,
        unsignedTransactionBase64: prepared.unsignedTransactionBase64,
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      } };
    }
    const payload = JSON.parse(row.payload_json) as { rewardMint: string };
    const mint = new PublicKey(payload.rewardMint);
    const mintAccount = await rpc.getAccountInfo(mint, "finalized");
    if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
      !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) {
      await defer();
      return { reconciled: false };
    }
    const mintState = await getMint(rpc, mint, "finalized", mintAccount.owner);
    const output = observedSolanaRewardPurchaseOutput({
      signature: row.prepared_signature, receipt, status,
      mint: payload.rewardMint, tokenProgram: mintAccount.owner.toBase58(),
      decimals: mintState.decimals, treasury: config.rewardTreasury,
    });
    const verified = await verifiedSolanaOutput(database, row, workerId,
      row.prepared_signature, undefined, output);
    if (!verified || typeof verified !== "object") throw new Error("reward_reconciliation_output_missing");
    await completeJob(database, row, workerId, row.prepared_signature,
      verified.outputAmountAtomic, undefined, verified.verifiedSlot);
    return { reconciled: true };
  } catch (error) {
    // Never form a second purchase while the persisted signature is ambiguous.
    // A later recovery cycle retries only the same persisted signature while
    // it is still valid; expired or unprovable orders remain held.
    console.error("reward_purchase_reconciliation_pending",
      error instanceof Error ? error.message : "unknown");
    await defer();
    return { reconciled: false };
  }
}

type PrepareBuybackRequest = Extract<z.infer<typeof requestSchema>, { action: "prepare_buyback_swap" }>;

async function persistPreparedBuybackSwap(database: D1Database, job: AutomationRow, input: PrepareBuybackRequest) {
  if (!FINANCIAL_LEDGER_VERIFIED || !BUYBACK_BURN_EXECUTION_SAFE ||
    job.job_type !== "sportpad_buyback_burn" || job.entity_type !== "settlement_step" ||
    job.chain !== "solana") {
    throw new Error("buyback_automation_lane_closed");
  }
  const config = readMainnetConfig();
  if (!config.buybackTreasury || input.workerId !== `solana:${config.buybackTreasury}`) {
    throw new Error("buyback_worker_treasury_mismatch");
  }
  const [step, setting] = await Promise.all([
    database.prepare(`
      SELECT step.settlement_id, step.state AS step_state, step.idempotency_key,
        step.input_amount_atomic, step.output_mint,
        s.buyback_amount_atomic, s.buyback_spent_atomic, s.state, f.launch_id, l.mainnet_mint,
        l.mainnet_buyback_treasury, l.status AS launch_status
      FROM settlement_steps step JOIN settlements s ON s.id = step.settlement_id
      JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE step.id = ?1 AND step.stage = 'automatic_buyback_chunk'
        AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
    `).bind(job.entity_id).first<{
      settlement_id: string; step_state: string; idempotency_key: string;
      input_amount_atomic: string; output_mint: string | null;
      buyback_amount_atomic: string; buyback_spent_atomic: string;
      state: string; launch_id: string;
      mainnet_mint: string | null; mainnet_buyback_treasury: string | null;
      launch_status: string;
    }>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
  ]);
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  const chunk = step && planAutomaticBuybackChunk(step.buyback_amount_atomic, step.buyback_spent_atomic);
  if (!step || !chunk || !setting?.value || !step.mainnet_mint ||
    step.mainnet_mint === setting.value ||
    step.mainnet_buyback_treasury !== config.buybackTreasury ||
    step.launch_status !== "mainnet_published" || step.step_state !== "planned" ||
    step.idempotency_key !== automaticBuybackChunkKey(step.settlement_id, chunk.offsetAtomic) ||
    step.input_amount_atomic !== chunk.inputAmountLamports || step.output_mint !== setting.value ||
    !["reconciled", "distributed", "reward_acquired"].includes(step.state) ||
    payload.settlementId !== step.settlement_id || payload.stepId !== job.entity_id ||
    payload.launchId !== step.launch_id ||
    payload.sportpadMint !== setting.value || payload.amountLamports !== chunk.inputAmountLamports ||
    payload.buybackTotalLamports !== step.buyback_amount_atomic ||
    payload.chunkOffsetAtomic !== chunk.offsetAtomic ||
    input.outputMint !== setting.value || input.inputAmountLamports !== chunk.inputAmountLamports ||
    (config.sportpadMint && config.sportpadMint !== setting.value) ||
    BigInt(input.minimumOutputAtomic) > 18_446_744_073_709_551_615n) {
    throw new Error("buyback_order_job_snapshot_mismatch");
  }
  const controls = await readAutomationControls(database);
  if (!laneAllowsJob(job.job_type, controls)) throw new Error("buyback_automation_lane_paused");
  const currentHeight = await getMainnetConnection().getBlockHeight("confirmed");
  if (input.lastValidBlockHeight <= currentHeight || input.lastValidBlockHeight > currentHeight + 300) {
    throw new Error("buyback_order_blockhash_window_invalid");
  }
  const prepared = await inspectPreparedAutomaticBuybackOrder({
    unsignedTransactionBase64: input.unsignedTransactionBase64,
    signedTransactionBase64: input.signedTransactionBase64,
    treasury: config.buybackTreasury,
  });
  const intentId = crypto.randomUUID();
  const idempotencyKey = `automation:buyback:swap:${job.entity_id}`;
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  const archive = await replacementSwapArchive(database, job, {
    canonicalKey: idempotencyKey, replacesSignature: input.replacesSwapSignature,
    newSignature: prepared.txSignature, treasury: config.buybackTreasury,
    outputMint: setting.value, inputAmountLamports: input.inputAmountLamports,
    settlementId: step.settlement_id,
  });
  const insert = database.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_SWAP_INTENT_SQL).bind(
    intentId, idempotencyKey, step.settlement_id, config.buybackTreasury,
    JSON.stringify(["jupiter_v2_metis_pinned"]),
    JSON.stringify([NATIVE_MINT.toBase58(), setting.value]),
    input.inputAmountLamports, input.providerRequestId,
    input.unsignedTransactionBase64, prepared.transactionMessageHash,
    input.lastValidBlockHeight, NATIVE_MINT.toBase58(), setting.value,
    input.inputAmountLamports, input.minimumOutputAtomic,
    prepared.txSignature, expiresAt, job.id, `broadcasting:${input.workerId}`, job.entity_id,
  );
  if (archive) {
    await database.batch([archive, database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      insert, database.prepare(ASSERT_ONE_ROW_CHANGED_SQL)]);
  } else {
    const inserted = await insert.run();
    if (inserted.meta.changes !== 1) throw new Error("buyback_order_intent_conflict_or_paused");
  }
  return { intentId, txSignature: prepared.txSignature };
}

type PrepareBuybackBurnRequest = Extract<z.infer<typeof requestSchema>, { action: "prepare_buyback_burn" }>;
type ExpiredBuybackBurnIntent = {
  signer_role: string; signer_address: string | null; action: string; state: string;
  unsigned_transaction_base64: string | null; transaction_message_hash: string | null;
  provider_request_id: string | null; last_valid_block_height: number | null;
  input_mint: string | null; input_amount_atomic: string | null;
  tx_signature: string | null;
};

async function persistPreparedBuybackBurn(database: D1Database, job: AutomationRow,
  input: PrepareBuybackBurnRequest) {
  if (!FINANCIAL_LEDGER_VERIFIED || !BUYBACK_BURN_EXECUTION_SAFE ||
    job.job_type !== "sportpad_buyback_burn" || job.entity_type !== "settlement_step" ||
    job.chain !== "solana" || job.state !== "broadcasting") {
    throw new Error("buyback_burn_automation_lane_closed");
  }
  const config = readMainnetConfig();
  if (!config.buybackTreasury || input.workerId !== `solana:${config.buybackTreasury}`) {
    throw new Error("buyback_burn_worker_mismatch");
  }
  const swap = await recordVerifiedBuybackSwap(database, job, input.workerId,
    input.sourceTxHash, input.burnAmountAtomic);
  if (swap.amountAtomic !== input.burnAmountAtomic) throw new Error("buyback_burn_amount_mismatch");
  const controls = await readAutomationControls(database);
  if (!laneAllowsJob(job.job_type, controls)) throw new Error("buyback_burn_lane_paused");
  const currentHeight = await getMainnetConnection().getBlockHeight("confirmed");
  if (input.lastValidBlockHeight <= currentHeight || input.lastValidBlockHeight > currentHeight + 300) {
    throw new Error("buyback_burn_blockhash_window_invalid");
  }
  const inspected = await inspectPreparedAutomaticBuybackBurn(input.signedTransactionBase64, {
    treasury: config.buybackTreasury, mint: swap.mint, amountAtomic: swap.amountAtomic,
    decimals: swap.decimals, tokenProgram: swap.tokenProgram,
  });
  const rpc = getMainnetConnection();
  if (!(await rpc.isBlockhashValid(inspected.blockhash, { commitment: "confirmed" })).value) {
    throw new Error("buyback_burn_new_blockhash_invalid");
  }
  let expiredIntent: ExpiredBuybackBurnIntent | null = null;
  if (input.replacesBurnSignature) {
    expiredIntent = await database.prepare(`
      SELECT signer_role, signer_address, action, state, unsigned_transaction_base64,
        transaction_message_hash, provider_request_id, last_valid_block_height,
        input_mint, input_amount_atomic, tx_signature
      FROM transaction_intents
      WHERE idempotency_key = ?1 AND settlement_id = ?2 LIMIT 1
    `).bind(`automation:buyback:burn:${job.entity_id}`, swap.step.settlement_id)
      .first<ExpiredBuybackBurnIntent>();
    if (!expiredIntent || expiredIntent.signer_role !== "buyback_treasury" ||
      expiredIntent.signer_address !== config.buybackTreasury ||
      expiredIntent.action !== "sportpad_burn_automation" || expiredIntent.state !== "prepared" ||
      expiredIntent.input_mint !== swap.mint || expiredIntent.input_amount_atomic !== swap.amountAtomic ||
      expiredIntent.tx_signature !== input.replacesBurnSignature ||
      !expiredIntent.unsigned_transaction_base64 ||
      expiredIntent.tx_signature === inspected.txSignature) {
      throw new Error("buyback_burn_replacement_snapshot_mismatch");
    }
    const previous = await inspectPreparedAutomaticBuybackBurn(
      expiredIntent.unsigned_transaction_base64, {
        treasury: config.buybackTreasury, mint: swap.mint, amountAtomic: swap.amountAtomic,
        decimals: swap.decimals, tokenProgram: swap.tokenProgram,
      });
    if (previous.txSignature !== expiredIntent.tx_signature ||
      previous.transactionMessageHash !== expiredIntent.transaction_message_hash ||
      previous.blockhash !== expiredIntent.provider_request_id ||
      previous.blockhash === inspected.blockhash ||
      !expiredIntent.last_valid_block_height) {
      throw new Error("buyback_burn_replacement_message_mismatch");
    }
    await proveExpiredBuybackBurnAbsent(rpc, {
      sourceAta: getAssociatedTokenAddressSync(new PublicKey(swap.mint),
        new PublicKey(config.buybackTreasury), false, new PublicKey(swap.tokenProgram)),
      sourceSwapSignature: input.sourceTxHash,
      burnSignature: input.replacesBurnSignature,
      burnBlockhash: previous.blockhash,
      lastValidBlockHeight: expiredIntent.last_valid_block_height,
    });
  }
  const intentId = crypto.randomUUID();
  const insert = database.prepare(INSERT_AUTOMATIC_BUYBACK_CHUNK_BURN_INTENT_SQL).bind(
    intentId, `automation:buyback:burn:${job.entity_id}`, swap.step.settlement_id,
    config.buybackTreasury, JSON.stringify([swap.tokenProgram]), JSON.stringify([swap.mint]),
    inspected.blockhash, input.signedTransactionBase64, inspected.transactionMessageHash,
    input.lastValidBlockHeight, swap.mint, swap.amountAtomic, inspected.txSignature,
    new Date(Date.now() + 90_000).toISOString(), job.id,
    `broadcasting:${input.workerId}`, input.sourceTxHash, job.entity_id,
  );
  if (expiredIntent && input.replacesBurnSignature) {
    await database.batch([
      database.prepare(ARCHIVE_EXPIRED_BUYBACK_CHUNK_BURN_INTENT_SQL).bind(
        job.entity_id, input.replacesBurnSignature, expiredIntent.transaction_message_hash,
        job.id, `broadcasting:${input.workerId}`),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      insert,
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    ]);
  } else {
    const inserted = await insert.run();
    if (inserted.meta.changes !== 1) throw new Error("buyback_burn_intent_conflict_or_paused");
  }
  return { intentId, txSignature: inspected.txSignature };
}

type PrepareRewardRequest = Extract<z.infer<typeof requestSchema>, { action: "prepare_reward_swap" }>;

async function persistPreparedRewardSwap(database: D1Database, job: AutomationRow, input: PrepareRewardRequest) {
  if (job.entity_type === "reward_swap_batch") {
    return persistPreparedRewardBatch(database, job, input);
  }
  if (!FINANCIAL_LEDGER_VERIFIED || job.job_type !== "solana_reward_purchase" ||
    job.entity_type !== "settlement_step" || job.chain !== "solana") {
    throw new Error("reward_purchase_automation_lane_closed");
  }
  const config = readMainnetConfig();
  if (!config.rewardTreasury || input.workerId !== `solana:${config.rewardTreasury}`) {
    throw new Error("reward_purchase_worker_treasury_mismatch");
  }
  const [step, setting] = await Promise.all([
    database.prepare(`
      SELECT step.settlement_id, step.state AS step_state, step.idempotency_key,
        step.input_amount_atomic, step.output_mint,
        s.reward_amount_atomic, s.reward_spent_atomic, s.state, f.launch_id, l.mainnet_mint,
        l.mainnet_reward_treasury, l.reward_chain, l.reward_symbol, l.reward_mint,
        l.status AS launch_status
      FROM settlement_steps step JOIN settlements s ON s.id = step.settlement_id
      JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE step.id = ?1 AND step.stage = 'automatic_reward_chunk'
        AND s.reward_swap_signature IS NULL
    `).bind(job.entity_id).first<{
      settlement_id: string; step_state: string; idempotency_key: string;
      input_amount_atomic: string; output_mint: string;
      reward_amount_atomic: string; reward_spent_atomic: string; state: string; launch_id: string;
      mainnet_mint: string | null; mainnet_reward_treasury: string | null;
      reward_chain: string; reward_symbol: string; reward_mint: string | null;
      launch_status: string;
    }>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
  ]);
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  const asset = step?.reward_chain === "solana"
    ? getRewardOption("solana", step.reward_symbol) : null;
  const chunk = step && planAutomaticRewardChunk(step.reward_amount_atomic, step.reward_spent_atomic);
  const platformMint = setting?.value ?? config.sportpadMint ?? null;
  if (!step || !asset || !chunk || !step.mainnet_mint ||
    (platformMint && step.mainnet_mint === platformMint) ||
    step.mainnet_reward_treasury !== config.rewardTreasury ||
    step.launch_status !== "mainnet_published" ||
    asset.tokenAddress !== step.reward_mint || step.output_mint !== step.reward_mint ||
    step.step_state !== "planned" ||
    step.idempotency_key !== automaticRewardChunkKey(step.settlement_id, chunk.offsetAtomic) ||
    step.input_amount_atomic !== chunk.inputAmountLamports ||
    !["reconciled", "distributed", "buyback_burned"].includes(step.state) ||
    payload.settlementId !== step.settlement_id || payload.stepId !== job.entity_id ||
    payload.launchId !== step.launch_id ||
    payload.rewardAmountLamports !== chunk.inputAmountLamports ||
    payload.rewardTotalLamports !== step.reward_amount_atomic ||
    payload.chunkOffsetAtomic !== chunk.offsetAtomic ||
    payload.rewardSymbol !== step.reward_symbol || payload.rewardMint !== step.reward_mint ||
    input.outputMint !== step.reward_mint ||
    input.inputAmountLamports !== chunk.inputAmountLamports ||
    (config.sportpadMint && setting?.value && config.sportpadMint !== setting.value) ||
    BigInt(input.minimumOutputAtomic) > 18_446_744_073_709_551_615n) {
    throw new Error("reward_purchase_order_job_snapshot_mismatch");
  }
  const controls = await readAutomationControls(database);
  if (!laneAllowsJob(job.job_type, controls)) throw new Error("reward_purchase_automation_lane_paused");
  const currentHeight = await getMainnetConnection().getBlockHeight("confirmed");
  if (input.lastValidBlockHeight <= currentHeight || input.lastValidBlockHeight > currentHeight + 300) {
    throw new Error("reward_purchase_order_blockhash_window_invalid");
  }
  const prepared = await inspectPreparedAutomaticBuybackOrder({
    unsignedTransactionBase64: input.unsignedTransactionBase64,
    signedTransactionBase64: input.signedTransactionBase64,
    treasury: config.rewardTreasury,
  });
  const intentId = crypto.randomUUID();
  const idempotencyKey = `automation:reward:swap:${job.entity_id}`;
  const archive = await replacementSwapArchive(database, job, {
    canonicalKey: idempotencyKey, replacesSignature: input.replacesSwapSignature,
    newSignature: prepared.txSignature, treasury: config.rewardTreasury,
    outputMint: step.reward_mint, inputAmountLamports: input.inputAmountLamports,
    settlementId: step.settlement_id,
  });
  const insert = database.prepare(INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL).bind(
    intentId, idempotencyKey, step.settlement_id, config.rewardTreasury,
    JSON.stringify(["jupiter_v2_metis_pinned"]),
    JSON.stringify([NATIVE_MINT.toBase58(), step.reward_mint]),
    input.inputAmountLamports, input.providerRequestId,
    input.unsignedTransactionBase64, prepared.transactionMessageHash,
    input.lastValidBlockHeight, NATIVE_MINT.toBase58(), step.reward_mint,
    input.inputAmountLamports, input.minimumOutputAtomic,
    prepared.txSignature, new Date(Date.now() + 90_000).toISOString(),
    job.id, `broadcasting:${input.workerId}`, job.entity_id, config.sportpadMint ?? null,
  );
  if (archive) {
    await database.batch([archive, database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      insert, database.prepare(ASSERT_ONE_ROW_CHANGED_SQL)]);
  } else {
    const inserted = await insert.run();
    if (inserted.meta.changes !== 1) throw new Error("reward_purchase_order_intent_conflict_or_paused");
  }
  return { intentId, txSignature: prepared.txSignature };
}

async function persistPreparedRewardBatch(database: D1Database, job: AutomationRow,
  input: PrepareRewardRequest) {
  if (!FINANCIAL_LEDGER_VERIFIED || job.job_type !== "solana_reward_purchase" ||
    job.entity_type !== "reward_swap_batch" || job.chain !== "solana") {
    throw new Error("reward_batch_automation_lane_closed");
  }
  const config = readMainnetConfig();
  if (!config.rewardTreasury || input.workerId !== `solana:${config.rewardTreasury}`) {
    throw new Error("reward_batch_worker_treasury_mismatch");
  }
  const [batch, setting] = await Promise.all([
    database.prepare(`
      SELECT b.input_amount_atomic, b.reward_mint, b.treasury,
        b.launch_id, b.state, l.reward_symbol, l.reward_chain,
        l.mainnet_mint, l.mainnet_reward_treasury, l.status AS launch_status,
        (SELECT COUNT(*) FROM reward_swap_batch_sources src WHERE src.batch_id = b.id
          AND src.state = 'reserved') AS source_count
      FROM reward_swap_batches b JOIN launch_drafts l ON l.id = b.launch_id
      WHERE b.id = ?1
    `).bind(job.entity_id).first<{ input_amount_atomic: string; reward_mint: string;
      treasury: string; launch_id: string; state: string; reward_symbol: string;
      reward_chain: string; mainnet_mint: string | null;
      mainnet_reward_treasury: string | null; launch_status: string; source_count: number }>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
  ]);
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  const platformMint = setting?.value ?? config.sportpadMint ?? null;
  if (!batch || batch.state !== "broadcasting" || batch.source_count <= 0 ||
    batch.reward_chain !== "solana" || batch.launch_status !== "mainnet_published" ||
    !batch.mainnet_mint || (platformMint && batch.mainnet_mint === platformMint) ||
    batch.treasury !== config.rewardTreasury ||
    batch.mainnet_reward_treasury !== config.rewardTreasury ||
    getRewardOption("solana", batch.reward_symbol)?.tokenAddress !== batch.reward_mint ||
    payload.batchId !== job.entity_id || payload.launchId !== batch.launch_id ||
    payload.rewardMint !== batch.reward_mint || payload.rewardSymbol !== batch.reward_symbol ||
    payload.rewardAmountLamports !== batch.input_amount_atomic ||
    input.outputMint !== batch.reward_mint ||
    input.inputAmountLamports !== batch.input_amount_atomic ||
    (config.sportpadMint && setting?.value && config.sportpadMint !== setting.value) ||
    BigInt(input.minimumOutputAtomic) > 18_446_744_073_709_551_615n) {
    throw new Error("reward_batch_prepare_snapshot_mismatch");
  }
  const controls = await readAutomationControls(database);
  if (!laneAllowsJob(job.job_type, controls)) throw new Error("reward_batch_lane_paused");
  const currentHeight = await getMainnetConnection().getBlockHeight("confirmed");
  if (input.lastValidBlockHeight <= currentHeight || input.lastValidBlockHeight > currentHeight + 300) {
    throw new Error("reward_batch_order_blockhash_window_invalid");
  }
  const prepared = await inspectPreparedAutomaticBuybackOrder({
    unsignedTransactionBase64: input.unsignedTransactionBase64,
    signedTransactionBase64: input.signedTransactionBase64,
    treasury: config.rewardTreasury,
  });
  const intentId = crypto.randomUUID();
  const idempotencyKey = rewardBatchIntentKey(job.entity_id);
  const archive = await replacementSwapArchive(database, job, {
    canonicalKey: idempotencyKey, replacesSignature: input.replacesSwapSignature,
    newSignature: prepared.txSignature, treasury: config.rewardTreasury,
    outputMint: batch.reward_mint, inputAmountLamports: input.inputAmountLamports,
  });
  const insert = database.prepare(INSERT_REWARD_BATCH_INTENT_SQL).bind(
    intentId, idempotencyKey, null, config.rewardTreasury,
    JSON.stringify(["jupiter_v2_metis_pinned"]),
    JSON.stringify([NATIVE_MINT.toBase58(), batch.reward_mint]),
    input.inputAmountLamports, input.providerRequestId,
    input.unsignedTransactionBase64, prepared.transactionMessageHash,
    input.lastValidBlockHeight, NATIVE_MINT.toBase58(), batch.reward_mint,
    input.inputAmountLamports, input.minimumOutputAtomic,
    prepared.txSignature, new Date(Date.now() + 90_000).toISOString(),
    job.id, `broadcasting:${input.workerId}`, job.entity_id, config.sportpadMint ?? null,
  );
  if (archive) {
    await database.batch([archive, database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      insert, database.prepare(ASSERT_ONE_ROW_CHANGED_SQL)]);
  } else {
    const inserted = await insert.run();
    if (inserted.meta.changes !== 1) throw new Error("reward_batch_intent_conflict_or_paused");
  }
  return { intentId, txSignature: prepared.txSignature };
}

type PrepareClaimRequest = Extract<z.infer<typeof requestSchema>, { action: "prepare_solana_claim_payout" }>;

async function persistPreparedSolanaClaim(database: D1Database, job: AutomationRow, input: PrepareClaimRequest) {
  if (!FINANCIAL_LEDGER_VERIFIED || !CLAIM_PAYOUT_EXECUTION_SAFE ||
    job.job_type !== "solana_claim_payout" || job.entity_type !== "reward_claim" ||
    job.chain !== "solana") throw new Error("claim_payout_automation_lane_closed");
  const config = readMainnetConfig();
  if (!config.rewardTreasury || input.workerId !== `solana:${config.rewardTreasury}`) {
    throw new Error("claim_payout_worker_treasury_mismatch");
  }
  const claim = await database.prepare(`
    SELECT c.amount_atomic, c.destination_address, c.destination_chain, e.launch_id,
      l.reward_chain, l.reward_mint, l.reward_symbol,
      l.mainnet_reward_treasury, l.status AS launch_status
    FROM reward_claims c JOIN reward_epochs e ON e.id = c.epoch_id
    JOIN launch_drafts l ON l.id = e.launch_id
    WHERE c.id = ?1 AND c.state = 'queued' AND c.claim_signature IS NULL
  `).bind(job.entity_id).first<{
    amount_atomic: string; destination_address: string; destination_chain: string; launch_id: string;
    reward_chain: string; reward_mint: string; reward_symbol: string;
    mainnet_reward_treasury: string | null; launch_status: string;
  }>();
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  const asset = claim && getRewardOption("solana", claim.reward_symbol);
  if (!claim || !asset || claim.reward_chain !== "solana" ||
    claim.destination_chain !== "solana" || claim.launch_status !== "mainnet_published" ||
    claim.mainnet_reward_treasury !== config.rewardTreasury ||
    asset.tokenAddress !== claim.reward_mint ||
    payload.claimId !== job.entity_id || payload.tokenAddress !== claim.reward_mint ||
    payload.destinationAddress !== claim.destination_address ||
    payload.amountAtomic !== claim.amount_atomic ||
    input.tokenAddress !== claim.reward_mint ||
    input.destinationAddress !== claim.destination_address ||
    input.amountAtomic !== claim.amount_atomic ||
    BigInt(input.amountAtomic) > 18_446_744_073_709_551_615n) {
    throw new Error("claim_payout_job_snapshot_mismatch");
  }
  const controls = await readAutomationControls(database);
  if (!laneAllowsJob(job.job_type, controls)) throw new Error("claim_payout_lane_paused");
  const rpc = getMainnetConnection();
  await readSolanaRewardVaultSolvency(database, rpc, {
    mint: claim.reward_mint, treasury: config.rewardTreasury,
    change: { type: "none" }, requiredLaunchId: claim.launch_id,
  });
  const currentHeight = await rpc.getBlockHeight("confirmed");
  if (input.lastValidBlockHeight <= currentHeight || input.lastValidBlockHeight > currentHeight + 300) {
    throw new Error("claim_payout_blockhash_window_invalid");
  }
  const mint = new PublicKey(claim.reward_mint);
  const mintAccount = await rpc.getAccountInfo(mint, "finalized");
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
    !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error("claim_payout_mint_invalid");
  const mintState = await getMint(rpc, mint, "finalized", mintAccount.owner);
  const prepared = await inspectPreparedAutomaticClaimPayout(input.signedTransactionBase64, {
    treasury: config.rewardTreasury, mint: claim.reward_mint,
    recipient: claim.destination_address, amountAtomic: claim.amount_atomic,
    decimals: mintState.decimals, tokenProgram: mintAccount.owner.toBase58(),
  });
  const sourceAta = getAssociatedTokenAddressSync(mint,
    new PublicKey(config.rewardTreasury), false, mintAccount.owner);
  const historyAnchorSignature = await captureClaimHistoryAnchor(rpc, sourceAta);
  const intentId = crypto.randomUUID();
  const inserted = await database.prepare(INSERT_AUTOMATIC_CLAIM_INTENT_SQL).bind(
    intentId, `automation:claim:payout:${job.id}:${job.attempt}`, job.entity_id,
    config.rewardTreasury, JSON.stringify([mintAccount.owner.toBase58()]),
    JSON.stringify([claim.reward_mint]), prepared.blockhash,
    input.signedTransactionBase64, prepared.transactionMessageHash,
    input.lastValidBlockHeight, claim.reward_mint, claim.amount_atomic,
    prepared.txSignature, new Date(Date.now() + 90_000).toISOString(),
    job.id, `broadcasting:${input.workerId}`, claim.destination_address,
    historyAnchorSignature,
  ).run();
  if (inserted.meta.changes !== 1) throw new Error("claim_payout_intent_conflict_or_paused");
  return { intentId, txSignature: prepared.txSignature };
}

async function reconcilePreparedSolanaClaim(database: D1Database, workerId: string,
  allowReplay: boolean): Promise<{ reconciled: boolean; prepared?: {
    jobId: string; payload: Record<string, unknown>; signature: string;
    signedTransactionBase64: string; lastValidBlockHeight: number;
  } }> {
  const config = readMainnetConfig();
  if (!config.rewardTreasury || workerId !== `solana:${config.rewardTreasury}`) {
    throw new Error("claim_reconciliation_worker_mismatch");
  }
  const row = await database.prepare(`
    SELECT j.id, j.job_type, j.entity_type, j.entity_id, j.chain,
      j.payload_json, j.state, j.attempt, j.leased_until, j.error_code, j.tx_hash,
      i.idempotency_key, i.claim_id, i.signer_role, i.signer_address, i.action,
      i.state AS intent_state, i.expected_programs_json, i.expected_mints_json,
      i.maximum_spend_lamports, i.provider_request_id,
      i.unsigned_transaction_base64, i.transaction_message_hash,
      i.last_valid_block_height, i.claim_history_anchor_signature,
      i.input_mint, i.input_amount_atomic,
      i.tx_signature
    FROM automation_jobs j JOIN transaction_intents i
      ON i.idempotency_key = 'automation:claim:payout:' || j.id || ':' || j.attempt
    WHERE j.job_type = 'solana_claim_payout' AND j.entity_type = 'reward_claim'
      AND j.chain = 'solana' AND j.state IN ('broadcasting', 'reconciliation_required')
      AND i.action = 'solana_claim_payout_automation' AND i.state = 'prepared'
      AND i.claim_id = j.entity_id AND i.tx_signature IS NOT NULL
      AND (j.state = 'reconciliation_required' OR j.error_code = ?1)
      AND (j.tx_hash IS NULL OR j.tx_hash = i.tx_signature)
      AND j.available_at <= ?2
    ORDER BY j.updated_at ASC LIMIT 1
  `).bind(`broadcasting:${workerId}`, Date.now())
    .first<AutomationRow & PersistedAutomaticClaimIntent & { intent_state: string }>();
  if (!row?.tx_signature) return { reconciled: false };
  const defer = async () => database.prepare(`
    UPDATE automation_jobs SET available_at = ?2
    WHERE id = ?1 AND state IN ('broadcasting', 'reconciliation_required')
      AND (tx_hash IS NULL OR tx_hash = ?3)
  `).bind(row.id, Date.now() + 30_000, row.tx_signature).run();
  try {
    const rpc = getMainnetConnection();
    const [receipt, statuses] = await Promise.all([
      rpc.getTransaction(row.tx_signature,
        { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      rpc.getSignatureStatuses([row.tx_signature], { searchTransactionHistory: true }),
    ]);
    const status = statuses.value[0] ?? null;
    if (receipt && status?.confirmationStatus === "finalized" && status.err === null) {
      await verifiedSolanaOutput(database, row, workerId, row.tx_signature);
      await completeJob(database, row, workerId, row.tx_signature);
      return { reconciled: true };
    }
    // Finalized failures or ambiguous archival evidence remain reserved for
    // audit. Only a separate complete source-history proof may requeue an
    // expired, unlanded transfer below.
    if (!allowReplay || status?.err || status?.confirmationStatus === "finalized" || receipt?.meta?.err) {
      await defer();
      return { reconciled: false };
    }
    if (!Number.isSafeInteger(row.last_valid_block_height) ||
      !row.last_valid_block_height) {
      await defer();
      return { reconciled: false };
    }
    const claim = await database.prepare(`
      SELECT c.amount_atomic, c.destination_address, c.destination_chain,
        l.reward_chain, l.reward_mint, l.reward_symbol,
        l.mainnet_reward_treasury, l.status AS launch_status
      FROM reward_claims c JOIN reward_epochs e ON e.id = c.epoch_id
      JOIN launch_drafts l ON l.id = e.launch_id
      WHERE c.id = ?1 AND c.state = 'queued' AND c.claim_signature IS NULL
    `).bind(row.entity_id).first<{
      amount_atomic: string; destination_address: string; destination_chain: string;
      reward_chain: string; reward_mint: string; reward_symbol: string;
      mainnet_reward_treasury: string | null; launch_status: string;
    }>();
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const asset = claim && getRewardOption("solana", claim.reward_symbol);
    if (!claim || !asset || claim.reward_chain !== "solana" ||
      claim.destination_chain !== "solana" || claim.launch_status !== "mainnet_published" ||
      claim.mainnet_reward_treasury !== config.rewardTreasury ||
      asset.tokenAddress !== claim.reward_mint ||
      payload.claimId !== row.entity_id || payload.tokenAddress !== claim.reward_mint ||
      payload.destinationAddress !== claim.destination_address ||
      payload.amountAtomic !== claim.amount_atomic ||
      row.claim_id !== row.entity_id || row.signer_role !== "reward_treasury" ||
      row.signer_address !== config.rewardTreasury ||
      row.input_mint !== claim.reward_mint || row.input_amount_atomic !== claim.amount_atomic ||
      row.maximum_spend_lamports !== "500000") {
      throw new Error("claim_reconciliation_snapshot_mismatch");
    }
    const mint = new PublicKey(claim.reward_mint);
    const mintAccount = await rpc.getAccountInfo(mint, "finalized");
    if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
      !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error("claim_reconciliation_mint_invalid");
    const mintState = await getMint(rpc, mint, "finalized", mintAccount.owner);
    if (row.expected_programs_json !== JSON.stringify([mintAccount.owner.toBase58()]) ||
      row.expected_mints_json !== JSON.stringify([claim.reward_mint])) {
      throw new Error("claim_reconciliation_program_mismatch");
    }
    const signedTransactionBase64 = row.unsigned_transaction_base64;
    if (!signedTransactionBase64) throw new Error("claim_reconciliation_bytes_missing");
    const prepared = await inspectPreparedAutomaticClaimPayout(signedTransactionBase64, {
      treasury: config.rewardTreasury, mint: claim.reward_mint,
      recipient: claim.destination_address, amountAtomic: claim.amount_atomic,
      decimals: mintState.decimals, tokenProgram: mintAccount.owner.toBase58(),
    });
    if (prepared.txSignature !== row.tx_signature ||
      prepared.transactionMessageHash !== row.transaction_message_hash ||
      prepared.blockhash !== row.provider_request_id) {
      throw new Error("claim_reconciliation_intent_mismatch");
    }
    if (await rpc.getBlockHeight("finalized") > row.last_valid_block_height) {
      if (!row.claim_history_anchor_signature || row.tx_hash) {
        throw new Error("claim_reconciliation_anchor_or_hash_ambiguous");
      }
      const sourceAta = getAssociatedTokenAddressSync(mint,
        new PublicKey(config.rewardTreasury), false, mintAccount.owner);
      await proveExpiredClaimTransferAbsent(rpc, {
        sourceAta, anchorSignature: row.claim_history_anchor_signature,
        claimSignature: row.tx_signature, claimBlockhash: prepared.blockhash,
        lastValidBlockHeight: row.last_valid_block_height,
      });
      await database.batch([
        database.prepare(ARCHIVE_PROVEN_ABSENT_CLAIM_INTENT_SQL).bind(
          row.idempotency_key, row.entity_id, row.tx_signature,
          row.claim_history_anchor_signature, row.id, row.attempt,
          `broadcasting:${workerId}`),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        database.prepare(REQUEUE_PROVEN_ABSENT_CLAIM_JOB_SQL).bind(
          Date.now(), row.id, row.attempt, `broadcasting:${workerId}`,
          row.tx_signature, row.idempotency_key),
        database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      ]);
      return { reconciled: true };
    }
    if (row.state === "reconciliation_required") {
      const restored = await database.prepare(`
        UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
          available_at = ?3, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'reconciliation_required'
          AND (tx_hash IS NULL OR tx_hash = ?4)
      `).bind(row.id, `broadcasting:${workerId}`, Date.now(), row.tx_signature).run();
      if (restored.meta.changes !== 1) throw new Error("claim_reconciliation_job_changed");
    }
    return { reconciled: false, prepared: {
      jobId: row.id, payload, signature: row.tx_signature,
      signedTransactionBase64, lastValidBlockHeight: row.last_valid_block_height,
    } };
  } catch (error) {
    console.error("claim_payout_reconciliation_pending",
      error instanceof Error ? error.message : "unknown");
    await defer();
    return { reconciled: false };
  }
}

type PrepareChilizRequest = Extract<z.infer<typeof requestSchema>, { action: "prepare_chiliz_intent" }>;

async function inspectChilizSignedOrder(database: D1Database, job: AutomationRow,
  input: PrepareChilizRequest): Promise<ChilizSignedIntent> {
  const treasury = env.CHILIZ_TREASURY_ADDRESS?.trim();
  if (!treasury || !/^0x[0-9a-fA-F]{40}$/.test(treasury) ||
    input.workerId.toLowerCase() !== `chiliz:${treasury.toLowerCase()}` ||
    input.treasury.toLowerCase() !== treasury.toLowerCase() ||
    job.chain !== "chiliz" || job.attempt !== 1 || input.attempt !== 1 ||
    job.state !== "broadcasting" || job.error_code !== `broadcasting:${input.workerId}`) {
    throw new Error("chiliz_intent_worker_or_job_invalid");
  }
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  if (input.kind === "purchase") {
    const row = await database.prepare(`
      SELECT s.reward_amount_atomic, f.launch_id, l.reward_symbol, l.reward_chain,
        l.reward_mint, l.reward_wrapped_contract, l.status, l.mainnet_mint,
        l.mainnet_reward_treasury
      FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE s.id = ?1 AND s.reward_swap_signature IS NULL
        AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    `).bind(job.entity_id).first<{
      reward_amount_atomic: string; launch_id: string; reward_symbol: string;
      reward_chain: string; reward_mint: string; reward_wrapped_contract: string | null;
      status: string; mainnet_mint: string | null; mainnet_reward_treasury: string | null;
    }>();
    const asset = row && getChilizRewardAsset(row.reward_symbol);
    const config = readMainnetConfig();
    const now = Math.floor(Date.now() / 1_000);
    if (!row || !asset || job.job_type !== "chiliz_reward_purchase" ||
      job.entity_type !== "settlement" || row.reward_chain !== "chiliz" ||
      row.status !== "mainnet_published" || !row.mainnet_mint ||
      !config.rewardTreasury || row.mainnet_reward_treasury !== config.rewardTreasury ||
      (config.sportpadMint && row.mainnet_mint === config.sportpadMint) ||
      row.reward_wrapped_contract !== null || asset.routeStatus !== "current_verified" ||
      row.reward_mint.toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
      input.fanTokenContract.toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
      payload.settlementId !== job.entity_id || payload.launchId !== row.launch_id ||
      payload.rewardAmountLamports !== row.reward_amount_atomic ||
      payload.rewardSymbol !== row.reward_symbol ||
      payload.fanTokenContract?.toString().toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
      !input.maxPrincipalWei || !input.minimumOutputAtomic ||
      !input.signedAtEpochSeconds || !input.deadlineEpochSeconds ||
      Math.abs(input.signedAtEpochSeconds - now) > 30 ||
      input.deadlineEpochSeconds < now + 20 || input.deadlineEpochSeconds > now + 150) {
      throw new Error("chiliz_intent_purchase_snapshot_invalid");
    }
    const independentCeiling = await quoteChilizPurchaseSpendCeiling(row.reward_amount_atomic, Date.now());
    const intent = await createChilizSignedIntent({
      jobId: job.id, attempt: 1, kind: "purchase", treasury,
      rawTransaction: input.rawTransaction as `0x${string}`,
      gasFeeCeilingWei: input.gasFeeCeilingWei,
      fanTokenContract: asset.currentV2Contract, maxPrincipalWei: input.maxPrincipalWei,
      minimumOutputAtomic: input.minimumOutputAtomic,
      signedAtEpochSeconds: input.signedAtEpochSeconds,
      deadlineEpochSeconds: input.deadlineEpochSeconds,
    });
    if (intent.kind !== "purchase") throw new Error("chiliz_intent_kind_invalid");
    verifyChilizPurchasePrincipal(intent.valueWei, input.maxPrincipalWei, independentCeiling);
    // The worker's quote is not spend authority. Check the exact signed size
    // against a fresh independent Kayen quote before persisting the raw tx.
    const client = createPublicClient({ transport: http(env.CHILIZ_RPC_URL?.trim() || CHILIZ_CHAIN.rpcUrl,
      { timeout: 12_000, retryCount: 1 }) });
    const spend = BigInt(intent.valueWei);
    const probe = spend / 10n;
    if (probe <= 0n) throw new Error("chiliz_intent_purchase_probe_too_small");
    const quoteAbi = parseAbi(["function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"]);
    const path = ["0x677F7e16C7Dd57be1D4C8aD1244883214953DC47", asset.currentV2Contract] as const;
    const [small, full] = await Promise.all([
      client.readContract({ address: "0x1918EbB39492C8b98865c5E53219c3f1AE79e76F", abi: quoteAbi,
        functionName: "getAmountsOut", args: [probe, path] }),
      client.readContract({ address: "0x1918EbB39492C8b98865c5E53219c3f1AE79e76F", abi: quoteAbi,
        functionName: "getAmountsOut", args: [spend, path] }),
    ]);
    const minimum = BigInt(intent.minimumOutputAtomic);
    if (small.length !== 2 || full.length !== 2 || small[0] !== probe || full[0] !== spend ||
      small[1] <= 0n || full[1] <= 0n || minimum < full[1] * 99n / 100n ||
      minimum > full[1] || full[1] * probe * 10_000n < small[1] * spend * 9_500n) {
      throw new Error("chiliz_intent_purchase_market_unverified");
    }
    return intent;
  }
  const row = await database.prepare(`
    SELECT c.amount_atomic, c.destination_address, c.destination_chain,
      e.launch_id, l.reward_symbol, l.reward_chain, l.reward_mint,
      l.reward_wrapped_contract, l.status
    FROM reward_claims c JOIN reward_epochs e ON e.id = c.epoch_id
    JOIN launch_drafts l ON l.id = e.launch_id
    WHERE c.id = ?1 AND c.state = 'queued'
  `).bind(job.entity_id).first<{
    amount_atomic: string; destination_address: string; destination_chain: string;
    launch_id: string; reward_symbol: string; reward_chain: string;
    reward_mint: string; reward_wrapped_contract: string | null; status: string;
  }>();
  const asset = row && getChilizRewardAsset(row.reward_symbol);
  if (!row || !asset || job.job_type !== "chiliz_claim_unwrap" ||
    job.entity_type !== "reward_claim" || row.reward_chain !== "chiliz" ||
    row.destination_chain !== "chiliz" || row.status !== "mainnet_published" ||
    row.reward_wrapped_contract !== null || asset.routeStatus !== "current_verified" ||
    row.reward_mint.toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
    input.fanTokenContract.toLowerCase() !== asset.currentV2Contract.toLowerCase() ||
    !/^0x[0-9a-fA-F]{40}$/.test(row.destination_address) ||
    !input.destination || input.destination.toLowerCase() !== row.destination_address.toLowerCase() ||
    !input.amountAtomic || input.amountAtomic !== row.amount_atomic ||
    payload.claimId !== job.entity_id || payload.amountAtomic !== row.amount_atomic ||
    payload.rewardSymbol !== row.reward_symbol ||
    payload.destinationAddress?.toString().toLowerCase() !== row.destination_address.toLowerCase() ||
    payload.fanTokenContract?.toString().toLowerCase() !== asset.currentV2Contract.toLowerCase()) {
    throw new Error("chiliz_intent_claim_snapshot_invalid");
  }
  const vault = await database.prepare(`
    SELECT inventory_atomic, reserved_atomic FROM reward_vaults
    WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = 'chiliz'
  `).bind(row.launch_id, asset.currentV2Contract).first<{
    inventory_atomic: string; reserved_atomic: string;
  }>();
  if (!vault || BigInt(vault.inventory_atomic) < BigInt(row.amount_atomic) ||
    BigInt(vault.reserved_atomic) < BigInt(row.amount_atomic)) {
    throw new Error("chiliz_intent_claim_inventory_unfunded");
  }
  return createChilizSignedIntent({
    jobId: job.id, attempt: 1, kind: "claim", treasury,
    rawTransaction: input.rawTransaction as `0x${string}`,
    gasFeeCeilingWei: input.gasFeeCeilingWei,
    fanTokenContract: asset.currentV2Contract,
    destination: row.destination_address, amountAtomic: row.amount_atomic,
  });
}

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Automation database is unavailable." }, { status: 503 });
  if (!(await authorize(request))) return workerUnauthorized();
  let input: z.infer<typeof requestSchema>;
  try { input = requestSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid worker request." }, { status: 400 }); }
  if (input.action === "reconcile") {
    const config = readMainnetConfig();
    const controls = await readAutomationControls(env.DB);
    if (!FINANCIAL_LEDGER_VERIFIED || !config.rewardTreasury ||
      input.workerId !== `solana:${config.rewardTreasury}`) {
      return Response.json({ error: "Reward reconciliation lane is paused or unavailable." }, { status: 409 });
    }
    const mayBroadcast = laneAllowsJob("solana_reward_purchase", controls);
    const requeued = mayBroadcast ? await env.DB.prepare(REQUEUE_UNPREPARED_REWARD_JOB_SQL)
      .bind(Date.now(), `broadcasting:${input.workerId}`).run() : null;
    const staleBatches = await env.DB.prepare(`
      SELECT j.id, j.entity_id FROM automation_jobs j
      JOIN reward_swap_batches b ON b.id = j.entity_id
      WHERE j.job_type = 'solana_reward_purchase' AND j.entity_type = 'reward_swap_batch'
        AND j.state IN ('broadcasting', 'reconciliation_required')
        AND (j.state = 'reconciliation_required' OR j.error_code = ?1)
        AND j.tx_hash IS NULL AND b.state = 'broadcasting'
        AND j.updated_at < datetime('now', '-5 minutes')
        AND NOT EXISTS (SELECT 1 FROM transaction_intents i
          WHERE i.reward_batch_id = b.id)
      LIMIT 25
    `).bind(`broadcasting:${input.workerId}`).all<{ id: string; entity_id: string }>();
    let batchRequeued = false;
    for (const stale of mayBroadcast ? staleBatches.results : []) {
      try {
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE automation_jobs SET state = 'queued', error_code = NULL,
              leased_until = NULL, available_at = ?2, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?1 AND entity_type = 'reward_swap_batch'
              AND job_type = 'solana_reward_purchase'
              AND state IN ('broadcasting', 'reconciliation_required') AND tx_hash IS NULL
              AND updated_at < datetime('now', '-5 minutes')
              AND NOT EXISTS (SELECT 1 FROM transaction_intents i
                WHERE i.reward_batch_id = automation_jobs.entity_id)
          `).bind(stale.id, Date.now()),
          env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
          env.DB.prepare(`
            UPDATE reward_swap_batches SET state = 'queued', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?1 AND state = 'broadcasting'
              AND EXISTS (SELECT 1 FROM automation_jobs j WHERE j.id = ?2
                AND j.entity_type = 'reward_swap_batch' AND j.entity_id = ?1
                AND j.job_type = 'solana_reward_purchase' AND j.state = 'queued')
              AND NOT EXISTS (SELECT 1 FROM transaction_intents i
                WHERE i.reward_batch_id = reward_swap_batches.id)
          `).bind(stale.entity_id, stale.id),
          env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        ]);
        batchRequeued = true;
      } catch {
        // A concurrent worker may have durably prepared the signed order.
      }
    }
    const reconciled = await reconcilePreparedSolanaPurchase(env.DB, input.workerId,
      mayBroadcast);
    const pending = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM automation_jobs
      WHERE job_type = 'solana_reward_purchase'
        AND entity_type IN ('settlement_step', 'reward_swap_batch')
        AND state IN ('broadcasting', 'reconciliation_required')
        AND (state = 'reconciliation_required' OR error_code = ?1)
    `).bind(`broadcasting:${input.workerId}`).first<{ count: number }>();
    return Response.json({
      reconciled: reconciled.reconciled || batchRequeued || Number(requeued?.meta.changes ?? 0) > 0,
      pending: Number(pending?.count ?? 0) > 0,
      ...(reconciled.prepared ? { prepared: reconciled.prepared } : {}),
      ...(reconciled.orderRequired ? { orderRequired: reconciled.orderRequired } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (input.action === "reconcile_claim") {
    const config = readMainnetConfig();
    if (!FINANCIAL_LEDGER_VERIFIED || !CLAIM_PAYOUT_EXECUTION_SAFE ||
      !config.rewardTreasury || input.workerId !== `solana:${config.rewardTreasury}`) {
      return Response.json({ error: "Claim reconciliation lane is unavailable." }, { status: 409 });
    }
    const controls = await readAutomationControls(env.DB);
    const requeued = await env.DB.prepare(REQUEUE_UNPREPARED_CLAIM_JOB_SQL)
      .bind(Date.now(), `broadcasting:${input.workerId}`).run();
    const outcome = await reconcilePreparedSolanaClaim(env.DB, input.workerId,
      laneAllowsJob("solana_claim_payout", controls));
    const pending = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM automation_jobs
      WHERE job_type = 'solana_claim_payout'
        AND state IN ('broadcasting', 'reconciliation_required')
        AND (state = 'reconciliation_required' OR error_code = ?1)
    `).bind(`broadcasting:${input.workerId}`).first<{ count: number }>();
    return Response.json({ reconciled: outcome.reconciled || Number(requeued.meta.changes ?? 0) > 0,
      pending: Number(pending?.count ?? 0) > 0, ...(outcome.prepared ? { prepared: outcome.prepared } : {}) },
    { headers: { "Cache-Control": "no-store" } });
  }
  if (input.action === "reconcile_buyback") {
    const config = readMainnetConfig();
    if (!FINANCIAL_LEDGER_VERIFIED || !BUYBACK_BURN_EXECUTION_SAFE ||
      !config.buybackTreasury || input.workerId !== `solana:${config.buybackTreasury}`) {
      return Response.json({ error: "Buyback reconciliation lane is unavailable." }, { status: 409 });
    }
    const controls = await readAutomationControls(env.DB);
    const mayBroadcast = laneAllowsJob("sportpad_buyback_burn", controls);
    const requeued = mayBroadcast ? await env.DB.prepare(`
      UPDATE automation_jobs SET state = 'queued', error_code = NULL,
        leased_until = NULL, available_at = ?1, updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'sportpad_buyback_burn' AND entity_type = 'settlement_step'
        AND state IN ('broadcasting', 'reconciliation_required')
        AND (state = 'reconciliation_required' OR error_code = ?2)
        AND tx_hash IS NULL AND updated_at < datetime('now', '-5 minutes')
        AND NOT EXISTS (SELECT 1 FROM transaction_intents i
          WHERE i.idempotency_key = 'automation:buyback:swap:' || automation_jobs.entity_id)
        AND NOT EXISTS (SELECT 1 FROM transaction_intents i
          WHERE i.idempotency_key = 'automation:buyback:burn:' || automation_jobs.entity_id)
    `).bind(Date.now(), `broadcasting:${input.workerId}`).run() : null;
    const outcome = await reconcilePreparedBuyback(env.DB, input.workerId, mayBroadcast);
    const pending = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM automation_jobs
      WHERE job_type = 'sportpad_buyback_burn' AND entity_type = 'settlement_step'
        AND state IN ('broadcasting', 'reconciliation_required')
        AND (state = 'reconciliation_required' OR error_code = ?1)
    `).bind(`broadcasting:${input.workerId}`).first<{ count: number }>();
    return Response.json({ reconciled: outcome.reconciled || Number(requeued?.meta.changes ?? 0) > 0,
      pending: Number(pending?.count ?? 0) > 0,
      ...(outcome.burnRequired ? { burnRequired: outcome.burnRequired } : {}),
      ...(outcome.burnPrepared ? { burnPrepared: outcome.burnPrepared } : {}),
      ...(outcome.swapPrepared ? { swapPrepared: outcome.swapPrepared } : {}),
      ...(outcome.swapRequired ? { swapRequired: outcome.swapRequired } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (input.action === "reconcile_chiliz_intent") {
    const treasury = env.CHILIZ_TREASURY_ADDRESS?.trim();
    if (!treasury || !/^0x[0-9a-fA-F]{40}$/.test(treasury) ||
      input.workerId.toLowerCase() !== `chiliz:${treasury.toLowerCase()}`) {
      return Response.json({ error: "Chiliz worker identity is unavailable." }, { status: 409 });
    }
    const controls = await readAutomationControls(env.DB);
    // An armed first attempt with no persisted signature and no tx hash cannot
    // have reached the only broadcast path. Restore just that aged job to its
    // first lease attempt; any signed or ambiguous transaction stays held.
    let requeued = false;
    if (FINANCIAL_LEDGER_VERIFIED && CHILIZ_ASSET_MIGRATION_VERIFIED) {
      const staleBroadcast = await env.DB.prepare(`
        SELECT j.id, j.job_type FROM automation_jobs j
        WHERE j.chain = 'chiliz' AND j.state = 'broadcasting'
          AND j.attempt = 1 AND j.error_code = ?1
          AND j.tx_hash IS NULL AND j.leased_until IS NULL
          AND j.updated_at < datetime('now', '-5 minutes')
          AND NOT EXISTS (SELECT 1 FROM chiliz_signed_intents i WHERE i.job_id = j.id)
          AND EXISTS (SELECT 1 FROM chiliz_intent_policy p
            WHERE p.authorized_job_id = j.id AND p.reserved_intent_id IS NULL
              AND p.key = CASE WHEN j.job_type = 'chiliz_reward_purchase'
                THEN 'purchase_canary' ELSE 'claim_canary' END)
        ORDER BY j.updated_at ASC LIMIT 1
      `).bind(`broadcasting:${input.workerId}`).first<{ id: string; job_type: string }>();
      if (staleBroadcast && laneAllowsJob(staleBroadcast.job_type, controls)) {
        const result = await env.DB.prepare(REQUEUE_STALE_UNPREPARED_CHILIZ_BROADCAST_SQL)
          .bind(staleBroadcast.id, input.workerId, Date.now()).run();
        requeued = result.meta.changes === 1;
      }
      const unprepared = await env.DB.prepare(`
        SELECT j.id, j.error_code, j.job_type FROM automation_jobs j
        WHERE j.chain = 'chiliz' AND j.state = 'reconciliation_required'
          AND j.attempt = 1 AND j.tx_hash IS NULL AND j.leased_until IS NULL
          AND j.updated_at < datetime('now', '-5 minutes')
          AND NOT EXISTS (SELECT 1 FROM chiliz_signed_intents i WHERE i.job_id = j.id)
          AND EXISTS (SELECT 1 FROM chiliz_intent_policy p
            WHERE p.authorized_job_id = j.id AND p.reserved_intent_id IS NULL
              AND p.key = CASE WHEN j.job_type = 'chiliz_reward_purchase'
                THEN 'purchase_canary' ELSE 'claim_canary' END)
        ORDER BY j.updated_at ASC LIMIT 1
      `).first<{ id: string; error_code: string | null; job_type: string }>();
      if (unprepared && unprepared.error_code && laneAllowsJob(unprepared.job_type, controls)) {
        const result = await env.DB.prepare(REQUEUE_UNPREPARED_CHILIZ_JOB_SQL)
          .bind(unprepared.id, unprepared.error_code, Date.now()).run();
        requeued = requeued || result.meta.changes === 1;
      }
    }
    const pending = await env.DB.prepare(`
      SELECT j.id, j.job_type, j.payload_json, j.state AS job_state,
        j.tx_hash,
        i.state AS intent_state
      FROM automation_jobs j JOIN chiliz_signed_intents i ON i.job_id = j.id
      WHERE j.chain = 'chiliz' AND j.job_type IN ('chiliz_reward_purchase', 'chiliz_claim_unwrap')
        AND j.state IN ('broadcasting', 'reconciliation_required')
        AND i.state IN ('prepared', 'broadcast_attempted')
        AND i.treasury_address = ?1
      ORDER BY j.updated_at ASC LIMIT 1
    `).bind(treasury.toLowerCase()).first<{
      id: string; job_type: string; payload_json: string;
      job_state: string; intent_state: string; tx_hash: string | null;
    }>();
    if (!pending) return Response.json({ prepared: null, requeued },
      { headers: { "Cache-Control": "no-store" } });
    const row = await env.DB.prepare(SELECT_CHILIZ_SIGNED_INTENT_SQL)
      .bind(pending.id).first<PersistedChilizIntentRow>();
    if (!row) return Response.json({ error: "Persisted Chiliz intent is missing." }, { status: 409 });
    let intent: ChilizSignedIntent;
    try { intent = await parsePersistedChilizSignedIntent(row); }
    catch { return Response.json({ error: "Persisted Chiliz intent is invalid." }, { status: 409 }); }
    if (pending.tx_hash && pending.tx_hash.toLowerCase() !== intent.txHash.toLowerCase()) {
      return Response.json({ error: "Chiliz reconciliation hash does not match signed intent." }, { status: 409 });
    }
    try {
      if (await finalizeRevertedChilizIntent(env.DB, pending.id, intent)) {
        return Response.json({ prepared: null, reconciled: "finalized_reverted" },
          { headers: { "Cache-Control": "no-store" } });
      }
    } catch (error) {
      console.error("chiliz_revert_reconciliation_failed",
        error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Chiliz reverted receipt could not be reconciled." }, { status: 409 });
    }
    const policy = await env.DB.prepare(`
      SELECT state, reserved_intent_id FROM chiliz_intent_policy
      WHERE authorized_job_id = ?1 LIMIT 1
    `).bind(pending.id).first<{ state: string; reserved_intent_id: string | null }>();
    const maySettle = FINANCIAL_LEDGER_VERIFIED && CHILIZ_ASSET_MIGRATION_VERIFIED &&
      policy?.reserved_intent_id === row.id;
    if (maySettle && pending.job_state === "reconciliation_required") {
      // Restore the same signed job for receipt completion. Its unique
      // persisted nonce/raw transaction forbids a replacement signature.
      const restored = await env.DB.prepare(`
        UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND chain = 'chiliz' AND state = 'reconciliation_required'
          AND (tx_hash IS NULL OR lower(tx_hash) = ?3)
          AND EXISTS (SELECT 1 FROM chiliz_signed_intents i
            WHERE i.job_id = automation_jobs.id AND i.tx_hash = ?3)
      `).bind(pending.id, `broadcasting:${input.workerId}`, intent.txHash.toLowerCase()).run();
      if (restored.meta.changes !== 1) {
        return Response.json({ error: "Chiliz reconciliation state changed." }, { status: 409 });
      }
    }
    const mayBroadcast = maySettle && laneAllowsJob(pending.job_type, controls) &&
      policy?.state === "reserved" &&
      ["prepared", "broadcast_attempted"].includes(row.state) &&
      (intent.kind !== "purchase" || intent.deadlineEpochSeconds > Math.floor(Date.now() / 1_000) + 15);
    return Response.json({ prepared: { jobId: pending.id, intent,
      job: { type: pending.job_type, payload: JSON.parse(pending.payload_json) } },
      mayBroadcast }, { headers: { "Cache-Control": "no-store" } });
  }
  if (input.action === "lease") {
    const controls = await readAutomationControls(env.DB);
    const treasury = env.CHILIZ_TREASURY_ADDRESS?.trim();
    const chilizWorkerMatches = Boolean(treasury && /^0x[0-9a-fA-F]{40}$/.test(treasury) &&
      input.workerId.toLowerCase() === `chiliz:${treasury.toLowerCase()}`);
    const allowedJobTypes = FINANCIAL_LEDGER_VERIFIED
      ? input.jobTypes.filter((jobType) => laneAllowsJob(jobType, controls) &&
        (CHILIZ_ASSET_MIGRATION_VERIFIED || !jobType.startsWith("chiliz_")) &&
        (!jobType.startsWith("chiliz_") || chilizWorkerMatches) &&
        (CLAIM_PAYOUT_EXECUTION_SAFE || jobType !== "solana_claim_payout") &&
        (BUYBACK_BURN_EXECUTION_SAFE || jobType !== "sportpad_buyback_burn")) : [];
    await env.DB.prepare(`
      INSERT INTO service_cursors (key, value, updated_at)
      VALUES (?1, ?2, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(`automation:${input.workerId}`, JSON.stringify({ jobTypes: allowedJobTypes, observedAt: Date.now() })).run();
    if (allowedJobTypes.includes("chiliz_reward_purchase")) await seedPurchaseJobs(env.DB);
    if (allowedJobTypes.includes("solana_reward_purchase")) await seedSolanaPurchaseJobs(env.DB);
    if (allowedJobTypes.includes("sportpad_buyback_burn")) await seedBuybackJobs(env.DB);
    if (allowedJobTypes.includes("chiliz_claim_unwrap") || allowedJobTypes.includes("chiliz_reward_purchase")) {
      await closeMatureRewardEpoch(env.DB, "chiliz");
    }
    if (allowedJobTypes.includes("solana_reward_purchase") || allowedJobTypes.includes("solana_claim_payout")) {
      await closeMatureRewardEpoch(env.DB, "solana");
    }
    const job = allowedJobTypes.length ? await leaseJob(env.DB, input.workerId, allowedJobTypes) : null;
    return Response.json({ job: job ? {
      id: job.id, type: job.job_type, entityType: job.entity_type, entityId: job.entity_id,
      chain: job.chain, attempt: job.attempt, leaseExpiresAt: job.leased_until,
      payload: JSON.parse(job.payload_json),
    } : null }, { headers: { "Cache-Control": "no-store" } });
  }
  const job = await env.DB.prepare(`
    SELECT id, job_type, entity_type, entity_id, chain, payload_json, state, attempt, leased_until, error_code, tx_hash
    FROM automation_jobs WHERE id = ?1
  `).bind(input.jobId).first<AutomationRow>();
  if (input.action === "complete" && job?.state === "complete" && job.tx_hash === input.txHash) {
    // A lost HTTP response must not make the worker broadcast a second payment.
    return Response.json({ completed: true, alreadyCompleted: true });
  }
  const ownedLease = ownsActiveLease(job, input.workerId, Date.now());
  const ownedBroadcast = ownsBroadcast(job, input.workerId);
  if (!job || (input.action === "arm" ? !ownedLease :
    input.action === "complete" || input.action === "prepare_chiliz_intent" ||
      input.action === "mark_chiliz_broadcast" || input.action === "prepare_buyback_swap" ||
      input.action === "prepare_buyback_burn" ||
      input.action === "prepare_reward_swap" || input.action === "prepare_solana_claim_payout"
      ? !ownedBroadcast :
      !ownedLease && !ownedBroadcast)) {
    return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
  }
  if (input.action === "arm") {
    const controls = await readAutomationControls(env.DB);
    const pauseSql = pauseConditionSql(job.job_type);
    if (!FINANCIAL_LEDGER_VERIFIED ||
      (!CLAIM_PAYOUT_EXECUTION_SAFE && job.job_type === "solana_claim_payout") ||
      (!BUYBACK_BURN_EXECUTION_SAFE && job.job_type === "sportpad_buyback_burn") ||
      (!CHILIZ_ASSET_MIGRATION_VERIFIED && job.job_type.startsWith("chiliz_")) ||
      !pauseSql || !laneAllowsJob(job.job_type, controls)) {
      return Response.json({ error: "Financial lane is paused or unavailable." }, { status: 409 });
    }
    if (job.job_type === "solana_reward_purchase" && job.entity_type === "reward_swap_batch") {
      const config = readMainnetConfig();
      const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
      const batch = await env.DB.prepare(`
        SELECT b.input_amount_atomic, b.launch_id, b.reward_mint, b.treasury,
          l.reward_symbol, l.mainnet_mint, l.status
        FROM reward_swap_batches b JOIN launch_drafts l ON l.id = b.launch_id
        WHERE b.id = ?1 AND b.state = 'queued'
      `).bind(job.entity_id).first<{ input_amount_atomic: string; launch_id: string;
        reward_mint: string; treasury: string; reward_symbol: string;
        mainnet_mint: string | null; status: string }>();
      if (!batch || !config.rewardTreasury || batch.treasury !== config.rewardTreasury ||
        input.workerId !== `solana:${config.rewardTreasury}` ||
        getRewardOption("solana", batch.reward_symbol)?.tokenAddress !== batch.reward_mint ||
        batch.status !== "mainnet_published" || !batch.mainnet_mint ||
        (config.sportpadMint && batch.mainnet_mint === config.sportpadMint) ||
        payload.batchId !== job.entity_id || payload.launchId !== batch.launch_id ||
        payload.rewardMint !== batch.reward_mint ||
        payload.rewardAmountLamports !== batch.input_amount_atomic) {
        return Response.json({ error: "Reward batch changed before arm." }, { status: 409 });
      }
      try {
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE automation_jobs SET state = 'broadcasting', leased_until = NULL,
              error_code = ?3, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?1 AND job_type = 'solana_reward_purchase'
              AND entity_type = 'reward_swap_batch' AND entity_id = ?5
              AND state = 'leased' AND error_code = ?2 AND leased_until >= ?4
              AND EXISTS (SELECT 1 FROM protocol_controls WHERE key = 'global'
                AND settlement_paused = 0 AND rewards_paused = 0)
          `).bind(job.id, `leased:${input.workerId}`,
            `broadcasting:${input.workerId}`, Date.now(), job.entity_id),
          env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
          env.DB.prepare(ARM_REWARD_BATCH_SQL).bind(job.entity_id,
            batch.input_amount_atomic, job.id, `broadcasting:${input.workerId}`),
          env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        ]);
      } catch {
        return Response.json({ error: "Reward batch changed before arm." }, { status: 409 });
      }
      return Response.json({ armed: true });
    }
    // Arm before the first irreversible transaction. A crashed or timed-out worker
    // leaves this job out of the automatic lease pool until on-chain reconciliation.
    const result = await env.DB.prepare(`
      UPDATE automation_jobs SET state = 'broadcasting', leased_until = NULL,
        error_code = ?3, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND state = 'leased' AND error_code = ?2 AND leased_until >= ?4
        AND EXISTS (SELECT 1 FROM protocol_controls WHERE key = 'global' AND ${pauseSql})
        AND (job_type <> 'sportpad_buyback_burn' OR EXISTS (
          SELECT 1 FROM settlement_steps step
          JOIN settlements s ON s.id = step.settlement_id
          JOIN fee_events f ON f.id = s.fee_event_id
          JOIN launch_drafts l ON l.id = f.launch_id
          JOIN protocol_settings p ON p.key = 'sportpad_mint'
          WHERE step.id = automation_jobs.entity_id
            AND automation_jobs.entity_type = 'settlement_step'
            AND step.stage = 'automatic_buyback_chunk' AND step.state = 'planned'
            AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
            AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
            AND step.idempotency_key = 'automation:buyback:chunk:' || s.id || ':' || s.buyback_spent_atomic
            AND l.status = 'mainnet_published'
            AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
            AND l.mainnet_buyback_treasury = ?6
            AND step.output_mint = p.value
            AND s.buyback_amount_atomic GLOB '[1-9]*'
            AND s.buyback_amount_atomic NOT GLOB '*[^0-9]*'
            AND s.buyback_spent_atomic GLOB '[0-9]*'
            AND s.buyback_spent_atomic NOT GLOB '*[^0-9]*'
            AND CAST(s.buyback_spent_atomic AS INTEGER) < CAST(s.buyback_amount_atomic AS INTEGER)
            AND CAST(step.input_amount_atomic AS INTEGER) = MIN(100000000,
              CAST(s.buyback_amount_atomic AS INTEGER) - CAST(s.buyback_spent_atomic AS INTEGER))
        ))
        AND (job_type <> 'solana_reward_purchase' OR EXISTS (
          SELECT 1 FROM settlement_steps step
          JOIN settlements s ON s.id = step.settlement_id
          JOIN fee_events f ON f.id = s.fee_event_id
          JOIN launch_drafts l ON l.id = f.launch_id
          LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
          WHERE step.id = automation_jobs.entity_id
            AND automation_jobs.entity_type = 'settlement_step'
            AND step.stage = 'automatic_reward_chunk' AND step.state = 'planned'
            AND s.reward_swap_signature IS NULL
            AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
            AND step.idempotency_key = 'automation:reward:chunk:' || s.id || ':' || s.reward_spent_atomic
            AND l.status = 'mainnet_published'
            AND l.reward_chain = 'solana' AND l.reward_mint = step.output_mint
            AND l.mainnet_mint IS NOT NULL
            AND (p.value IS NULL OR l.mainnet_mint <> p.value)
            AND (?5 IS NULL OR l.mainnet_mint <> ?5)
            AND s.reward_amount_atomic GLOB '[1-9]*'
            AND s.reward_amount_atomic NOT GLOB '*[^0-9]*'
            AND s.reward_spent_atomic GLOB '[0-9]*'
            AND s.reward_spent_atomic NOT GLOB '*[^0-9]*'
            AND CAST(s.reward_spent_atomic AS INTEGER) < CAST(s.reward_amount_atomic AS INTEGER)
            AND CAST(step.input_amount_atomic AS INTEGER) = MIN(100000000,
              CAST(s.reward_amount_atomic AS INTEGER) - CAST(s.reward_spent_atomic AS INTEGER))
        ))
    `).bind(job.id, `leased:${input.workerId}`, `broadcasting:${input.workerId}`,
      Date.now(), readMainnetConfig().sportpadMint ?? null,
      readMainnetConfig().buybackTreasury ?? null).run();
    if (result.meta.changes !== 1) return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
    return Response.json({ armed: true });
  }
  if (input.action === "prepare_chiliz_intent") {
    try {
      const controls = await readAutomationControls(env.DB);
      if (!FINANCIAL_LEDGER_VERIFIED || !CHILIZ_ASSET_MIGRATION_VERIFIED ||
        !laneAllowsJob(job.job_type, controls)) {
        throw new Error("chiliz_intent_lane_closed");
      }
      const existing = await env.DB.prepare(SELECT_CHILIZ_SIGNED_INTENT_SQL)
        .bind(job.id).first<PersistedChilizIntentRow>();
      if (existing) {
        const persisted = await parsePersistedChilizSignedIntent(existing);
        if (persisted.rawTransaction.toLowerCase() !== input.rawTransaction.toLowerCase() ||
          persisted.treasury.toLowerCase() !== input.treasury.toLowerCase() ||
          persisted.kind !== input.kind || persisted.fanTokenContract.toLowerCase() !==
            input.fanTokenContract.toLowerCase()) {
          throw new Error("chiliz_intent_replacement_forbidden");
        }
        return Response.json({ prepared: true, txHash: persisted.txHash,
          rawTransaction: persisted.rawTransaction });
      }
      const intent = await inspectChilizSignedOrder(env.DB, job, input);
      const intentId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(INSERT_CHILIZ_SIGNED_INTENT_SQL)
          .bind(...chilizSignedIntentInsertBindings(intent, input.workerId, intentId)),
        env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
        env.DB.prepare(RESERVE_CHILIZ_INTENT_POLICY_SQL).bind(intent.jobId, intentId),
        env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      ]);
      return Response.json({ prepared: true, txHash: intent.txHash,
        rawTransaction: intent.rawTransaction });
    } catch (error) {
      console.error("chiliz_intent_prepare_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Chiliz signed order could not be durably prepared." }, { status: 409 });
    }
  }
  if (input.action === "mark_chiliz_broadcast") {
    try {
      const controls = await readAutomationControls(env.DB);
      if (!FINANCIAL_LEDGER_VERIFIED || !CHILIZ_ASSET_MIGRATION_VERIFIED ||
        !laneAllowsJob(job.job_type, controls)) throw new Error("chiliz_broadcast_lane_closed");
      const row = await env.DB.prepare(SELECT_CHILIZ_SIGNED_INTENT_SQL)
        .bind(job.id).first<PersistedChilizIntentRow>();
      if (!row) throw new Error("chiliz_broadcast_intent_missing");
      const policy = await env.DB.prepare(`
        SELECT state, reserved_intent_id FROM chiliz_intent_policy
        WHERE authorized_job_id = ?1 LIMIT 1
      `).bind(job.id).first<{ state: string; reserved_intent_id: string | null }>();
      if (policy?.state !== "reserved" || policy.reserved_intent_id !== row.id) {
        throw new Error("chiliz_broadcast_policy_paused");
      }
      const intent = await parsePersistedChilizSignedIntent(row);
      if (intent.txHash.toLowerCase() !== input.txHash.toLowerCase() ||
        intent.treasury.toLowerCase() !== input.workerId.slice("chiliz:".length).toLowerCase() ||
        (intent.kind === "purchase" && intent.deadlineEpochSeconds <= Math.floor(Date.now() / 1_000) + 15)) {
        throw new Error("chiliz_broadcast_intent_mismatch");
      }
      if (row.state === "broadcast_attempted") return Response.json({ marked: true });
      const marked = await env.DB.prepare(MARK_CHILIZ_INTENT_BROADCAST_SQL)
        .bind(job.id, intent.txHash, Date.now()).run();
      if (marked.meta.changes !== 1) throw new Error("chiliz_broadcast_intent_changed");
      return Response.json({ marked: true });
    } catch (error) {
      console.error("chiliz_broadcast_mark_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Chiliz broadcast could not be authorized." }, { status: 409 });
    }
  }
  if (input.action === "prepare_buyback_swap") {
    try {
      const prepared = await persistPreparedBuybackSwap(env.DB, job, input);
      return Response.json({ prepared: true, ...prepared });
    } catch (error) {
      // A duplicate, paused, expired, or unverifiable order is never executed.
      // The worker must reconcile the armed job rather than obtain a new order.
      console.error("buyback_order_prepare_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Buyback order could not be durably prepared." }, { status: 409 });
    }
  }
  if (input.action === "prepare_buyback_burn") {
    try {
      const prepared = await persistPreparedBuybackBurn(env.DB, job, input);
      return Response.json({ prepared: true, ...prepared });
    } catch (error) {
      console.error("buyback_burn_prepare_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Buyback burn could not be durably prepared." }, { status: 409 });
    }
  }
  if (input.action === "prepare_reward_swap") {
    try {
      const prepared = await persistPreparedRewardSwap(env.DB, job, input);
      return Response.json({ prepared: true, ...prepared });
    } catch (error) {
      console.error("reward_purchase_order_prepare_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Reward purchase order could not be durably prepared." }, { status: 409 });
    }
  }
  if (input.action === "prepare_solana_claim_payout") {
    try {
      const prepared = await persistPreparedSolanaClaim(env.DB, job, input);
      return Response.json({ prepared: true, ...prepared });
    } catch (error) {
      console.error("claim_payout_prepare_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Claim payout could not be durably prepared." }, { status: 409 });
    }
  }
  if (input.action === "complete") {
    if (!FINANCIAL_LEDGER_VERIFIED ||
      (!BUYBACK_BURN_EXECUTION_SAFE && job.job_type === "sportpad_buyback_burn") ||
      (!CHILIZ_ASSET_MIGRATION_VERIFIED && job.job_type.startsWith("chiliz_"))) {
      // Preserve worker-reported evidence without treating it as a verified
      // chain receipt or mutating claim, settlement, or vault accounting.
      const receipt = JSON.stringify({
        txHash: input.txHash,
        sourceTxHash: input.sourceTxHash ?? null,
        outputAmountAtomic: input.outputAmountAtomic ?? null,
      });
      const result = await env.DB.prepare(HOLD_BROADCAST_RECEIPT_SQL)
        .bind(job.id, input.txHash, receipt, `broadcasting:${input.workerId}`).run();
      if (result.meta.changes !== 1) return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
      return Response.json({ completed: false, reconciliationRequired: true }, { status: 202 });
    }
    let verifiedOutput = input.outputAmountAtomic;
    let verifiedSlot: number | undefined;
    let chilizFinalization: VerifiedChilizFinalization | undefined;
    if (job.job_type === "chiliz_reward_purchase" || job.job_type === "chiliz_claim_unwrap") {
      try {
        chilizFinalization = await verifiedChilizOutput(env.DB, job, input.workerId,
          input.txHash, input.outputAmountAtomic);
        verifiedOutput = chilizFinalization.outputAmountAtomic;
      } catch (error) {
        // Never credit a vault or discharge a claim from a worker-supplied hash.
        // Preserve the hash for a human to reconcile without rebroadcasting.
        const verificationError = error instanceof Error ? error.message : "chiliz_receipt_unavailable";
        const evidence = JSON.stringify({ txHash: input.txHash,
          outputAmountAtomic: input.outputAmountAtomic ?? null, verificationError });
        const held = await env.DB.prepare(HOLD_BROADCAST_RECEIPT_SQL)
          .bind(job.id, input.txHash, evidence, `broadcasting:${input.workerId}`).run();
        if (held.meta.changes !== 1) return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
        console.error("chiliz_receipt_verification_failed", verificationError);
        return Response.json({ completed: false, reconciliationRequired: true }, { status: 202 });
      }
    } else if (job.job_type === "solana_claim_payout" || job.job_type === "solana_reward_purchase" ||
      job.job_type === "sportpad_buyback_burn") {
      try {
        const verified = await verifiedSolanaOutput(env.DB, job, input.workerId, input.txHash,
          input.sourceTxHash, input.outputAmountAtomic);
        if (verified && typeof verified === "object") {
          verifiedOutput = verified.outputAmountAtomic;
          verifiedSlot = verified.verifiedSlot;
        } else {
          verifiedOutput = verified;
        }
      } catch (error) {
        // Keep an ambiguous or invalid broadcast out of the lease pool. Its
        // claimed hash is evidence for reconciliation, never proof of payment.
        const verificationError = error instanceof Error ? error.message : "solana_receipt_unavailable";
        const evidence = JSON.stringify({ txHash: input.txHash, sourceTxHash: input.sourceTxHash ?? null,
          outputAmountAtomic: input.outputAmountAtomic ?? null, verificationError });
        const held = await env.DB.prepare(HOLD_BROADCAST_RECEIPT_SQL)
          .bind(job.id, input.txHash, evidence, `broadcasting:${input.workerId}`).run();
        if (held.meta.changes !== 1) return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
        console.error("solana_receipt_verification_failed", verificationError);
        return Response.json({ completed: false, reconciliationRequired: true }, { status: 202 });
      }
    }
    let completionError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await completeJob(env.DB, job, input.workerId, input.txHash,
          verifiedOutput, input.sourceTxHash, verifiedSlot, chilizFinalization);
        return Response.json({ completed: true });
      } catch (error) {
        // A concurrent purchase or claim may have changed a vault snapshot.
        // Re-read and retry accounting only; never ask for another broadcast.
        completionError = error;
      }
    }
    const committed = await env.DB.prepare("SELECT state, tx_hash FROM automation_jobs WHERE id = ?1")
      .bind(job.id).first<{ state: string; tx_hash: string | null }>();
    if (committed?.state === "complete" && committed.tx_hash === input.txHash) {
      return Response.json({ completed: true, alreadyCompleted: true });
    }
    console.error("automation_job_complete_failed", completionError instanceof Error ? completionError.message : "unknown");
    return Response.json({ error: "Automation receipt could not be committed." }, { status: 409 });
  }
  const disposition = failureDisposition(ownedBroadcast, input.retryable);
  const retry = disposition.retry;
  const delaySeconds = Math.min(3_600, 15 * 2 ** Math.min(job.attempt, 8));
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      UPDATE automation_jobs SET state = ?2, error_code = ?3, available_at = ?4,
        leased_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND state = ?5 AND error_code = ?6
    `).bind(job.id, disposition.state, input.errorCode,
      Date.now() + delaySeconds * 1_000, ownedBroadcast ? "broadcasting" : "leased",
      ownedBroadcast ? `broadcasting:${input.workerId}` : `leased:${input.workerId}`),
    env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
  ];
  if (!ownedBroadcast && !retry && job.entity_type === "reward_claim") {
    statements.push(
      env.DB.prepare(`
        UPDATE reward_claims SET state = 'claimable', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND state = 'queued'
          AND EXISTS (SELECT 1 FROM automation_jobs WHERE id = ?2 AND state = 'failed')
      `).bind(job.entity_id, job.id),
      env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    );
  }
  try { await env.DB.batch(statements); }
  catch { return Response.json({ error: "Worker job changed before its failure could be recorded." }, { status: 409 }); }
  return Response.json({ failed: true, retrying: retry, reconciliationRequired: ownedBroadcast,
    retryAfterSeconds: retry ? delaySeconds : null });
}
