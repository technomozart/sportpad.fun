import { env } from "cloudflare:workers";
import { getAssociatedTokenAddressSync, getMint, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createPublicClient, http, parseAbi } from "viem";
import { z } from "zod";

import { allocateEpochRewards } from "@/lib/protocol/accounting";
import { CHILIZ_CHAIN, getChilizRewardAsset } from "@/lib/protocol/chiliz-reward-assets";
import { CHILIZ_ASSET_MIGRATION_VERIFIED, verifyChilizPurchaseReceipt,
  verifyChilizTransferReceipt } from "@/lib/protocol/chiliz-receipts";
import { ASSERT_ONE_ROW_CHANGED_SQL, COMPLETE_BROADCAST_JOB_SQL, COMPLETE_BUYBACK_SETTLEMENT_SQL, COMPLETE_CLAIM_SQL,
  COMPLETE_CLAIM_VAULT_SQL, COMPLETE_PURCHASE_SETTLEMENT_SQL, COMPLETE_PURCHASE_VAULT_SQL,
  COMPLETE_RECONCILED_JOB_SQL, COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL,
  COMPLETE_SOLANA_PURCHASE_VAULT_SQL,
  DEFER_CHILIZ_EPOCH_SQL, ELIGIBLE_COMMUNITY_BUYBACK_SETTLEMENTS_SQL,
  failureDisposition, FENCE_CHILIZ_EPOCH_SQL,
  FINANCIAL_LEDGER_VERIFIED, HOLD_BROADCAST_RECEIPT_SQL, laneAllowsJob,
  ownsActiveLease, ownsBroadcast, pauseConditionSql,
  REQUEUE_UNPREPARED_REWARD_JOB_SQL,
  type AutomationLaneControls } from "@/lib/protocol/automation-safety";
