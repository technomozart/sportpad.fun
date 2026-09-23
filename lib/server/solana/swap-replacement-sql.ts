/** Archive exactly one proven-expired signed order before inserting its
 * replacement in the same D1 batch. A failed insert rolls back this update.
 * Bind: canonical key, old signature, old message hash, signer, action,
 * job ID, entity type, entity ID, job type, worker broadcast fence. */
export const ARCHIVE_EXPIRED_SWAP_INTENT_SQL = `
  UPDATE transaction_intents SET
    idempotency_key = ?1 || ':expired:' || ?2,
    reward_batch_id = NULL, state = 'expired',
    error_code = 'blockhash_expired_proven_absent',
    updated_at = CURRENT_TIMESTAMP
  WHERE idempotency_key = ?1 AND state = 'prepared'
    AND tx_signature = ?2 AND transaction_message_hash = ?3
    AND signer_address = ?4 AND action = ?5
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.id = ?6 AND job.entity_type = ?7 AND job.entity_id = ?8
        AND job.job_type = ?9 AND job.state = 'broadcasting'
        AND job.error_code = ?10 AND job.tx_hash IS NULL)
`;
