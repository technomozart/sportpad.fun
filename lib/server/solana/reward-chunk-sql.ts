import { NATIVE_MINT } from "@solana/spl-token";

export const MAX_AUTOMATIC_REWARD_CHUNK_LAMPORTS = 100_000_000n;
// Keep every aggregate inside SQLite's exact signed-integer range so SQL can
// independently verify offset + chunk = next offset.
const MAX_SETTLEMENT_LAMPORTS = 9_223_372_036_854_775_807n;

function canonicalAtomic(value: string, allowZero: boolean) {
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) {
    throw new Error("reward_chunk_amount_invalid");
  }
  const amount = BigInt(value);
  if (amount > MAX_SETTLEMENT_LAMPORTS) throw new Error("reward_chunk_amount_exceeds_sqlite_integer");
  return amount;
}

/** Plan one order only. Never expose an uncapped settlement amount to Jupiter. */
export function planAutomaticRewardChunk(totalAtomic: string, spentAtomic: string) {
  const total = canonicalAtomic(totalAtomic, false);
  const spent = canonicalAtomic(spentAtomic, true);
  if (spent > total) throw new Error("reward_chunk_spent_exceeds_total");
  if (spent === total) return null;
  const amount = total - spent > MAX_AUTOMATIC_REWARD_CHUNK_LAMPORTS
    ? MAX_AUTOMATIC_REWARD_CHUNK_LAMPORTS : total - spent;
  return {
    offsetAtomic: spent.toString(),
    inputAmountLamports: amount.toString(),
    nextSpentAtomic: (spent + amount).toString(),
    final: spent + amount === total,
  };
}

export function automaticRewardChunkKey(settlementId: string, offsetAtomic: string) {
  canonicalAtomic(offsetAtomic, true);
  // Mainnet fee indexer IDs are `settlement:<Solana tx signature>:<instruction>`.
  // They are deliberately deterministic, not UUIDs.
  const match = /^settlement:([1-9A-HJ-NP-Za-km-z]{64,96}):(0|[1-9][0-9]*)$/.exec(settlementId);
  if (!match || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error("reward_chunk_settlement_id_invalid");
  }
  return `automation:reward:chunk:${settlementId}:${offsetAtomic}`;
}

/** Bind: step ID, idempotency key, planned amount, settlement ID, prior
 * spent, total, reward treasury, optional configured SPORTPAD mint. Insert
 * this and the matching job in one D1 batch with a one-row assertion. */
export const INSERT_AUTOMATIC_REWARD_CHUNK_SQL = `
  INSERT INTO settlement_steps
    (id, settlement_id, stage, idempotency_key, state,
     input_mint, output_mint, input_amount_atomic)
  SELECT ?1, s.id, 'automatic_reward_chunk', ?2, 'planned',
    '${NATIVE_MINT.toBase58()}', l.reward_mint, ?3
  FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
  JOIN launch_drafts l ON l.id = f.launch_id
  LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
  WHERE s.id = ?4 AND s.reward_swap_signature IS NULL
    AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    AND s.reward_spent_atomic = ?5 AND s.reward_amount_atomic = ?6
    AND s.reward_spent_atomic <> s.reward_amount_atomic
    AND l.reward_chain = 'solana' AND l.reward_mint IS NOT NULL
    AND l.mainnet_mint IS NOT NULL AND l.status = 'mainnet_published'
    AND l.mainnet_reward_treasury = ?7
    AND (p.value IS NULL OR l.mainnet_mint <> p.value)
    AND (?8 IS NULL OR l.mainnet_mint <> ?8)
    AND (?8 IS NULL OR p.value IS NULL OR p.value = ?8)
    AND ?2 = 'automation:reward:chunk:' || s.id || ':' || s.reward_spent_atomic
    AND s.reward_amount_atomic GLOB '[1-9]*'
    AND s.reward_amount_atomic NOT GLOB '*[^0-9]*'
    AND (length(s.reward_amount_atomic) < 19 OR
      (length(s.reward_amount_atomic) = 19 AND s.reward_amount_atomic <= '9223372036854775807'))
    AND s.reward_spent_atomic GLOB '[0-9]*'
    AND s.reward_spent_atomic NOT GLOB '*[^0-9]*'
    AND (length(s.reward_spent_atomic) < 19 OR
      (length(s.reward_spent_atomic) = 19 AND s.reward_spent_atomic <= '9223372036854775807'))
    AND ?3 GLOB '[1-9]*' AND ?3 NOT GLOB '*[^0-9]*'
    AND CAST(?3 AS INTEGER) BETWEEN 1 AND 100000000
    AND CAST(s.reward_spent_atomic AS INTEGER) < CAST(s.reward_amount_atomic AS INTEGER)
    AND CAST(?3 AS INTEGER) = MIN(100000000,
      CAST(s.reward_amount_atomic AS INTEGER) - CAST(s.reward_spent_atomic AS INTEGER))
    AND NOT EXISTS (SELECT 1 FROM settlement_steps prior
      WHERE prior.settlement_id = s.id AND prior.stage = 'automatic_reward_chunk'
        AND prior.state <> 'verified')
    AND NOT EXISTS (SELECT 1 FROM transaction_intents manual
      WHERE manual.settlement_id = s.id AND manual.action = 'reward_swap'
        AND manual.state <> 'failed')
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0)
`;