import { canonicalRewardAllocation } from "@/lib/protocol/holder-rewards";
import { getRewardOption } from "@/lib/protocol/reward-options";
import { quoteChilizPurchaseSpendCeiling } from "@/lib/server/chiliz-spend-bound";
import { DEFAULT_PROTOCOL_CONTROLS, readExecutionConfig, readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { observedSolanaRewardPurchaseOutput, verifySolanaClaimPayoutReceipt,
  verifySolanaRewardPurchaseReceipt,
  verifySportpadBuybackReceipts } from "@/lib/server/solana/automation-receipt";
import { inspectPreparedAutomaticBuybackOrder, verifyPersistedAutomaticBuybackIntent,
  verifyPersistedAutomaticRewardIntent, type PersistedAutomaticBuybackIntent } from "@/lib/server/solana/buyback-intent-proof";
import { INSERT_AUTOMATIC_BUYBACK_INTENT_SQL } from "@/lib/server/solana/buyback-order-sql";
import { INSERT_AUTOMATIC_REWARD_INTENT_SQL } from "@/lib/server/solana/reward-order-sql";
import { getMainnetConnection } from "@/lib/server/solana/devnet";
import { secureTokenEqual, workerUnauthorized } from "@/lib/server/workers/auth";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("lease"),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    jobTypes: z.array(z.enum(["chiliz_reward_purchase", "chiliz_claim_unwrap", "solana_reward_purchase", "solana_claim_payout", "sportpad_buyback_burn"])).min(1).max(5),
  }).strict(),
  z.object({
    action: z.literal("arm"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
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
  if (!config.rewardTreasury || !setting?.value ||
    (config.sportpadMint && config.sportpadMint !== setting.value)) return;
  const rows = await database.prepare(`
    SELECT s.id AS settlement_id, s.reward_amount_atomic, f.launch_id,
      l.reward_symbol, l.reward_mint
    FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    WHERE l.reward_chain = 'solana' AND l.reward_mint IS NOT NULL
      AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> ?1
      AND l.mainnet_reward_treasury = ?2
      AND l.status = 'mainnet_published'
      AND s.reward_amount_atomic GLOB '[1-9]*'
      AND s.reward_amount_atomic NOT GLOB '*[^0-9]*'
      AND CAST(s.reward_amount_atomic AS INTEGER) <= 100000000
      AND s.reward_swap_signature IS NULL
      AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
      AND NOT EXISTS (SELECT 1 FROM automation_jobs j
        WHERE j.entity_id = s.id AND j.job_type = 'solana_reward_purchase')
    ORDER BY s.created_at ASC LIMIT 25
  `).bind(setting.value, config.rewardTreasury).all<{
    settlement_id: string; reward_amount_atomic: string; launch_id: string;
    reward_symbol: string; reward_mint: string;
  }>();
  const eligible = rows.results.filter((row) => {
    const asset = getRewardOption("solana", row.reward_symbol);
    return asset?.tokenAddress === row.reward_mint &&
      BigInt(row.reward_amount_atomic) <= 100_000_000n;
  });
  if (!eligible.length) return;
  const now = Date.now();
  await database.batch(eligible.map((row) => database.prepare(`
    INSERT OR IGNORE INTO automation_jobs
      (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
    VALUES (?1, 'solana_reward_purchase', 'settlement', ?2, 'solana', ?3, 'queued', ?4)
  `).bind(crypto.randomUUID(), row.settlement_id, JSON.stringify({
    settlementId: row.settlement_id,
    launchId: row.launch_id,
    rewardAmountLamports: row.reward_amount_atomic,
    rewardSymbol: row.reward_symbol,
    rewardMint: row.reward_mint,
  }), now)));
}

async function seedBuybackJobs(database: D1Database) {
  const setting = await database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
    .first<{ value: string }>();
  if (!setting?.value) return;
  const rows = await database.prepare(ELIGIBLE_COMMUNITY_BUYBACK_SETTLEMENTS_SQL)
    .bind(setting.value).all<{ settlement_id: string; buyback_amount_atomic: string; launch_id: string }>();
  if (!rows.results.length) return;
  const now = Date.now();
  await database.batch(rows.results.map((row) => database.prepare(`
    INSERT OR IGNORE INTO automation_jobs
      (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
    VALUES (?1, 'sportpad_buyback_burn', 'settlement', ?2, 'solana', ?3, 'queued', ?4)
  `).bind(crypto.randomUUID(), row.settlement_id, JSON.stringify({
    settlementId: row.settlement_id,
    launchId: row.launch_id,
    amountLamports: row.buyback_amount_atomic,
    sportpadMint: setting.value,
  }), now)));
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
      AND l.reward_chain = ?1 AND (?1 <> 'chiliz' OR l.reward_wrapped_contract IS NULL)
      AND (?2 IS NULL OR e.launch_id = ?2)
      AND EXISTS (SELECT 1 FROM holder_snapshot_checkpoints c WHERE c.epoch_id = e.id
        AND c.last_observed_at >= CAST(strftime('%s', e.ends_at) AS INTEGER))
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
  const placeholders = jobTypes.map((_, index) => `?${index + 2}`).join(", ");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await database.prepare(`
      SELECT id, job_type, entity_type, entity_id, chain, payload_json, state, attempt, leased_until, error_code, tx_hash
      FROM automation_jobs
      WHERE job_type IN (${placeholders}) AND available_at <= ?1
        AND (state = 'queued' OR (state = 'leased' AND leased_until < ?1))
      ORDER BY available_at ASC, created_at ASC LIMIT 1
    `).bind(now, ...jobTypes).first<AutomationRow>();
    if (!row) return null;
    const leasedUntil = now + 60_000;
    const result = await database.prepare(`
      UPDATE automation_jobs SET state = 'leased', leased_until = ?2, error_code = ?3,
        attempt = attempt + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND (state = 'queued' OR (state = 'leased' AND leased_until < ?4))
    `).bind(row.id, leasedUntil, `leased:${workerId}`, now).run();
    if (result.meta.changes === 1) {
      return { ...row, attempt: row.attempt + 1, leased_until: leasedUntil, error_code: `leased:${workerId}` };
    }
  }
  return null;
}

async function completeJob(database: D1Database, job: AutomationRow, workerId: string, txHash: string, outputAmountAtomic?: string, sourceTxHash?: string) {
  // Claim the completion first, then apply every ledger effect in the same D1
  // transaction. Each zero-row compare-and-swap must throw so D1 rolls back.
  const statements: D1PreparedStatement[] = [
    job.state === "reconciliation_required" && job.job_type === "solana_reward_purchase"
      ? database.prepare(COMPLETE_RECONCILED_JOB_SQL).bind(job.id, txHash)
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
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1_000);
      statements.push(database.prepare(`
        INSERT INTO reward_epochs
          (id, launch_id, starts_at, ends_at, funded_amount_atomic, reward_decimals, state)
        VALUES (?1, ?2, ?3, ?4, ?5, 18, 'accruing')
      `).bind(crypto.randomUUID(), payload.launchId, startsAt.toISOString(), endsAt.toISOString(), outputAmountAtomic));
      statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
    }
  } else if (job.job_type === "solana_reward_purchase") {
    if (!outputAmountAtomic || sourceTxHash) throw new Error("solana_reward_receipt_missing");
    const payload = JSON.parse(job.payload_json) as {
      launchId: string; rewardMint: string; rewardAmountLamports: string;
    };
    const owner = readMainnetConfig().rewardTreasury;
    if (!owner || workerId !== `solana:${owner}`) throw new Error("solana_reward_owner_mismatch");
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
    const nextInventory = (BigInt(vault?.inventory_atomic ?? "0") + BigInt(outputAmountAtomic)).toString();
    statements.push(
      database.prepare(COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL).bind(job.entity_id, txHash,
        payload.launchId, payload.rewardMint, owner, payload.rewardAmountLamports),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      database.prepare(COMPLETE_SOLANA_PURCHASE_VAULT_SQL).bind(crypto.randomUUID(),
        payload.launchId, payload.rewardMint, owner, tokenAccount, nextInventory, null,
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
      const startsAt = new Date();
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
    if (!sourceTxHash) throw new Error("buyback_swap_receipt_missing");
    statements.push(database.prepare(COMPLETE_BUYBACK_SETTLEMENT_SQL)
      .bind(job.entity_id, sourceTxHash, txHash));
    statements.push(database.prepare(ASSERT_ONE_ROW_CHANGED_SQL));
  } else {
    throw new Error("automation_job_type_invalid");
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
  const client = createPublicClient({ transport: http(env.CHILIZ_RPC_URL?.trim() || CHILIZ_CHAIN.rpcUrl,
    { timeout: 12_000, retryCount: 1 }) });
  const [chainId, latestBlock, transaction, receipt] = await Promise.all([
    client.getChainId(), client.getBlockNumber(),
    client.getTransaction({ hash: txHash as `0x${string}` }),
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
  ]);
  const tokenContract = (expectedPurchase?.fanTokenContract ?? expectedTransfer?.fanTokenContract) as `0x${string}`;
  const tokenDecimals = await client.readContract({ address: tokenContract,
    abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals",
    blockNumber: receipt.blockNumber });
  const evidence = { chainId, latestBlock, tokenDecimals, transaction, receipt };
  if (expectedPurchase) {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (!purchaseRewardAmountLamports || !block.timestamp) throw new Error("chiliz_spend_receipt_time_unavailable");
    const maxSpendChzWei = await quoteChilizPurchaseSpendCeiling(purchaseRewardAmountLamports,
      Number(block.timestamp) * 1_000);
    return verifyChilizPurchaseReceipt(evidence, { ...expectedPurchase, maxSpendChzWei }).acquiredAtomic.toString();
  }
  verifyChilizTransferReceipt(evidence, expectedTransfer!);
  return undefined;
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
  } else if (job.job_type === "solana_reward_purchase") {
    const [row, setting] = await Promise.all([
      database.prepare(`
        SELECT s.reward_amount_atomic, f.launch_id, l.mainnet_mint,
          l.mainnet_reward_treasury, l.reward_chain, l.reward_symbol, l.reward_mint,
          l.status AS launch_status
        FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
        JOIN launch_drafts l ON l.id = f.launch_id
        WHERE s.id = ?1 AND s.reward_swap_signature IS NULL
          AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
      `).bind(job.entity_id).first<{
        reward_amount_atomic: string; launch_id: string; mainnet_mint: string | null;
        mainnet_reward_treasury: string | null; reward_chain: string;
        reward_symbol: string; reward_mint: string | null; launch_status: string;
      }>(),
      database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
        .first<{ value: string }>(),
    ]);
    const asset = row && getRewardOption("solana", row.reward_symbol);
    if (!row || !asset || !setting?.value || job.entity_type !== "settlement" ||
      row.reward_chain !== "solana" || asset.tokenAddress !== row.reward_mint ||
      !row.mainnet_mint || row.mainnet_mint === setting.value ||
      row.mainnet_reward_treasury !== config.rewardTreasury ||
      row.launch_status !== "mainnet_published" ||
      !/^[1-9][0-9]*$/.test(row.reward_amount_atomic) ||
      payload.settlementId !== job.entity_id || payload.launchId !== row.launch_id ||
      payload.rewardAmountLamports !== row.reward_amount_atomic ||
      payload.rewardSymbol !== row.reward_symbol || payload.rewardMint !== row.reward_mint ||
      !reportedOutput || sourceTxHash ||
      (config.sportpadMint && config.sportpadMint !== setting.value)) {
      throw new Error("solana_reward_job_snapshot_mismatch");
    }
    expected = { mint: row.reward_mint, treasury: expectedWorkerTreasury,
      inputAmountLamports: row.reward_amount_atomic, purchasedAmountAtomic: reportedOutput };
  } else if (job.job_type === "sportpad_buyback_burn") {
    const [row, setting] = await Promise.all([
      database.prepare(`
        SELECT s.buyback_amount_atomic, s.buyback_swap_signature, s.burn_signature, f.launch_id,
          l.mainnet_mint, l.mainnet_buyback_treasury, l.status AS launch_status
        FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
        JOIN launch_drafts l ON l.id = f.launch_id
        WHERE s.id = ?1 AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
          AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
      `).bind(job.entity_id).first<{
        buyback_amount_atomic: string; buyback_swap_signature: string | null;
        burn_signature: string | null; launch_id: string; mainnet_mint: string | null;
        mainnet_buyback_treasury: string | null; launch_status: string;
      }>(),
      database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
        .first<{ value: string }>(),
    ]);
    if (!row || !setting?.value || !sourceTxHash || !reportedOutput ||
      !row.mainnet_mint || row.mainnet_mint === setting.value ||
      row.mainnet_buyback_treasury !== config.buybackTreasury ||
      !["mainnet_published", "mainnet_suspended"].includes(row.launch_status) ||
      !/^[1-9][0-9]*$/.test(row.buyback_amount_atomic) ||
      payload.settlementId !== job.entity_id || payload.launchId !== row.launch_id ||
      payload.amountLamports !== row.buyback_amount_atomic ||
      payload.sportpadMint !== setting.value ||
      (config.sportpadMint && config.sportpadMint !== setting.value)) {
      throw new Error("solana_buyback_job_snapshot_mismatch");
    }
    expected = { mint: setting.value, treasury: expectedWorkerTreasury,
      inputAmountLamports: row.buyback_amount_atomic, purchasedAmountAtomic: reportedOutput };
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
    verifySolanaClaimPayoutReceipt({
      ...(await loadEvidence(txHash)),
      mint: expected.mint, tokenProgram: mintAccount.owner.toBase58(), decimals: mintState.decimals,
      treasury: expected.treasury, recipient: expected.recipient!, amountAtomic: expected.amountAtomic!,
    });
    return undefined;
  }
  if (job.job_type === "solana_reward_purchase") {
    const intent = await database.prepare(`
      SELECT idempotency_key, settlement_id, signer_role, signer_address, action, state,
        provider_request_id, unsigned_transaction_base64, transaction_message_hash,
        tx_signature, input_mint, output_mint, input_amount_atomic,
        minimum_output_atomic, maximum_spend_lamports, expected_mints_json,
        expected_programs_json
      FROM transaction_intents WHERE idempotency_key = ?1 LIMIT 1
    `).bind(`automation:reward:swap:${job.entity_id}`).first<PersistedAutomaticBuybackIntent>();
    if (!intent?.minimum_output_atomic) throw new Error("solana_reward_intent_missing");
    const swap = await loadEvidence(txHash);
    const verified = verifySolanaRewardPurchaseReceipt({
      ...swap, mint: expected.mint, tokenProgram: mintAccount.owner.toBase58(),
      decimals: mintState.decimals, treasury: expected.treasury,
      inputAmountLamports: expected.inputAmountLamports!,
      purchasedAmountAtomic: expected.purchasedAmountAtomic!,
      minimumOutputAtomic: intent.minimum_output_atomic,
    });
    await verifyPersistedAutomaticRewardIntent({
      intent,
      expected: { settlementId: job.entity_id, treasury: expected.treasury,
        rewardMint: expected.mint, inputAmountLamports: expected.inputAmountLamports!,
        purchasedAmountAtomic: verified.purchasedAmountAtomic, swapSignature: txHash },
      swapReceipt: swap.receipt,
      swapStatus: swap.status,
    });
    return verified.purchasedAmountAtomic;
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
  await verifyPersistedAutomaticBuybackIntent({
    intent,
    expected: { settlementId: job.entity_id, treasury: expected.treasury,
      sportpadMint: expected.mint, inputAmountLamports: expected.inputAmountLamports!,
      purchasedAmountAtomic: verified.boughtAndBurnedAtomic, swapSignature: sourceTxHash! },
    swapReceipt: swap.receipt,
    swapStatus: swap.status,
  });
  return verified.boughtAndBurnedAtomic;
}

async function reconcilePreparedSolanaPurchase(database: D1Database, workerId: string) {
  const config = readMainnetConfig();
  if (!config.rewardTreasury || workerId !== `solana:${config.rewardTreasury}`) return;
  const row = await database.prepare(`
    SELECT j.id, j.job_type, j.entity_type, j.entity_id, j.chain,
      j.payload_json, j.state, j.attempt, j.leased_until, j.error_code,
      j.tx_hash, i.tx_signature AS prepared_signature
    FROM automation_jobs j JOIN transaction_intents i
      ON i.idempotency_key = 'automation:reward:swap:' || j.entity_id
    WHERE j.job_type = 'solana_reward_purchase'
      AND j.state IN ('broadcasting', 'reconciliation_required')
      AND i.tx_signature IS NOT NULL
      AND (j.state = 'reconciliation_required' OR j.error_code = ?1)
      AND (j.tx_hash IS NULL OR j.tx_hash = i.tx_signature)
      AND j.available_at <= ?2
    ORDER BY j.updated_at ASC LIMIT 1
  `).bind(`broadcasting:${workerId}`, Date.now())
    .first<AutomationRow & { prepared_signature: string }>();
  if (!row) return;
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
    if (!receipt || !status || status.confirmationStatus !== "finalized" ||
      status.err !== null) { await defer(); return; }
    const payload = JSON.parse(row.payload_json) as { rewardMint: string };
    const mint = new PublicKey(payload.rewardMint);
    const mintAccount = await rpc.getAccountInfo(mint, "finalized");
    if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
      !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) { await defer(); return; }
    const mintState = await getMint(rpc, mint, "finalized", mintAccount.owner);
    const output = observedSolanaRewardPurchaseOutput({
      signature: row.prepared_signature, receipt, status,
      mint: payload.rewardMint, tokenProgram: mintAccount.owner.toBase58(),
      decimals: mintState.decimals, treasury: config.rewardTreasury,
    });
    const verified = await verifiedSolanaOutput(database, row, workerId,
      row.prepared_signature, undefined, output);
    if (!verified) throw new Error("reward_reconciliation_output_missing");
    await completeJob(database, row, workerId, row.prepared_signature, verified);
  } catch (error) {
    // Never form a second purchase while the persisted signature is ambiguous.
    // A later lease retries this same finalized signature without rebroadcast.
    console.error("reward_purchase_reconciliation_pending",
      error instanceof Error ? error.message : "unknown");
    await defer();
  }
}

