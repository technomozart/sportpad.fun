export type AutomationOwnership = {
  state: string;
  leased_until: number | null;
  error_code: string | null;
};

// This stays false until atomic ledger accounting and on-chain receipt
// verification have passed funded canaries. Running a worker is not readiness.
export const FINANCIAL_LEDGER_VERIFIED = false;

// D1 batch rolls back on SQL errors, not on an UPDATE/INSERT that changed zero
// rows. Place this immediately after every conditional ledger write in a batch.
// A zero-row CAS conflict deliberately raises a SQLite JSON error, rolling
// back *all* prior writes in that batch. SQLite RAISE() is trigger-only.
export const ASSERT_ONE_ROW_CHANGED_SQL = `
  SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('sportpad_cas_conflict', '$') END AS changed
`;

export const COMPLETE_BROADCAST_JOB_SQL = `
  UPDATE automation_jobs SET state = 'complete', tx_hash = ?2, error_code = NULL,
    leased_until = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'broadcasting' AND error_code = ?3
`;

export const COMPLETE_RECONCILED_JOB_SQL = `
  UPDATE automation_jobs SET state = 'complete', tx_hash = ?2, error_code = NULL,
    leased_until = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'reconciliation_required'
    AND (tx_hash IS NULL OR tx_hash = ?2)
    AND job_type = 'solana_reward_purchase'
`;

// Arming may precede ATA creation and quote acquisition. If no order was ever
// persisted and no hash was reported, the compliant worker could not have
// broadcast a reward swap. Requeue only that provably pre-broadcast state.
export const REQUEUE_UNPREPARED_REWARD_JOB_SQL = `
  UPDATE automation_jobs SET state = 'queued', error_code = NULL,
    leased_until = NULL, available_at = ?1, updated_at = CURRENT_TIMESTAMP
  WHERE job_type = 'solana_reward_purchase'
    AND state IN ('broadcasting', 'reconciliation_required')
    AND (state = 'reconciliation_required' OR error_code = ?2)
    AND tx_hash IS NULL
    AND updated_at < datetime('now', '-5 minutes')
    AND NOT EXISTS (SELECT 1 FROM transaction_intents i
      WHERE i.settlement_id = automation_jobs.entity_id
        AND i.action = 'solana_reward_purchase_automation')
`;

export const COMPLETE_CLAIM_VAULT_SQL = `
  UPDATE reward_vaults SET inventory_atomic = ?3, reserved_atomic = ?4,
    claimed_atomic = ?5, updated_at = CURRENT_TIMESTAMP
  WHERE launch_id = ?1 AND reward_mint = ?2 AND chain = ?9
    AND inventory_atomic = ?6 AND reserved_atomic = ?7 AND claimed_atomic = ?8
`;

export const COMPLETE_CLAIM_SQL = `
  UPDATE reward_claims SET state = 'confirmed', claim_signature = ?2,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'queued' AND claim_signature IS NULL
`;

export const COMPLETE_PURCHASE_SETTLEMENT_SQL = `
  UPDATE settlements SET reward_swap_signature = ?2,
    state = CASE WHEN buyback_swap_signature IS NOT NULL AND burn_signature IS NOT NULL
      THEN 'complete' ELSE 'reward_acquired' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND reward_swap_signature IS NULL
    AND state IN ('reconciled', 'distributed', 'buyback_burned')
    AND EXISTS (
      SELECT 1 FROM fee_events f JOIN launch_drafts l ON l.id = f.launch_id
      WHERE f.id = settlements.fee_event_id AND f.launch_id = ?3
        AND l.reward_chain = 'chiliz' AND l.reward_mint = ?4
        AND l.reward_wrapped_contract IS NULL
    )
`;