/** Bind: job ID, step ID, payload JSON, availableAt. */
export const INSERT_AUTOMATIC_REWARD_CHUNK_JOB_SQL = `
  INSERT INTO automation_jobs
    (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
  SELECT ?1, 'solana_reward_purchase', 'settlement_step', step.id,
    'solana', ?3, 'queued', ?4
  FROM settlement_steps step
  WHERE step.id = ?2 AND step.stage = 'automatic_reward_chunk'
    AND step.state = 'planned'
    AND NOT EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.job_type = 'solana_reward_purchase' AND job.entity_id = step.id)
`;

/** Same immutable 1-17 order fields as the single-order intent. Bind 18=job
 * ID, 19=broadcast fence, 20=step ID, 21=optional configured SPORTPAD mint.
 * The intent retains the parent settlement FK but is idempotent per step. */
export const INSERT_AUTOMATIC_REWARD_CHUNK_INTENT_SQL = `
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
  FROM settlement_steps step
  JOIN settlements s ON s.id = step.settlement_id
  JOIN fee_events f ON f.id = s.fee_event_id
  JOIN launch_drafts l ON l.id = f.launch_id
  LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
  WHERE step.id = ?20 AND step.stage = 'automatic_reward_chunk'
    AND step.state = 'planned' AND step.settlement_id = ?3
    AND step.idempotency_key = 'automation:reward:chunk:' || s.id || ':' || s.reward_spent_atomic
    AND ?2 = 'automation:reward:swap:' || step.id
    AND step.input_mint = ?12 AND step.output_mint = ?13
    AND step.input_amount_atomic = ?14
    AND s.reward_swap_signature IS NULL AND s.reward_spent_atomic <> s.reward_amount_atomic
    AND NOT EXISTS (SELECT 1 FROM transaction_intents manual
      WHERE manual.settlement_id = s.id AND manual.action = 'reward_swap'
        AND manual.state <> 'failed')
    AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    AND s.reward_amount_atomic GLOB '[1-9]*'
    AND s.reward_amount_atomic NOT GLOB '*[^0-9]*'
    AND (length(s.reward_amount_atomic) < 19 OR
      (length(s.reward_amount_atomic) = 19 AND s.reward_amount_atomic <= '9223372036854775807'))
    AND s.reward_spent_atomic GLOB '[0-9]*'
    AND s.reward_spent_atomic NOT GLOB '*[^0-9]*'
    AND (length(s.reward_spent_atomic) < 19 OR
      (length(s.reward_spent_atomic) = 19 AND s.reward_spent_atomic <= '9223372036854775807'))
    AND l.status = 'mainnet_published' AND l.reward_chain = 'solana'
    AND l.reward_mint = ?13 AND l.mainnet_reward_treasury = ?4
    AND l.mainnet_mint IS NOT NULL
    AND (p.value IS NULL OR l.mainnet_mint <> p.value)
    AND (?21 IS NULL OR l.mainnet_mint <> ?21)
    AND (?21 IS NULL OR p.value IS NULL OR p.value = ?21)
    AND ?12 = '${NATIVE_MINT.toBase58()}'
    AND ?14 GLOB '[1-9]*' AND ?14 NOT GLOB '*[^0-9]*'
    AND CAST(?14 AS INTEGER) BETWEEN 1 AND 100000000
    AND CAST(?14 AS INTEGER) = MIN(100000000,
      CAST(s.reward_amount_atomic AS INTEGER) - CAST(s.reward_spent_atomic AS INTEGER))
    AND ?7 = ?14
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.id = ?18 AND job.entity_type = 'settlement_step'
        AND job.entity_id = step.id AND job.job_type = 'solana_reward_purchase'
        AND job.state = 'broadcasting' AND job.error_code = ?19)
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0)
`;

