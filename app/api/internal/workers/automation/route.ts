import { env } from "cloudflare:workers";
import { z } from "zod";

import { allocateEpochRewards } from "@/lib/protocol/accounting";
import { failureDisposition, FINANCIAL_LEDGER_VERIFIED, HOLD_BROADCAST_RECEIPT_SQL, laneAllowsJob,
  ownsActiveLease, ownsBroadcast, pauseConditionSql,
  type AutomationLaneControls } from "@/lib/protocol/automation-safety";
import { canonicalRewardAllocation } from "@/lib/protocol/holder-rewards";
import { DEFAULT_PROTOCOL_CONTROLS, readExecutionConfig, readWorkerToken } from "@/lib/server/execution-config";
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
    action: z.literal("complete"),
    jobId: z.string().uuid(),
    workerId: z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/),
    txHash: z.string().regex(/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,96})$/),
    sourceTxHash: z.string().regex(/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,96})$/).optional(),
    outputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/).optional(),
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
      l.reward_symbol, l.reward_mint, l.reward_wrapped_contract
    FROM settlements s
    JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    WHERE l.reward_chain = 'chiliz' AND l.reward_mint IS NOT NULL AND l.reward_wrapped_contract IS NOT NULL
      AND s.reward_swap_signature IS NULL AND s.state IN ('reconciled', 'distributed')
    ORDER BY s.created_at ASC LIMIT 25
  `).all<{
    settlement_id: string; reward_amount_atomic: string; launch_id: string;
    reward_symbol: string; reward_mint: string; reward_wrapped_contract: string;
  }>();
  if (!rows.results.length) return;
  const now = Date.now();
  await database.batch(rows.results.map((row) => database.prepare(`
    INSERT OR IGNORE INTO automation_jobs
      (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
    VALUES (?1, 'chiliz_reward_purchase', 'settlement', ?2, 'chiliz', ?3, 'queued', ?4)
  `).bind(crypto.randomUUID(), row.settlement_id, JSON.stringify({
    settlementId: row.settlement_id,
    launchId: row.launch_id,
    rewardAmountLamports: row.reward_amount_atomic,
    rewardSymbol: row.reward_symbol,
    underlyingContract: row.reward_mint,
    wrappedContract: row.reward_wrapped_contract,
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
    SELECT e.id, e.launch_id, e.funded_amount_atomic, l.reward_mint, l.reward_wrapped_contract
    FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
    WHERE e.state = 'accruing' AND e.ends_at <= CURRENT_TIMESTAMP AND l.reward_chain = 'chiliz'
    ORDER BY e.ends_at ASC LIMIT 1
  `).first<{
    id: string; launch_id: string; funded_amount_atomic: string;
    reward_mint: string; reward_wrapped_contract: string;
  }>();
  if (!epoch) return;
  const positionRows = await database.prepare(`
    SELECT wallet, token_seconds_atomic, last_observed_slot FROM holder_epoch_positions
    WHERE epoch_id = ?1 AND excluded = 0 ORDER BY wallet
  `).bind(epoch.id).all<{ wallet: string; token_seconds_atomic: string; last_observed_slot: number | null }>();
  const positions = positionRows.results
    .map((row) => ({ ...row, weight: BigInt(row.token_seconds_atomic) }))
    .filter((row) => row.weight > 0n);
  if (!positions.length) {
    await database.prepare("UPDATE reward_epochs SET ends_at = datetime(CURRENT_TIMESTAMP, '+1 hour'), updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'accruing'")
      .bind(epoch.id).run();
    return;
  }
  const fundedAtomic = BigInt(epoch.funded_amount_atomic);
  const wholeUnits = fundedAtomic / 1_000_000_000_000_000_000n;
  if (wholeUnits <= 0n) return;
  const allocation = allocateEpochRewards(wholeUnits, positions.map((row) => ({ wallet: row.wallet, tokenSeconds: row.weight })));
  const claims = allocation.allocations
    .filter((entry) => entry.rewardAtomic > 0n)
    .map((entry) => ({ wallet: entry.wallet, amount: entry.rewardAtomic * 1_000_000_000_000_000_000n }));
  if (!claims.length) return;
  const allocatedAtomic = claims.reduce((sum, claim) => sum + claim.amount, 0n);
  const dustAtomic = fundedAtomic - allocatedAtomic;
  const cutoffSlot = positions.reduce((max, row) => Math.max(max, row.last_observed_slot ?? 0), 0);
  const allocationHash = await sha256Hex(canonicalRewardAllocation(claims.map((claim) => ({ wallet: claim.wallet, rewardAtomic: claim.amount }))));
  const vault = await database.prepare(`
    SELECT allocated_atomic, reserved_atomic FROM reward_vaults
    WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = 'chiliz'
  `).bind(epoch.launch_id, epoch.reward_wrapped_contract).first<{
    allocated_atomic: string; reserved_atomic: string;
  }>();
  if (!vault) throw new Error("reward_vault_missing");
  const nextAllocated = (BigInt(vault.allocated_atomic) + allocatedAtomic).toString();
  const nextReserved = (BigInt(vault.reserved_atomic) + allocatedAtomic).toString();
  const statements: D1PreparedStatement[] = [
    ...claims.map((claim) => database.prepare(`
      INSERT OR IGNORE INTO reward_claims (id, epoch_id, solana_wallet, amount_atomic, destination_chain, state)
      VALUES (?1, ?2, ?3, ?4, 'chiliz', 'claimable')
    `).bind(crypto.randomUUID(), epoch.id, claim.wallet, claim.amount.toString())),
    database.prepare(`
      UPDATE reward_epochs SET state = 'claimable', allocated_amount_atomic = ?2, dust_amount_atomic = ?3,
        reward_decimals = 18, cutoff_slot = ?4, allocation_hash = ?5, closed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'accruing'
    `).bind(epoch.id, allocatedAtomic.toString(), dustAtomic.toString(), cutoffSlot, allocationHash),
    database.prepare(`
      INSERT OR IGNORE INTO protocol_events
        (id, category, entity_type, entity_id, event_type, idempotency_key, state, slot, amount_atomic, mint, evidence_hash)
      VALUES (?1, 'rewards', 'epoch', ?2, 'chiliz_reward_allocation_committed', ?1, 'verified', ?3, ?4, ?5, ?6)
    `).bind(`chiliz-allocation:${epoch.id}`, epoch.id, cutoffSlot, allocatedAtomic.toString(), epoch.reward_mint, allocationHash),
    database.prepare(`
      UPDATE reward_vaults SET allocated_atomic = ?3, reserved_atomic = ?4, updated_at = CURRENT_TIMESTAMP
      WHERE launch_id = ?1 AND reward_mint = ?2 AND allocated_atomic = ?5 AND reserved_atomic = ?6
    `).bind(
      epoch.launch_id,
      epoch.reward_wrapped_contract,
      nextAllocated,
      nextReserved,
      vault.allocated_atomic,
      vault.reserved_atomic,
    ),
  ];
  await database.batch(statements);
}

