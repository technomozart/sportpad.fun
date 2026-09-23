/** Archive one proven, finalized failed reward-batch order only as part of the
 * same D1 batch that inserts its replacement. The sources and job remain
 * reserved/broadcasting; a concurrent change to either aborts the transaction.
 * Bind: canonical key, old signature, old message hash, treasury, job ID,
 * batch ID, worker broadcast fence, bounded fee, finalized slot. */
export const ARCHIVE_FINALIZED_FAILED_REWARD_BATCH_INTENT_SQL = `
  UPDATE transaction_intents SET
    idempotency_key = ?1 || ':failed:' || ?2,
    reward_batch_id = NULL, state = 'failed',
    error_code = 'finalized_failed_fee_' || ?8 || '_slot_' || ?9,
    updated_at = CURRENT_TIMESTAMP
  WHERE idempotency_key = ?1 AND state = 'prepared'
    AND reward_batch_id = ?6 AND tx_signature = ?2
    AND transaction_message_hash = ?3
    AND signer_role = 'reward_treasury' AND signer_address = ?4
    AND action = 'solana_reward_purchase_automation'
    AND settlement_id = (SELECT src.settlement_id FROM reward_swap_batch_sources src
      WHERE src.batch_id = ?6 ORDER BY src.created_at, src.settlement_id LIMIT 1)
    AND ?8 GLOB '[1-9]*' AND ?8 NOT GLOB '*[^0-9]*'
    AND CAST(?8 AS INTEGER) BETWEEN 1 AND 500000
    AND ?9 GLOB '[1-9]*' AND ?9 NOT GLOB '*[^0-9]*'
    AND input_amount_atomic GLOB '[1-9]*'
    AND input_amount_atomic NOT GLOB '*[^0-9]*'
    AND CAST(input_amount_atomic AS INTEGER) BETWEEN 1000000 AND 100000000
    AND NOT EXISTS (SELECT 1 FROM transaction_intents prior
      WHERE prior.idempotency_key LIKE ?1 || ':failed:%')
    -- A singleton canary reserves one input spend, not a second broadcast.
    -- A retry needs a future, separately authorized cumulative budget.
    AND NOT EXISTS (SELECT 1 FROM solana_reward_purchase_canary c
      WHERE c.reward_batch_id = ?6)
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.id = ?5 AND job.job_type = 'solana_reward_purchase'
        AND job.entity_type = 'reward_swap_batch' AND job.entity_id = ?6
        AND job.state = 'broadcasting' AND job.error_code = ?7
        AND job.tx_hash IS NULL
        AND json_extract(job.payload_json, '$.batchId') = ?6
        AND json_extract(job.payload_json, '$.rewardMint') = transaction_intents.output_mint
        AND json_extract(job.payload_json, '$.rewardAmountLamports') = transaction_intents.input_amount_atomic)
    AND EXISTS (SELECT 1 FROM reward_swap_batches b
      JOIN launch_drafts l ON l.id = b.launch_id
      WHERE b.id = ?6 AND b.state = 'broadcasting'
        AND b.tx_signature IS NULL AND b.treasury = ?4
        AND b.reward_mint = transaction_intents.output_mint
        AND b.input_amount_atomic = transaction_intents.input_amount_atomic
        AND l.reward_chain = 'solana' AND l.reward_mint = b.reward_mint
        AND l.mainnet_reward_treasury = b.treasury
        AND l.status = 'mainnet_published'
        AND EXISTS (SELECT 1 FROM reward_swap_batch_sources src
          WHERE src.batch_id = b.id AND src.state = 'reserved')
        AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src
          JOIN settlements s ON s.id = src.settlement_id
          WHERE src.batch_id = b.id AND (
            src.state <> 'reserved' OR src.verified_signature IS NOT NULL
            OR s.reward_spent_atomic <> src.offset_atomic
            OR s.reward_amount_atomic <> src.total_atomic
            OR s.reward_swap_signature IS NOT NULL
            OR s.state NOT IN ('reconciled', 'distributed', 'buyback_burned')))
        AND CAST(b.input_amount_atomic AS INTEGER) =
          (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
            FROM reward_swap_batch_sources src WHERE src.batch_id = b.id))
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0)
`;

/** Restore a reconciliation-required job to its existing broadcast fence only
 * after the caller has proved a finalized failure. This authorizes requesting
 * one replacement quote, not broadcasting: prepare re-proves and atomically
 * archives the failed intent. Bind: job ID, broadcast fence, defer-until time,
 * observed job state/error, batch ID, canonical intent key, failed signature. */
export const REARM_PROVEN_FAILED_REWARD_BATCH_JOB_SQL = `
  UPDATE automation_jobs SET state = 'broadcasting', error_code = ?2,
    available_at = ?3, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = ?4 AND error_code = ?5 AND tx_hash IS NULL
    AND entity_type = 'reward_swap_batch' AND entity_id = ?6
    AND job_type = 'solana_reward_purchase'
    AND EXISTS (SELECT 1 FROM transaction_intents i
      WHERE i.idempotency_key = ?7 AND i.reward_batch_id = ?6
        AND i.state = 'prepared' AND i.tx_signature = ?8)
    AND EXISTS (SELECT 1 FROM reward_swap_batches b
      JOIN launch_drafts l ON l.id = b.launch_id
      WHERE b.id = ?6 AND b.state = 'broadcasting' AND b.tx_signature IS NULL
        AND l.status = 'mainnet_published' AND l.reward_chain = 'solana'
        AND l.reward_mint = b.reward_mint AND l.mainnet_reward_treasury = b.treasury
        AND EXISTS (SELECT 1 FROM reward_swap_batch_sources src
          WHERE src.batch_id = b.id AND src.state = 'reserved')
        AND CAST(b.input_amount_atomic AS INTEGER) =
          (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
            FROM reward_swap_batch_sources src
            WHERE src.batch_id = b.id AND src.state = 'reserved')
        AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src
          LEFT JOIN settlements s ON s.id = src.settlement_id
          WHERE src.batch_id = b.id AND (src.state <> 'reserved' OR s.id IS NULL
            OR src.verified_signature IS NOT NULL
            OR s.reward_spent_atomic <> src.offset_atomic
            OR s.reward_amount_atomic <> src.total_atomic
            OR s.reward_swap_signature IS NOT NULL
            OR s.state NOT IN ('reconciled', 'distributed', 'buyback_burned'))))
    AND NOT EXISTS (SELECT 1 FROM transaction_intents prior
      WHERE prior.idempotency_key LIKE ?7 || ':failed:%')
    AND NOT EXISTS (SELECT 1 FROM solana_reward_purchase_canary c
      WHERE c.reward_batch_id = ?6)
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0)
`;
