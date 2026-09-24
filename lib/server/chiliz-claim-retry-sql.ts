/** Storage-only retry preparation. Bind a fresh retry job ID, the immutable
 * failed predecessor job ID, and an available-at millisecond timestamp.
 * The job and paused policy inserts, each followed by a one-row assertion,
 * must commit in one D1 batch. No worker recognizes this job type yet. */
export const INSERT_CHILIZ_CLAIM_RETRY_JOB_SQL = `
  INSERT INTO automation_jobs
    (id, job_type, entity_type, entity_id, chain, payload_json, state,
     attempt, available_at, retry_of_job_id)
  SELECT ?1, 'chiliz_claim_retry', 'reward_claim', predecessor.entity_id,
    'chiliz', json_remove(predecessor.payload_json, '$.reconciliationReceipt'),
    'queued', 0, ?3, predecessor.id
  FROM automation_jobs predecessor
  JOIN chiliz_signed_intents intent ON intent.job_id = predecessor.id
  JOIN chiliz_intent_policy original_policy
    ON original_policy.key = 'claim_canary'
   AND original_policy.authorized_job_id = predecessor.id
   AND original_policy.reserved_intent_id = intent.id
  JOIN reward_claims claim ON claim.id = predecessor.entity_id
  WHERE predecessor.id = ?2 AND ?3 >= 0
    AND predecessor.job_type = 'chiliz_claim_unwrap'
    AND predecessor.entity_type = 'reward_claim'
    AND predecessor.chain = 'chiliz' AND predecessor.state = 'failed'
    AND predecessor.error_code = 'chiliz_finalized_reverted'
    AND predecessor.tx_hash = intent.tx_hash
    AND intent.kind = 'claim' AND intent.state = 'finalized_reverted'
    AND intent.receipt_status = 'reverted'
    AND intent.receipt_block_hash = intent.canonical_receipt_block_hash
    AND intent.receipt_block_number >= 0
    AND intent.finalized_block_number >= intent.receipt_block_number
    AND intent.evidence_json IS NOT NULL AND json_valid(intent.evidence_json)
    AND intent.principal_spent_wei = '0'
    AND intent.network_fee_wei = intent.total_spent_wei
    AND claim.state = 'queued' AND claim.claim_signature IS NULL
    AND claim.destination_chain = 'chiliz'
`;

/** Bind the fresh retry job ID and a canonical decimal maximum signed spend
 * in wei. The predecessor's actual finalized gas plus the new maximum must
 * fit under the original claim lane's 1 CHZ ceiling. No row is pre-armed. */
export const INSERT_PAUSED_CHILIZ_CLAIM_RETRY_POLICY_SQL = `
  INSERT INTO chiliz_claim_retry_policy
    (job_id, predecessor_job_id, predecessor_intent_id,
     predecessor_tx_hash, predecessor_receipt_block_hash,
     predecessor_receipt_block_number, predecessor_finalized_block_number,
     predecessor_evidence_json, predecessor_spent_wei, max_retry_spend_wei)
  SELECT retry.id, predecessor.id, intent.id, intent.tx_hash,
    intent.receipt_block_hash, intent.receipt_block_number,
    intent.finalized_block_number, intent.evidence_json,
    intent.total_spent_wei, ?2
  FROM automation_jobs retry
  JOIN automation_jobs predecessor ON predecessor.id = retry.retry_of_job_id
  JOIN chiliz_signed_intents intent ON intent.job_id = predecessor.id
  JOIN reward_claims claim ON claim.id = retry.entity_id
  WHERE retry.id = ?1 AND retry.job_type = 'chiliz_claim_retry'
    AND retry.chain = 'chiliz' AND retry.state = 'queued' AND retry.attempt = 0
    AND retry.tx_hash IS NULL AND retry.error_code IS NULL
    AND predecessor.job_type = 'chiliz_claim_unwrap'
    AND predecessor.state = 'failed'
    AND predecessor.error_code = 'chiliz_finalized_reverted'
    AND predecessor.tx_hash = intent.tx_hash
    AND intent.kind = 'claim' AND intent.state = 'finalized_reverted'
    AND intent.receipt_status = 'reverted'
    AND intent.receipt_block_hash = intent.canonical_receipt_block_hash
    AND intent.receipt_block_number >= 0
    AND intent.finalized_block_number >= intent.receipt_block_number
    AND intent.principal_spent_wei = '0'
    AND intent.network_fee_wei = intent.total_spent_wei
    AND claim.state = 'queued' AND claim.claim_signature IS NULL
    AND ?2 GLOB '[1-9]*' AND ?2 NOT GLOB '*[^0-9]*'
    AND (length(?2) < 19 OR ?2 = '1000000000000000000')
    AND CAST(intent.total_spent_wei AS INTEGER) + CAST(?2 AS INTEGER) <= 1000000000000000000
`;
