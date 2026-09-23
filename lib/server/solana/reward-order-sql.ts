/** Persist the exact signed Jupiter reward order before any broadcast.
 * Parameters 1-17 are immutable order fields; 18 is the armed job ID and 19
 * its worker-specific broadcast fence. A stale or changed settlement cannot
 * authorize a purchase, even when the job was queued earlier. */
export const INSERT_AUTOMATIC_REWARD_INTENT_SQL = `
  INSERT INTO transaction_intents (
    id, idempotency_key, settlement_id, signer_role, signer_address,
    action, state, expected_programs_json, expected_mints_json,
    maximum_spend_lamports, provider_request_id, unsigned_transaction_base64,
    transaction_message_hash, last_valid_block_height, input_mint,
    output_mint, input_amount_atomic, minimum_output_atomic,
    tx_signature, expires_at
  ) SELECT
    ?1, ?2, ?3, 'reward_treasury', ?4,
    'solana_reward_purchase_automation', 'prepared', ?5, ?6,
    ?7, ?8, ?9,
    ?10, ?11, ?12,
    ?13, ?14, ?15,
    ?16, ?17
  WHERE EXISTS (
    SELECT 1 FROM automation_jobs j WHERE j.id = ?18
      AND j.job_type = 'solana_reward_purchase' AND j.entity_id = ?3
      AND j.state = 'broadcasting' AND j.error_code = ?19
  ) AND EXISTS (
    SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0
  ) AND EXISTS (
    SELECT 1 FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
    JOIN launch_drafts l ON l.id = f.launch_id
    JOIN protocol_settings p ON p.key = 'sportpad_mint'
    WHERE s.id = ?3 AND s.reward_swap_signature IS NULL
      AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
      AND s.reward_amount_atomic = ?14
      AND s.reward_amount_atomic GLOB '[1-9]*'
      AND s.reward_amount_atomic NOT GLOB '*[^0-9]*'
      AND l.status = 'mainnet_published'
      AND l.reward_chain = 'solana' AND l.reward_mint = ?13
      AND l.mainnet_reward_treasury = ?4
      AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
  )
`;