export const COMPLETE_SOLANA_PURCHASE_SETTLEMENT_SQL = `
  UPDATE settlements SET reward_swap_signature = ?2,
    state = CASE WHEN buyback_swap_signature IS NOT NULL AND burn_signature IS NOT NULL
      THEN 'complete' ELSE 'reward_acquired' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND reward_swap_signature IS NULL
    AND state IN ('reconciled', 'distributed', 'buyback_burned')
    AND reward_amount_atomic = ?6
    AND EXISTS (
      SELECT 1 FROM fee_events f JOIN launch_drafts l ON l.id = f.launch_id
      JOIN protocol_settings p ON p.key = 'sportpad_mint'
      WHERE f.id = settlements.fee_event_id AND f.launch_id = ?3
        AND l.reward_chain = 'solana' AND l.reward_mint = ?4
        AND l.status = 'mainnet_published'
        AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
        AND l.mainnet_reward_treasury = ?5
    )
    AND NOT EXISTS (
      SELECT 1 FROM settlements other
      WHERE other.id <> ?1 AND other.reward_swap_signature = ?2
    )
`;

export const COMPLETE_BUYBACK_SETTLEMENT_SQL = `
  UPDATE settlements SET buyback_swap_signature = ?2, burn_signature = ?3,
    state = CASE WHEN reward_swap_signature IS NOT NULL
      THEN 'complete' ELSE 'buyback_burned' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND buyback_swap_signature IS NULL AND burn_signature IS NULL
    AND state IN ('reconciled', 'distributed', 'reward_acquired')
    AND EXISTS (
      SELECT 1 FROM fee_events f JOIN launch_drafts l ON l.id = f.launch_id
      JOIN protocol_settings p ON p.key = 'sportpad_mint'
      WHERE f.id = settlements.fee_event_id AND l.mainnet_mint IS NOT NULL
        AND l.mainnet_mint <> p.value
    )
    AND NOT EXISTS (
      SELECT 1 FROM settlements other
      WHERE other.id <> ?1 AND other.buyback_swap_signature = ?2
    )
`;

// SPORTPAD's own creator fees belong to project development. Exclude its mint
// again at job creation even though the fee indexer normally skips it.
export const ELIGIBLE_COMMUNITY_BUYBACK_SETTLEMENTS_SQL = `
  SELECT s.id AS settlement_id, s.buyback_amount_atomic, f.launch_id
  FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
  JOIN launch_drafts l ON l.id = f.launch_id
  WHERE l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> ?1
    AND l.status IN ('mainnet_published', 'mainnet_suspended')
    AND s.buyback_amount_atomic GLOB '[1-9]*'
    AND s.buyback_amount_atomic NOT GLOB '*[^0-9]*'
    AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
    AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
  ORDER BY s.created_at ASC LIMIT 25
`;

export const COMPLETE_PURCHASE_VAULT_SQL = `
  INSERT INTO reward_vaults
    (id, launch_id, reward_mint, chain, owner_address, state, inventory_atomic, updated_at)
  VALUES (?1, ?2, ?3, 'chiliz', ?4, 'funded', ?5, CURRENT_TIMESTAMP)
  ON CONFLICT(launch_id, reward_mint) DO UPDATE SET
    inventory_atomic = excluded.inventory_atomic,
    state = 'funded', owner_address = excluded.owner_address,
    updated_at = CURRENT_TIMESTAMP
  WHERE reward_vaults.chain = 'chiliz' AND reward_vaults.inventory_atomic = ?6
`;

export const COMPLETE_SOLANA_PURCHASE_VAULT_SQL = `
  INSERT INTO reward_vaults
    (id, launch_id, reward_mint, chain, owner_address, token_account, state,
     inventory_atomic, last_observed_slot, updated_at)
  VALUES (?1, ?2, ?3, 'solana', ?4, ?5, 'funded', ?6, ?7, CURRENT_TIMESTAMP)
  ON CONFLICT(launch_id, reward_mint) DO UPDATE SET
    inventory_atomic = excluded.inventory_atomic,
    state = 'funded', owner_address = excluded.owner_address,
    token_account = excluded.token_account,
    last_observed_slot = excluded.last_observed_slot,
    updated_at = CURRENT_TIMESTAMP
  WHERE reward_vaults.chain = 'solana' AND reward_vaults.inventory_atomic = ?8
    AND reward_vaults.owner_address = ?4
    AND (reward_vaults.token_account IS NULL OR reward_vaults.token_account = ?5)
`;