type PrepareBuybackRequest = Extract<z.infer<typeof requestSchema>, { action: "prepare_buyback_swap" }>;

async function persistPreparedBuybackSwap(database: D1Database, job: AutomationRow, input: PrepareBuybackRequest) {
  if (!FINANCIAL_LEDGER_VERIFIED || job.job_type !== "sportpad_buyback_burn" || job.chain !== "solana") {
    throw new Error("buyback_automation_lane_closed");
  }
  const config = readMainnetConfig();
  if (!config.buybackTreasury || input.workerId !== `solana:${config.buybackTreasury}`) {
    throw new Error("buyback_worker_treasury_mismatch");
  }
  const [settlement, setting] = await Promise.all([
    database.prepare(`
      SELECT s.buyback_amount_atomic, s.state, f.launch_id, l.mainnet_mint,
        l.mainnet_buyback_treasury, l.status AS launch_status
      FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE s.id = ?1 AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
    `).bind(job.entity_id).first<{
      buyback_amount_atomic: string; state: string; launch_id: string;
      mainnet_mint: string | null; mainnet_buyback_treasury: string | null;
      launch_status: string;
    }>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
  ]);
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  if (!settlement || !setting?.value || !settlement.mainnet_mint ||
    settlement.mainnet_mint === setting.value ||
    settlement.mainnet_buyback_treasury !== config.buybackTreasury ||
    !["mainnet_published", "mainnet_suspended"].includes(settlement.launch_status) ||
    !/^[1-9][0-9]*$/.test(settlement.buyback_amount_atomic) ||
    !["reconciled", "distributed", "reward_acquired"].includes(settlement.state) ||
    payload.settlementId !== job.entity_id || payload.launchId !== settlement.launch_id ||
    payload.sportpadMint !== setting.value || payload.amountLamports !== settlement.buyback_amount_atomic ||
    input.outputMint !== setting.value || input.inputAmountLamports !== settlement.buyback_amount_atomic ||
    (config.sportpadMint && config.sportpadMint !== setting.value) ||
    BigInt(input.inputAmountLamports) > 100_000_000n ||
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
  const inserted = await database.prepare(INSERT_AUTOMATIC_BUYBACK_INTENT_SQL).bind(
    intentId, idempotencyKey, job.entity_id, config.buybackTreasury,
    JSON.stringify(["jupiter_v2_metis_pinned"]),
    JSON.stringify([NATIVE_MINT.toBase58(), setting.value]),
    input.inputAmountLamports, input.providerRequestId,
    input.unsignedTransactionBase64, prepared.transactionMessageHash,
    input.lastValidBlockHeight, NATIVE_MINT.toBase58(), setting.value,
    input.inputAmountLamports, input.minimumOutputAtomic,
    prepared.txSignature, expiresAt, job.id, `broadcasting:${input.workerId}`,
  ).run();
  if (inserted.meta.changes !== 1) throw new Error("buyback_order_intent_conflict_or_paused");
  return { intentId, txSignature: prepared.txSignature };
}

type PrepareRewardRequest = Extract<z.infer<typeof requestSchema>, { action: "prepare_reward_swap" }>;

async function persistPreparedRewardSwap(database: D1Database, job: AutomationRow, input: PrepareRewardRequest) {
  if (!FINANCIAL_LEDGER_VERIFIED || job.job_type !== "solana_reward_purchase" ||
    job.entity_type !== "settlement" || job.chain !== "solana") {
    throw new Error("reward_purchase_automation_lane_closed");
  }
  const config = readMainnetConfig();
  if (!config.rewardTreasury || input.workerId !== `solana:${config.rewardTreasury}`) {
    throw new Error("reward_purchase_worker_treasury_mismatch");
  }
  const [settlement, setting] = await Promise.all([
    database.prepare(`
      SELECT s.reward_amount_atomic, s.state, f.launch_id, l.mainnet_mint,
        l.mainnet_reward_treasury, l.reward_chain, l.reward_symbol, l.reward_mint,
        l.status AS launch_status
      FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE s.id = ?1 AND s.reward_swap_signature IS NULL
    `).bind(job.entity_id).first<{
      reward_amount_atomic: string; state: string; launch_id: string;
      mainnet_mint: string | null; mainnet_reward_treasury: string | null;
      reward_chain: string; reward_symbol: string; reward_mint: string | null;
      launch_status: string;
    }>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
  ]);
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  const asset = settlement?.reward_chain === "solana"
    ? getRewardOption("solana", settlement.reward_symbol) : null;
  if (!settlement || !asset || !setting?.value || !settlement.mainnet_mint ||
    settlement.mainnet_mint === setting.value ||
    settlement.mainnet_reward_treasury !== config.rewardTreasury ||
    settlement.launch_status !== "mainnet_published" ||
    asset.tokenAddress !== settlement.reward_mint ||
    !/^[1-9][0-9]*$/.test(settlement.reward_amount_atomic) ||
    !["reconciled", "distributed", "buyback_burned"].includes(settlement.state) ||
    payload.settlementId !== job.entity_id || payload.launchId !== settlement.launch_id ||
    payload.rewardAmountLamports !== settlement.reward_amount_atomic ||
    payload.rewardSymbol !== settlement.reward_symbol || payload.rewardMint !== settlement.reward_mint ||
    input.outputMint !== settlement.reward_mint ||
    input.inputAmountLamports !== settlement.reward_amount_atomic ||
    (config.sportpadMint && config.sportpadMint !== setting.value) ||
    BigInt(input.inputAmountLamports) > 100_000_000n ||
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
  const inserted = await database.prepare(INSERT_AUTOMATIC_REWARD_INTENT_SQL).bind(
    intentId, `automation:reward:swap:${job.entity_id}`, job.entity_id, config.rewardTreasury,
    JSON.stringify(["jupiter_v2_metis_pinned"]),
    JSON.stringify([NATIVE_MINT.toBase58(), settlement.reward_mint]),
    input.inputAmountLamports, input.providerRequestId,
    input.unsignedTransactionBase64, prepared.transactionMessageHash,
    input.lastValidBlockHeight, NATIVE_MINT.toBase58(), settlement.reward_mint,
    input.inputAmountLamports, input.minimumOutputAtomic,
    prepared.txSignature, new Date(Date.now() + 90_000).toISOString(),
    job.id, `broadcasting:${input.workerId}`,
  ).run();
  if (inserted.meta.changes !== 1) throw new Error("reward_purchase_order_intent_conflict_or_paused");
  return { intentId, txSignature: prepared.txSignature };
}

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Automation database is unavailable." }, { status: 503 });
  if (!(await authorize(request))) return workerUnauthorized();
  let input: z.infer<typeof requestSchema>;
  try { input = requestSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid worker request." }, { status: 400 }); }
  if (input.action === "lease") {
    const controls = await readAutomationControls(env.DB);
    const allowedJobTypes = FINANCIAL_LEDGER_VERIFIED
      ? input.jobTypes.filter((jobType) => laneAllowsJob(jobType, controls) &&
        (CHILIZ_ASSET_MIGRATION_VERIFIED || !jobType.startsWith("chiliz_"))) : [];
    await env.DB.prepare(`
      INSERT INTO service_cursors (key, value, updated_at)
      VALUES (?1, ?2, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(`automation:${input.workerId}`, JSON.stringify({ jobTypes: allowedJobTypes, observedAt: Date.now() })).run();
    if (allowedJobTypes.includes("chiliz_reward_purchase")) await seedPurchaseJobs(env.DB);
    if (allowedJobTypes.includes("solana_reward_purchase")) await seedSolanaPurchaseJobs(env.DB);
    if (allowedJobTypes.includes("solana_reward_purchase")) {
      const rewardTreasury = readMainnetConfig().rewardTreasury;
      if (rewardTreasury && input.workerId === `solana:${rewardTreasury}`) {
        await env.DB.prepare(REQUEUE_UNPREPARED_REWARD_JOB_SQL)
          .bind(Date.now(), `broadcasting:${input.workerId}`).run();
      }
      await reconcilePreparedSolanaPurchase(env.DB, input.workerId);
    }
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
    input.action === "complete" || input.action === "prepare_buyback_swap" ||
      input.action === "prepare_reward_swap" ? !ownedBroadcast :
      !ownedLease && !ownedBroadcast)) {
    return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
  }
  if (input.action === "arm") {
    const controls = await readAutomationControls(env.DB);
    const pauseSql = pauseConditionSql(job.job_type);
    if (!FINANCIAL_LEDGER_VERIFIED ||
      (!CHILIZ_ASSET_MIGRATION_VERIFIED && job.job_type.startsWith("chiliz_")) ||
      !pauseSql || !laneAllowsJob(job.job_type, controls)) {
      return Response.json({ error: "Financial lane is paused or unavailable." }, { status: 409 });
    }
    // Arm before the first irreversible transaction. A crashed or timed-out worker
    // leaves this job out of the automatic lease pool until on-chain reconciliation.
    const result = await env.DB.prepare(`
      UPDATE automation_jobs SET state = 'broadcasting', leased_until = NULL,
        error_code = ?3, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND state = 'leased' AND error_code = ?2 AND leased_until >= ?4
        AND EXISTS (SELECT 1 FROM protocol_controls WHERE key = 'global' AND ${pauseSql})
        AND (job_type <> 'sportpad_buyback_burn' OR EXISTS (
          SELECT 1 FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
          JOIN launch_drafts l ON l.id = f.launch_id
          JOIN protocol_settings p ON p.key = 'sportpad_mint'
          WHERE s.id = automation_jobs.entity_id
            AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
            AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
            AND l.status IN ('mainnet_published', 'mainnet_suspended')
            AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
            AND s.buyback_amount_atomic GLOB '[1-9]*'
            AND s.buyback_amount_atomic NOT GLOB '*[^0-9]*'
        ))
        AND (job_type <> 'solana_reward_purchase' OR EXISTS (
          SELECT 1 FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
          JOIN launch_drafts l ON l.id = f.launch_id
          JOIN protocol_settings p ON p.key = 'sportpad_mint'
          WHERE s.id = automation_jobs.entity_id
            AND s.reward_swap_signature IS NULL
            AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
            AND l.status = 'mainnet_published'
            AND l.reward_chain = 'solana' AND l.reward_mint IS NOT NULL
            AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
            AND s.reward_amount_atomic GLOB '[1-9]*'
            AND s.reward_amount_atomic NOT GLOB '*[^0-9]*'
        ))
    `).bind(job.id, `leased:${input.workerId}`, `broadcasting:${input.workerId}`, Date.now()).run();
    if (result.meta.changes !== 1) return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
    return Response.json({ armed: true });
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
  if (input.action === "prepare_reward_swap") {
    try {
      const prepared = await persistPreparedRewardSwap(env.DB, job, input);
      return Response.json({ prepared: true, ...prepared });
    } catch (error) {
      console.error("reward_purchase_order_prepare_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Reward purchase order could not be durably prepared." }, { status: 409 });
    }
  }
  if (input.action === "complete") {
    if (!FINANCIAL_LEDGER_VERIFIED ||
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
    if (job.job_type === "chiliz_reward_purchase" || job.job_type === "chiliz_claim_unwrap") {
      try {
        verifiedOutput = await verifiedChilizOutput(env.DB, job, input.workerId, input.txHash, input.outputAmountAtomic);
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
        verifiedOutput = await verifiedSolanaOutput(env.DB, job, input.workerId, input.txHash,
          input.sourceTxHash, input.outputAmountAtomic);
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
        await completeJob(env.DB, job, input.workerId, input.txHash, verifiedOutput, input.sourceTxHash);
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
