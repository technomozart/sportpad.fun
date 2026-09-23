import { env } from "cloudflare:workers";
import { getMint, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createPublicClient, http, parseAbi } from "viem";
import { z } from "zod";

import { allocateEpochRewards } from "@/lib/protocol/accounting";
import { CHILIZ_CHAIN, getChilizRewardAsset } from "@/lib/protocol/chiliz-reward-assets";
import { CHILIZ_ASSET_MIGRATION_VERIFIED, verifyChilizPurchaseReceipt,
  verifyChilizTransferReceipt } from "@/lib/protocol/chiliz-receipts";
import { ASSERT_ONE_ROW_CHANGED_SQL, COMPLETE_BROADCAST_JOB_SQL, COMPLETE_BUYBACK_SETTLEMENT_SQL, COMPLETE_CLAIM_SQL,
  COMPLETE_CLAIM_VAULT_SQL, COMPLETE_PURCHASE_SETTLEMENT_SQL, COMPLETE_PURCHASE_VAULT_SQL,
  DEFER_CHILIZ_EPOCH_SQL, failureDisposition, FENCE_CHILIZ_EPOCH_SQL,
  FINANCIAL_LEDGER_VERIFIED, HOLD_BROADCAST_RECEIPT_SQL, laneAllowsJob,
  ownsActiveLease, ownsBroadcast, pauseConditionSql,
  type AutomationLaneControls } from "@/lib/protocol/automation-safety";