export const FENCE_CHILIZ_EPOCH_SQL = `
  UPDATE reward_epochs SET state = 'allocating', updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'accruing' AND funded_amount_atomic = ?2
    AND datetime(ends_at) <= CURRENT_TIMESTAMP
    AND EXISTS (SELECT 1 FROM holder_snapshot_checkpoints c
      WHERE c.epoch_id = reward_epochs.id
        AND c.last_observed_at >= CAST(strftime('%s', reward_epochs.ends_at) AS INTEGER))
`;

export const DEFER_CHILIZ_EPOCH_SQL = `
  UPDATE reward_epochs SET state = 'accruing',
    ends_at = datetime(CURRENT_TIMESTAMP, '+1 hour'), updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'allocating' AND funded_amount_atomic = ?2
`;

export type AutomationJobType = "chiliz_reward_purchase" | "chiliz_claim_unwrap" |
  "solana_reward_purchase" | "solana_claim_payout" | "sportpad_buyback_burn";

export type AutomationLaneControls = {
  mainnetEnabled: boolean;
  settlementEnabled: boolean;
  rewardsEnabled: boolean;
  claimsEnabled: boolean;
  buybackEnabled: boolean;
  settlementPaused: boolean;
  rewardsPaused: boolean;
  buybackPaused: boolean;
};

export function laneAllowsJob(jobType: string, controls: AutomationLaneControls) {
  if (!controls.mainnetEnabled) return false;
  switch (jobType) {
    case "chiliz_reward_purchase":
    case "solana_reward_purchase":
      return controls.settlementEnabled && controls.rewardsEnabled
        && !controls.settlementPaused && !controls.rewardsPaused;
    case "chiliz_claim_unwrap":
    case "solana_claim_payout":
      return controls.rewardsEnabled && controls.claimsEnabled && !controls.rewardsPaused;
    case "sportpad_buyback_burn":
      return controls.settlementEnabled && controls.buybackEnabled
        && !controls.settlementPaused && !controls.buybackPaused;
    default:
      return false;
  }
}

export function pauseConditionSql(jobType: string) {
  switch (jobType) {
    case "chiliz_reward_purchase":
    case "solana_reward_purchase": return "settlement_paused = 0 AND rewards_paused = 0";
    case "chiliz_claim_unwrap":
    case "solana_claim_payout": return "rewards_paused = 0";
    case "sportpad_buyback_burn": return "settlement_paused = 0 AND buyback_paused = 0";
    default: return null;
  }
}

export function ownsActiveLease(job: AutomationOwnership | null, workerId: string, now: number) {
  return job?.state === "leased" && job.leased_until !== null && job.leased_until >= now
    && job.error_code === `leased:${workerId}`;
}

export function ownsBroadcast(job: AutomationOwnership | null, workerId: string) {
  return job?.state === "broadcasting" && job.error_code === `broadcasting:${workerId}`;
}

export function failureDisposition(wasBroadcasting: boolean, retryable: boolean) {
  if (wasBroadcasting) return { state: "reconciliation_required", retry: false } as const;
  return retryable ? { state: "queued", retry: true } as const : { state: "failed", retry: false } as const;
}

export const QUEUE_CLAIM_JOB_SQL = `
  INSERT INTO automation_jobs
    (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
  SELECT ?1, ?2, 'reward_claim', ?3, ?4, ?5, 'queued', ?6
  FROM reward_claims WHERE id = ?3 AND state = 'claimable'
  ON CONFLICT(entity_id, job_type) DO UPDATE SET
    id = excluded.id, payload_json = excluded.payload_json,
    state = 'queued', available_at = excluded.available_at,
    attempt = 0, tx_hash = NULL, error_code = NULL, leased_until = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE automation_jobs.state = 'failed'
`;

export const QUEUE_CLAIM_TRANSITION_SQL = `
  UPDATE reward_claims SET state = 'queued', destination_chain = ?2,
    destination_address = ?3, claim_requested_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'claimable' AND solana_wallet = ?5
    AND EXISTS (SELECT 1 FROM automation_jobs WHERE id = ?4 AND state = 'queued')
`;

export const HOLD_BROADCAST_RECEIPT_SQL = `
  UPDATE automation_jobs SET state = 'reconciliation_required', tx_hash = ?2,
    payload_json = json_set(payload_json, '$.reconciliationReceipt', json(?3)),
    error_code = 'ledger_verification_required', leased_until = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'broadcasting' AND error_code = ?4
`;