async function leaseJob(database: D1Database, workerId: string, jobTypes: string[]) {
  const now = Date.now();
  const placeholders = jobTypes.map((_, index) => `?${index + 2}`).join(", ");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await database.prepare(`
      SELECT id, job_type, entity_type, entity_id, chain, payload_json, state, attempt, leased_until, error_code
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
  const statements: D1PreparedStatement[] = [];
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
    const vaultMint = claim.reward_chain === "chiliz" ? claim.reward_wrapped_contract : claim.reward_mint;
    if (!vaultMint) throw new Error("claim_vault_mint_missing");
    const vault = await database.prepare(`
      SELECT inventory_atomic, reserved_atomic, claimed_atomic FROM reward_vaults
      WHERE launch_id = ?1 AND reward_mint = ?2
    `).bind(claim.launch_id, vaultMint).first<{
      inventory_atomic: string; reserved_atomic: string; claimed_atomic: string;
    }>();
    if (!vault) throw new Error("claim_vault_missing");
    const claimAmount = BigInt(claim.amount_atomic);
    const inventory = BigInt(vault.inventory_atomic);
    const reserved = BigInt(vault.reserved_atomic);
    if (inventory < claimAmount || reserved < claimAmount) throw new Error("claim_vault_accounting_underflow");
    statements.push(database.prepare(`
      UPDATE reward_vaults SET inventory_atomic = ?3, reserved_atomic = ?4, claimed_atomic = ?5,
        updated_at = CURRENT_TIMESTAMP
      WHERE launch_id = ?1 AND reward_mint = ?2
        AND inventory_atomic = ?6 AND reserved_atomic = ?7 AND claimed_atomic = ?8
    `).bind(
      claim.launch_id,
      vaultMint,
      (inventory - claimAmount).toString(),
      (reserved - claimAmount).toString(),
      (BigInt(vault.claimed_atomic) + claimAmount).toString(),
      vault.inventory_atomic,
      vault.reserved_atomic,
      vault.claimed_atomic,
    ));
    statements.push(database.prepare(`
      UPDATE reward_claims SET state = 'confirmed', claim_signature = ?2, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND state = 'queued'
    `).bind(job.entity_id, txHash));
  } else if (job.job_type === "chiliz_reward_purchase") {
    if (!outputAmountAtomic) throw new Error("purchase_output_missing");
    const payload = JSON.parse(job.payload_json) as { launchId: string; wrappedContract: string };
    const owner = workerId.startsWith("chiliz:") ? workerId.slice("chiliz:".length) : env.CHILIZ_TREASURY_ADDRESS?.trim();
    if (!owner) throw new Error("chiliz_treasury_missing");
    const [vault, epoch] = await Promise.all([
      database.prepare("SELECT inventory_atomic FROM reward_vaults WHERE launch_id = ?1 AND reward_mint = ?2")
        .bind(payload.launchId, payload.wrappedContract).first<{ inventory_atomic: string }>(),
      database.prepare("SELECT id, funded_amount_atomic FROM reward_epochs WHERE launch_id = ?1 AND state = 'accruing' ORDER BY created_at DESC LIMIT 1")
        .bind(payload.launchId).first<{ id: string; funded_amount_atomic: string }>(),
    ]);
    const nextInventory = (BigInt(vault?.inventory_atomic ?? "0") + BigInt(outputAmountAtomic)).toString();
    const nextFunding = epoch ? (BigInt(epoch.funded_amount_atomic) + BigInt(outputAmountAtomic)).toString() : null;
    statements.push(
      database.prepare(`
        UPDATE settlements SET reward_swap_signature = ?2, state = 'reward_acquired', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND reward_swap_signature IS NULL
      `).bind(job.entity_id, txHash),
      database.prepare(`
        INSERT INTO reward_vaults
          (id, launch_id, reward_mint, chain, owner_address, state, inventory_atomic, updated_at)
        VALUES (?1, ?2, ?3, 'chiliz', ?4, 'funded', ?5, CURRENT_TIMESTAMP)
        ON CONFLICT(launch_id, reward_mint) DO UPDATE SET
          inventory_atomic = excluded.inventory_atomic,
          state = 'funded', owner_address = excluded.owner_address, updated_at = CURRENT_TIMESTAMP
      `).bind(crypto.randomUUID(), payload.launchId, payload.wrappedContract, owner, nextInventory),
    );
    if (epoch && nextFunding) {
      statements.push(database.prepare(`
        UPDATE reward_epochs SET funded_amount_atomic = ?2, reward_decimals = 18, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1 AND funded_amount_atomic = ?3
      `).bind(epoch.id, nextFunding, epoch.funded_amount_atomic));
    } else if (!epoch) {
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1_000);
      statements.push(database.prepare(`
        INSERT INTO reward_epochs
          (id, launch_id, starts_at, ends_at, funded_amount_atomic, reward_decimals, state)
        VALUES (?1, ?2, ?3, ?4, ?5, 18, 'accruing')
      `).bind(crypto.randomUUID(), payload.launchId, startsAt.toISOString(), endsAt.toISOString(), outputAmountAtomic));
    }
  } else if (job.job_type === "sportpad_buyback_burn") {
    if (!sourceTxHash) throw new Error("buyback_swap_receipt_missing");
    statements.push(database.prepare(`
      UPDATE settlements SET buyback_swap_signature = ?2, burn_signature = ?3,
        state = 'complete', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND burn_signature IS NULL
    `).bind(job.entity_id, sourceTxHash, txHash));
  }
  statements.push(database.prepare(`
    UPDATE automation_jobs SET state = 'complete', tx_hash = ?2, error_code = NULL,
      leased_until = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?1 AND state = 'broadcasting' AND error_code = ?3
  `).bind(job.id, txHash, `broadcasting:${workerId}`));
  const results = await database.batch(statements);
  if (results.at(-1)?.meta.changes !== 1) throw new Error("job_completion_conflict");
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
      ? input.jobTypes.filter((jobType) => laneAllowsJob(jobType, controls)) : [];
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
    SELECT id, job_type, entity_type, entity_id, chain, payload_json, state, attempt, leased_until, error_code
    FROM automation_jobs WHERE id = ?1
  `).bind(input.jobId).first<AutomationRow>();
  const ownedLease = ownsActiveLease(job, input.workerId, Date.now());
  const ownedBroadcast = ownsBroadcast(job, input.workerId);
  if (!job || (input.action === "arm" ? !ownedLease : input.action === "complete" ? !ownedBroadcast : !ownedLease && !ownedBroadcast)) {
    return Response.json({ error: "Worker lease is no longer valid." }, { status: 409 });
  }
  if (input.action === "arm") {
    const controls = await readAutomationControls(env.DB);
    const pauseSql = pauseConditionSql(job.job_type);
    if (!FINANCIAL_LEDGER_VERIFIED || !pauseSql || !laneAllowsJob(job.job_type, controls)) {
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
  if (input.action === "complete") {
    if (!FINANCIAL_LEDGER_VERIFIED) {
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
    try { await completeJob(env.DB, job, input.workerId, input.txHash, input.outputAmountAtomic, input.sourceTxHash); }
    catch (error) {
      console.error("automation_job_complete_failed", error instanceof Error ? error.message : "unknown");
      return Response.json({ error: "Automation receipt could not be committed." }, { status: 409 });
    }
    return Response.json({ completed: true });
  }
  const disposition = failureDisposition(ownedBroadcast, input.retryable);
  const retry = disposition.retry;
  const delaySeconds = Math.min(3_600, 15 * 2 ** Math.min(job.attempt, 8));
  await env.DB.prepare(`
    UPDATE automation_jobs SET state = ?2, error_code = ?3, available_at = ?4,
      leased_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = ?5 AND error_code = ?6
  `).bind(job.id, disposition.state, input.errorCode,
    Date.now() + delaySeconds * 1_000, ownedBroadcast ? "broadcasting" : "leased",
    ownedBroadcast ? `broadcasting:${input.workerId}` : `leased:${input.workerId}`).run();
  if (!ownedBroadcast && !retry && job.entity_type === "reward_claim") {
    await env.DB.prepare("UPDATE reward_claims SET state = 'claimable', updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'queued'")
      .bind(job.entity_id).run();
  }
  return Response.json({ failed: true, retrying: retry, reconciliationRequired: ownedBroadcast,
    retryAfterSeconds: retry ? delaySeconds : null });
}
