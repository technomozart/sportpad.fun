/** Conditional, append-only order intent insert. The unique idempotency key
 * and signature are mandatory database indexes, not just application checks.
 * Parameters 1-17 are immutable order fields; 18 is job ID and 19 is the
 * worker-specific broadcasting fence. */
export const INSERT_AUTOMATIC_BUYBACK_INTENT_SQL = `
  INSERT INTO transaction_intents (
    id, idempotency_key, settlement_id, signer_role, signer_address,
    action, state, expected_programs_json, expected_mints_json,
    maximum_spend_lamports, provider_request_id, unsigned_transaction_base64,
    transaction_message_hash, last_valid_block_height, input_mint,
    output_mint, input_amount_atomic, minimum_output_atomic,
    tx_signature, expires_at
  ) SELECT
    ?1, ?2, ?3, 'buyback_treasury', ?4,
    'sportpad_buyback_automation', 'prepared', ?5, ?6,
    ?7, ?8, ?9,
    ?10, ?11, ?12,
    ?13, ?14, ?15,
    ?16, ?17
  WHERE EXISTS (
    SELECT 1 FROM automation_jobs j WHERE j.id = ?18
      AND j.job_type = 'sportpad_buyback_burn' AND j.entity_id = ?3
      AND j.state = 'broadcasting' AND j.error_code = ?19
  ) AND EXISTS (
    SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.buyback_paused = 0
  ) AND EXISTS (
    SELECT 1 FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    JOIN protocol_settings p ON p.key = 'sportpad_mint'
    WHERE s.id = ?3 AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
      AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
      AND s.buyback_amount_atomic = ?14
      AND s.buyback_amount_atomic GLOB '[1-9]*'
      AND s.buyback_amount_atomic NOT GLOB '*[^0-9]*'
      AND l.status IN ('mainnet_published', 'mainnet_suspended')
      AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
      AND l.mainnet_buyback_treasury = ?4 AND p.value = ?13
  )
`;