/** Bind: step ID, signature, verified output, verified slot, exact input,
 * output mint, armed job ID, persisted intent key. Receipt and intent proofs
 * must be checked before this conditional write. */
export const COMPLETE_AUTOMATIC_REWARD_CHUNK_SQL = `
  UPDATE settlement_steps SET state = 'verified', tx_signature = ?2,
    output_amount_atomic = ?3, verified_slot = ?4, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND stage = 'automatic_reward_chunk'
    AND state IN ('planned', 'prepared', 'broadcasting', 'reconciliation_required')
    AND tx_signature IS NULL AND input_amount_atomic = ?5 AND output_mint = ?6
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.id = ?7 AND job.entity_type = 'settlement_step'
        AND job.entity_id = settlement_steps.id AND job.job_type = 'solana_reward_purchase'
        AND job.state = 'complete' AND job.tx_hash = ?2)
    AND EXISTS (SELECT 1 FROM transaction_intents intent
      WHERE intent.idempotency_key = ?8
        AND intent.settlement_id = settlement_steps.settlement_id
        AND intent.action = 'solana_reward_purchase_automation'
        AND intent.input_amount_atomic = ?5 AND intent.output_mint = ?6
        AND intent.tx_signature = ?2)
`;

/** Bind: settlement ID, old spent, total, next spent, verified signature,
 * step ID, exact chunk input, optional configured SPORTPAD mint, treasury.
 * Must share the D1 batch with job/step/vault/
 * epoch completion and one-row assertions. The final signature is only a
 * completion pointer: every chunk receipt remains in settlement_steps. */
export const ADVANCE_AUTOMATIC_REWARD_SETTLEMENT_SQL = `
  UPDATE settlements SET reward_spent_atomic = ?4,
    reward_swap_signature = CASE WHEN ?4 = ?3 THEN ?5 ELSE NULL END,
    state = CASE WHEN ?4 = ?3 THEN
      CASE WHEN buyback_swap_signature IS NOT NULL AND burn_signature IS NOT NULL
        THEN 'complete' ELSE 'reward_acquired' END
      ELSE state END,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND reward_spent_atomic = ?2 AND reward_amount_atomic = ?3
    AND reward_swap_signature IS NULL
    AND state IN ('reconciled', 'distributed', 'buyback_burned')
    AND CAST(?4 AS INTEGER) = CAST(?2 AS INTEGER) + CAST(?7 AS INTEGER)
    AND CAST(?4 AS INTEGER) <= CAST(?3 AS INTEGER)
    AND EXISTS (SELECT 1 FROM settlement_steps step WHERE step.id = ?6
      AND step.settlement_id = settlements.id
      AND step.stage = 'automatic_reward_chunk' AND step.state = 'verified'
      AND step.input_amount_atomic = ?7 AND step.tx_signature = ?5)
    AND EXISTS (SELECT 1 FROM fee_events f JOIN launch_drafts l ON l.id = f.launch_id
      LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
      WHERE f.id = settlements.fee_event_id AND l.reward_chain = 'solana'
        -- A suspension stops new orders, but cannot erase a finalized purchase.
        AND l.status IN ('mainnet_published', 'mainnet_suspended')
        AND l.mainnet_mint IS NOT NULL
        AND (p.value IS NULL OR l.mainnet_mint <> p.value)
        AND (?8 IS NULL OR l.mainnet_mint <> ?8)
        AND (?8 IS NULL OR p.value IS NULL OR p.value = ?8)
        AND l.mainnet_reward_treasury = ?9
        AND l.reward_mint = (SELECT output_mint FROM settlement_steps WHERE id = ?6))
`;
