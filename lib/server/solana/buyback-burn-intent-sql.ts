/** Persist the one exact signed burn before broadcasting it. The signed bytes
 * use the transaction_intents transaction column for this action only. The
 * unique idempotency key and signature indexes prevent a second burn plan. */
export const INSERT_AUTOMATIC_BUYBACK_BURN_INTENT_SQL = `
  INSERT INTO transaction_intents (
    id, idempotency_key, settlement_id, signer_role, signer_address,
    action, state, expected_programs_json, expected_mints_json,
    maximum_spend_lamports, provider_request_id, unsigned_transaction_base64,
    transaction_message_hash, last_valid_block_height, input_mint,
    input_amount_atomic, tx_signature, expires_at
  ) SELECT
    ?1, ?2, ?3, 'buyback_treasury', ?4,
    'sportpad_burn_automation', 'prepared', ?5, ?6,
    '500000', ?7, ?8,
    ?9, ?10, ?11,
    ?12, ?13, ?14
  WHERE EXISTS (
    SELECT 1 FROM automation_jobs j
    JOIN settlements s ON s.id = j.entity_id
    JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    JOIN protocol_settings p ON p.key = 'sportpad_mint'
    WHERE j.id = ?15 AND j.job_type = 'sportpad_buyback_burn'
      AND j.entity_type = 'settlement' AND j.chain = 'solana'
      AND j.entity_id = ?3 AND j.state = 'broadcasting'
      AND j.error_code = ?16 AND s.buyback_swap_signature IS NULL
      AND s.burn_signature IS NULL
      AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
      AND l.status IN ('mainnet_published', 'mainnet_suspended')
      AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
      AND l.mainnet_buyback_treasury = ?4 AND p.value = ?11
  ) AND EXISTS (
    SELECT 1 FROM transaction_intents i
    WHERE i.idempotency_key = 'automation:buyback:swap:' || ?3
      AND i.settlement_id = ?3 AND i.signer_address = ?4
      AND i.action = 'sportpad_buyback_automation'
      AND i.tx_signature = ?17
      AND i.state IN ('prepared', 'broadcasting', 'submitted', 'submission_unknown')
  ) AND EXISTS (
    SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.buyback_paused = 0
  )
`;

export const COMPLETE_AUTOMATIC_BUYBACK_BURN_INTENT_SQL = `
  UPDATE transaction_intents SET state = 'confirmed', updated_at = CURRENT_TIMESTAMP
  WHERE idempotency_key = ?1 AND settlement_id = ?2
    AND action = 'sportpad_burn_automation'
    AND tx_signature = ?3 AND state = 'prepared'
`;
