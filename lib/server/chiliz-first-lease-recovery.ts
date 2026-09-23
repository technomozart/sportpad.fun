/** A Chiliz job may be leased for execution only on its first attempt. A
 * failed first lease must pass the separate no-intent recovery CAS below
 * before it can enter this pool again. */
export const CHILIZ_FIRST_LEASE_ELIGIBLE_SQL = `
  (automation_jobs.chain <> 'chiliz' OR (
    automation_jobs.attempt = 0 AND automation_jobs.tx_hash IS NULL
    AND json_type(automation_jobs.payload_json, '$.reconciliationReceipt') IS NULL
    AND NOT EXISTS (SELECT 1 FROM chiliz_signed_intents i
      WHERE i.job_id = automation_jobs.id)
  ))
`;

/** Bind now (milliseconds), authenticated treasury worker ID, and whether
 * purchase and claim jobs were requested. The old lease or retry must have
 * aged five minutes. Only a still-armed, unreserved policy for that exact
 * canary job can restore attempt zero; any signed intent, hash, or receipt
 * keeps the job out of the lease pool for reconciliation. */
export const REQUEUE_UNPREPARED_CHILIZ_FIRST_LEASE_SQL = `
  UPDATE automation_jobs SET state = 'queued', attempt = 0,
    error_code = NULL, leased_until = NULL, available_at = ?1,
    updated_at = CURRENT_TIMESTAMP
  WHERE chain = 'chiliz' AND attempt = 1
    AND ((job_type = 'chiliz_reward_purchase' AND ?3 = 1) OR
         (job_type = 'chiliz_claim_unwrap' AND ?4 = 1))
    AND ((state = 'queued' AND available_at <= ?1 AND error_code IS NOT NULL) OR
         (state = 'leased' AND leased_until < ?1
           AND error_code = 'leased:' || ?2))
    AND updated_at < datetime('now', '-5 minutes')
    AND tx_hash IS NULL
    AND json_type(payload_json, '$.reconciliationReceipt') IS NULL
    AND NOT EXISTS (SELECT 1 FROM chiliz_signed_intents i
      WHERE i.job_id = automation_jobs.id)
    AND EXISTS (SELECT 1 FROM chiliz_intent_policy p
      WHERE p.authorized_job_id = automation_jobs.id
        AND p.state = 'armed' AND p.reserved_intent_id IS NULL
        AND ((p.key = 'purchase_canary' AND
          automation_jobs.job_type = 'chiliz_reward_purchase') OR
             (p.key = 'claim_canary' AND
          automation_jobs.job_type = 'chiliz_claim_unwrap')))
`;
