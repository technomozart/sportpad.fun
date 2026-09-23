/** The exact signed claim transfer must be committed before sendRawTransaction.
 * The signed bytes live in unsigned_transaction_base64 for this action only;
 * no schema change is needed and the separate action prevents confusing them
 * with unsigned wallet plans. */
export const INSERT_AUTOMATIC_CLAIM_INTENT_SQL = `
  INSERT INTO transaction_intents (
    id, idempotency_key, claim_id, signer_role, signer_address,
    action, state, expected_programs_json, expected_mints_json,
    maximum_spend_lamports, provider_request_id, unsigned_transaction_base64,
    transaction_message_hash, last_valid_block_height, input_mint,
    input_amount_atomic, tx_signature, expires_at,
    claim_history_anchor_signature
  ) SELECT
    ?1, ?2, ?3, 'reward_treasury', ?4,
    'solana_claim_payout_automation', 'prepared', ?5, ?6,
    '500000', ?7, ?8,
    ?9, ?10, ?11,
    ?12, ?13, ?14, ?18
  WHERE EXISTS (
    SELECT 1 FROM automation_jobs j
    JOIN reward_claims c ON c.id = j.entity_id
    JOIN reward_epochs e ON e.id = c.epoch_id
    JOIN launch_drafts l ON l.id = e.launch_id
    WHERE j.id = ?15 AND j.job_type = 'solana_claim_payout'
      AND j.entity_type = 'reward_claim' AND j.chain = 'solana'
      AND j.entity_id = ?3 AND j.state = 'broadcasting'
      AND j.error_code = ?16 AND c.state = 'queued'
      AND c.claim_signature IS NULL AND c.destination_chain = 'solana'
      AND c.destination_address = ?17 AND c.amount_atomic = ?12
      AND l.reward_chain = 'solana' AND l.reward_mint = ?11
      AND l.mainnet_reward_treasury = ?4
      AND l.status = 'mainnet_published'
  ) AND ?18 IS NOT NULL AND ?18 <> ?13 AND EXISTS (
    SELECT 1 FROM protocol_controls p WHERE p.key = 'global' AND p.rewards_paused = 0
  )
`;

export const COMPLETE_AUTOMATIC_CLAIM_INTENT_SQL = `
  UPDATE transaction_intents SET state = 'confirmed', updated_at = CURRENT_TIMESTAMP
  WHERE idempotency_key = ?1 AND claim_id = ?2
    AND action = 'solana_claim_payout_automation'
    AND tx_signature = ?3 AND state = 'prepared'
`;

export const REQUEUE_UNPREPARED_CLAIM_JOB_SQL = `
  UPDATE automation_jobs SET state = 'queued', error_code = NULL,
    leased_until = NULL, available_at = ?1, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?2 AND job_type = 'solana_claim_payout'
    AND state IN ('broadcasting', 'reconciliation_required')
    AND (state = 'reconciliation_required' OR error_code = ?3)
    AND tx_hash IS NULL AND updated_at < datetime('now', '-5 minutes')
    AND NOT EXISTS (SELECT 1 FROM transaction_intents i
      WHERE i.claim_id = automation_jobs.entity_id
        AND i.action = 'solana_claim_payout_automation'
        AND i.idempotency_key = 'automation:claim:payout:' ||
          automation_jobs.id || ':' || automation_jobs.attempt)
`;

/** Only call these as a single D1 batch after proving the persisted signed
 * transfer absent from finalized source-ATA history through its anchor. The
 * intent archive must succeed before the job is made leasable again. */
export const ARCHIVE_PROVEN_ABSENT_CLAIM_INTENT_SQL = `
  UPDATE transaction_intents SET state = 'expired_unlanded',
    error_code = 'finalized_absence_proven', updated_at = CURRENT_TIMESTAMP
  WHERE idempotency_key = ?1 AND claim_id = ?2 AND tx_signature = ?3
    AND claim_history_anchor_signature = ?4
    AND action = 'solana_claim_payout_automation' AND state = 'prepared'
    AND EXISTS (SELECT 1 FROM reward_claims c WHERE c.id = ?2
      AND c.state = 'queued' AND c.claim_signature IS NULL)
    AND EXISTS (SELECT 1 FROM automation_jobs j WHERE j.id = ?5
      AND j.job_type = 'solana_claim_payout' AND j.entity_type = 'reward_claim'
      AND j.entity_id = ?2 AND j.chain = 'solana' AND j.attempt = ?6
      AND j.state IN ('broadcasting', 'reconciliation_required')
      AND (j.state = 'reconciliation_required' OR j.error_code = ?7)
      AND (j.tx_hash IS NULL OR j.tx_hash = ?3))
`;

export const REQUEUE_PROVEN_ABSENT_CLAIM_JOB_SQL = `
  UPDATE automation_jobs SET state = 'queued', error_code = NULL,
    tx_hash = NULL, leased_until = NULL, available_at = ?1,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?2 AND attempt = ?3 AND job_type = 'solana_claim_payout'
    AND entity_type = 'reward_claim' AND chain = 'solana'
    AND state IN ('broadcasting', 'reconciliation_required')
    AND (state = 'reconciliation_required' OR error_code = ?4)
    AND (tx_hash IS NULL OR tx_hash = ?5)
    AND EXISTS (SELECT 1 FROM transaction_intents i
      WHERE i.idempotency_key = ?6 AND i.claim_id = automation_jobs.entity_id
        AND i.action = 'solana_claim_payout_automation'
        AND i.tx_signature = ?5 AND i.state = 'expired_unlanded'
        AND i.error_code = 'finalized_absence_proven')
`;
