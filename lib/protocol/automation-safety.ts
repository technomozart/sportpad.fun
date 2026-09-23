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

export const COMPLETE_BUYBACK_SETTLEMENT_SQL = `
  UPDATE settlements SET buyback_swap_signature = ?2, burn_signature = ?3,
    state = CASE WHEN reward_swap_signature IS NOT NULL
      THEN 'complete' ELSE 'buyback_burned' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND buyback_swap_signature IS NULL AND burn_signature IS NULL
    AND state IN ('reconciled', 'distributed', 'reward_acquired')
    AND NOT EXISTS (
      SELECT 1 FROM settlements other
      WHERE other.id <> ?1 AND other.buyback_swap_signature = ?2
    )
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

export const FENCE_CHILIZ_EPOCH_SQL = `
  UPDATE reward_epochs SET state = 'allocating', updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'accruing' AND funded_amount_atomic = ?2
    AND ends_at <= CURRENT_TIMESTAMP
`;

export const DEFER_CHILIZ_EPOCH_SQL = `
  UPDATE reward_epochs SET state = 'accruing',
    ends_at = datetime(CURRENT_TIMESTAMP, '+1 hour'), updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'allocating' AND funded_amount_atomic = ?2
`;

export type AutomationJobType = "chiliz_reward_purchase" | "chiliz_claim_unwrap" | "solana_claim_payout" | "sportpad_buyback_burn";

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
    case "chiliz_reward_purchase": return "settlement_paused = 0 AND rewards_paused = 0";
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
