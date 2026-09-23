export type AutomationOwnership = {
  state: string;
  leased_until: number | null;
  error_code: string | null;
};

// This stays false until atomic ledger accounting and on-chain receipt
// verification have passed funded canaries. Running a worker is not readiness.
export const FINANCIAL_LEDGER_VERIFIED = false;

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

export const HOLD_BROADCAST_RECEIPT_SQL = `
  UPDATE automation_jobs SET state = 'reconciliation_required', tx_hash = ?2,
    payload_json = json_set(payload_json, '$.reconciliationReceipt', json(?3)),
    error_code = 'ledger_verification_required', leased_until = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'broadcasting' AND error_code = ?4
`;