import { canonicalRewardAllocation } from "@/lib/protocol/holder-rewards";
import { getRewardOption } from "@/lib/protocol/reward-options";
import { quoteChilizPurchaseSpendCeiling } from "@/lib/server/chiliz-spend-bound";
import { DEFAULT_PROTOCOL_CONTROLS, readExecutionConfig, readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { verifySolanaClaimPayoutReceipt, verifySportpadBuybackReceipts } from "@/lib/server/solana/automation-receipt";
import { inspectPreparedAutomaticBuybackOrder, verifyPersistedAutomaticBuybackIntent,
  type PersistedAutomaticBuybackIntent } from "@/lib/server/solana/buyback-intent-proof";
import { INSERT_AUTOMATIC_BUYBACK_INTENT_SQL } from "@/lib/server/solana/buyback-order-sql";
import { getMainnetConnection } from "@/lib/server/solana/devnet";
import { secureTokenEqual, workerUnauthorized } from "@/lib/server/workers/auth";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("lease"),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    jobTypes: z.array(z.enum(["chiliz_reward_purchase", "chiliz_claim_unwrap", "solana_claim_payout", "sportpad_buyback_burn"])).min(1).max(4),
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

async function seedBuybackJobs(database: D1Database) {
  const setting = await database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
    .first<{ value: string }>();
  if (!setting?.value) return;
  const rows = await database.prepare(`
    SELECT s.id AS settlement_id, s.buyback_amount_atomic, f.launch_id
    FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
    WHERE s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
      AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
    ORDER BY s.created_at ASC LIMIT 25
  `).all<{ settlement_id: string; buyback_amount_atomic: string; launch_id: string }>();
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

async function closeMatureChilizEpoch(database: D1Database) {
  const epoch = await database.prepare(`
    SELECT e.id, e.launch_id, e.funded_amount_atomic, e.state, l.reward_mint
    FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
    WHERE e.state IN ('accruing', 'allocating') AND e.ends_at <= CURRENT_TIMESTAMP
      AND l.reward_chain = 'chiliz' AND l.reward_wrapped_contract IS NULL
    ORDER BY CASE WHEN e.state = 'allocating' THEN 0 ELSE 1 END, e.ends_at ASC LIMIT 1
  `).first<{
    id: string; launch_id: string; funded_amount_atomic: string; state: string;
    reward_mint: string;
  }>();
  if (!epoch) return;
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
    WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = 'chiliz'
  `).bind(epoch.launch_id, epoch.reward_mint).first<{
    inventory_atomic: string; allocated_atomic: string; reserved_atomic: string;
  }>();
  if (!vault) throw new Error("reward_vault_missing");
  const nextAllocated = (BigInt(vault.allocated_atomic) + allocatedAtomic).toString();
  const nextReserved = (BigInt(vault.reserved_atomic) + allocatedAtomic).toString();
  if (BigInt(nextReserved) > BigInt(vault.inventory_atomic)) throw new Error("reward_vault_inventory_insufficient");
  const statements: D1PreparedStatement[] = [
    database.prepare(`
      UPDATE reward_epochs SET state = 'claimable', allocated_amount_atomic = ?2, dust_amount_atomic = ?3,
        reward_decimals = 18, cutoff_slot = ?4, allocation_hash = ?5, closed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'allocating'
          AND funded_amount_atomic = ?6 AND ends_at <= CURRENT_TIMESTAMP
    `).bind(epoch.id, allocatedAtomic.toString(), dustAtomic.toString(), cutoffSlot, allocationHash, epoch.funded_amount_atomic),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    ...claims.flatMap((claim) => [
      database.prepare(`
        INSERT OR IGNORE INTO reward_claims (id, epoch_id, solana_wallet, amount_atomic, destination_chain, state)
        VALUES (?1, ?2, ?3, ?4, 'chiliz', 'claimable')
      `).bind(crypto.randomUUID(), epoch.id, claim.wallet, claim.amount.toString()),
      database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    ]),
    database.prepare(`
      INSERT OR IGNORE INTO protocol_events
        (id, category, entity_type, entity_id, event_type, idempotency_key, state, slot, amount_atomic, mint, evidence_hash)
      VALUES (?1, 'rewards', 'epoch', ?2, 'chiliz_reward_allocation_committed', ?1, 'verified', ?3, ?4, ?5, ?6)
    `).bind(`chiliz-allocation:${epoch.id}`, epoch.id, cutoffSlot, allocatedAtomic.toString(), epoch.reward_mint, allocationHash),
    database.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    database.prepare(`
      UPDATE reward_vaults SET allocated_atomic = ?3, reserved_atomic = ?4, updated_at = CURRENT_TIMESTAMP
      WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = 'chiliz'
        AND allocated_atomic = ?5 AND reserved_atomic = ?6 AND inventory_atomic = ?7
    `).bind(
      epoch.launch_id,
      epoch.reward_mint,
      nextAllocated,
      nextReserved,
      vault.allocated_atomic,
      vault.reserved_atomic,
      vault.inventory_atomic,
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
    database.prepare(COMPLETE_BROADCAST_JOB_SQL).bind(job.id, txHash, `broadcasting:${workerId}`),
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
  if (!config.rewardTreasury || !config.buybackTreasury ||
    ![config.rewardTreasury, config.buybackTreasury].includes(workerId.slice("solana:".length))) {
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
    expected = { mint: row.reward_mint, treasury: config.rewardTreasury,
      recipient: row.destination_address, amountAtomic: row.amount_atomic };
  } else if (job.job_type === "sportpad_buyback_burn") {
    const [row, setting] = await Promise.all([
      database.prepare(`
        SELECT s.buyback_amount_atomic, s.buyback_swap_signature, s.burn_signature, f.launch_id
        FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
        WHERE s.id = ?1 AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
          AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
      `).bind(job.entity_id).first<{
        buyback_amount_atomic: string; buyback_swap_signature: string | null;
        burn_signature: string | null; launch_id: string;
      }>(),
      database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
        .first<{ value: string }>(),
    ]);
    if (!row || !setting?.value || !sourceTxHash || !reportedOutput ||
      payload.settlementId !== job.entity_id || payload.launchId !== row.launch_id ||
      payload.amountLamports !== row.buyback_amount_atomic ||
      payload.sportpadMint !== setting.value ||
      (config.sportpadMint && config.sportpadMint !== setting.value)) {
      throw new Error("solana_buyback_job_snapshot_mismatch");
    }
    expected = { mint: setting.value, treasury: config.buybackTreasury,
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
        l.mainnet_buyback_treasury
      FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE s.id = ?1 AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
    `).bind(job.entity_id).first<{
      buyback_amount_atomic: string; state: string; launch_id: string;
      mainnet_mint: string | null; mainnet_buyback_treasury: string | null;
    }>(),
    database.prepare("SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'")
      .first<{ value: string }>(),
  ]);
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  if (!settlement || !setting?.value || !settlement.mainnet_mint ||
    settlement.mainnet_mint === setting.value ||
    settlement.mainnet_buyback_treasury !== config.buybackTreasury ||
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
    if (allowedJobTypes.includes("sportpad_buyback_burn")) await seedBuybackJobs(env.DB);
    if (allowedJobTypes.includes("chiliz_claim_unwrap") || allowedJobTypes.includes("chiliz_reward_purchase")) {
      await closeMatureChilizEpoch(env.DB);
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
    input.action === "complete" || input.action === "prepare_buyback_swap" ? !ownedBroadcast :
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
    } else if (job.job_type === "solana_claim_payout" || job.job_type === "sportpad_buyback_burn") {
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
