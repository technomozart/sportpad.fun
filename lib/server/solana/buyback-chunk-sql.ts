import { NATIVE_MINT } from "@solana/spl-token";

export const MAX_AUTOMATIC_BUYBACK_CHUNK_LAMPORTS = 100_000_000n;
const MAX_SQLITE_INTEGER = 9_223_372_036_854_775_807n;

function atomic(value: string, allowZero: boolean) {
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) {
    throw new Error("buyback_chunk_amount_invalid");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SQLITE_INTEGER) throw new Error("buyback_chunk_amount_exceeds_sqlite_integer");
  return parsed;
}

/** One order per step. A settlement above 0.1 SOL must never become one trade. */
export function planAutomaticBuybackChunk(totalAtomic: string, spentAtomic: string) {
  const total = atomic(totalAtomic, false);
  const spent = atomic(spentAtomic, true);
  if (spent > total) throw new Error("buyback_chunk_spent_exceeds_total");
  if (spent === total) return null;
  const input = total - spent > MAX_AUTOMATIC_BUYBACK_CHUNK_LAMPORTS
    ? MAX_AUTOMATIC_BUYBACK_CHUNK_LAMPORTS : total - spent;
  return {
    offsetAtomic: spent.toString(),
    inputAmountLamports: input.toString(),
    nextSpentAtomic: (spent + input).toString(),
    final: spent + input === total,
  };
}

export function automaticBuybackChunkKey(settlementId: string, offsetAtomic: string) {
  atomic(offsetAtomic, true);
  // The fee indexer uses `settlement:<base58 tx signature>:<instructionIndex>`,
  // not a random UUID. Bind the key to that exact, bounded source identity.
  const match = /^settlement:([1-9A-HJ-NP-Za-km-z]{64,96}):(0|[1-9][0-9]*)$/.exec(settlementId);
  if (!match || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error("buyback_chunk_settlement_id_invalid");
  }
  return `automation:buyback:chunk:${settlementId}:${offsetAtomic}`;
}

/** Bind: step ID, idempotency key, exact chunk input, settlement ID, prior
 * spent, total, buyback treasury, SPORTPAD mint. Run with the matching job
 * insert and one-row assertions in one D1 batch. Requires migration fields
 * settlements.buyback_spent_atomic and an active-buyback-step unique index. */
export const INSERT_AUTOMATIC_BUYBACK_CHUNK_SQL = `
  INSERT INTO settlement_steps
    (id, settlement_id, stage, idempotency_key, state,
     input_mint, output_mint, input_amount_atomic)
  SELECT ?1, s.id, 'automatic_buyback_chunk', ?2, 'planned',
    '${NATIVE_MINT.toBase58()}', p.value, ?3
  FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
  JOIN launch_drafts l ON l.id = f.launch_id
  JOIN protocol_settings p ON p.key = 'sportpad_mint'
  WHERE s.id = ?4 AND s.buyback_spent_atomic = ?5 AND s.buyback_amount_atomic = ?6
    AND s.buyback_swap_signature IS NULL AND s.burn_signature IS NULL
    AND s.state IN ('reconciled', 'distributed', 'reward_acquired')
    AND l.status = 'mainnet_published' AND l.mainnet_mint IS NOT NULL
    AND l.mainnet_mint <> p.value AND l.mainnet_buyback_treasury = ?7
    AND p.value = ?8 AND ?2 = 'automation:buyback:chunk:' || s.id || ':' || ?5
    AND s.buyback_amount_atomic GLOB '[1-9]*'
    AND s.buyback_amount_atomic NOT GLOB '*[^0-9]*'
    AND (length(s.buyback_amount_atomic) < 19 OR
      (length(s.buyback_amount_atomic) = 19 AND s.buyback_amount_atomic <= '9223372036854775807'))
    AND s.buyback_spent_atomic GLOB '[0-9]*'
    AND s.buyback_spent_atomic NOT GLOB '*[^0-9]*'
    AND (length(s.buyback_spent_atomic) < 19 OR
      (length(s.buyback_spent_atomic) = 19 AND s.buyback_spent_atomic <= '9223372036854775807'))
    AND ?3 GLOB '[1-9]*' AND ?3 NOT GLOB '*[^0-9]*'
    AND CAST(?3 AS INTEGER) BETWEEN 1 AND 100000000
    AND CAST(s.buyback_spent_atomic AS INTEGER) < CAST(s.buyback_amount_atomic AS INTEGER)
    AND CAST(?3 AS INTEGER) = MIN(100000000,
      CAST(s.buyback_amount_atomic AS INTEGER) - CAST(s.buyback_spent_atomic AS INTEGER))
    AND NOT EXISTS (SELECT 1 FROM settlement_steps prior
      WHERE prior.settlement_id = s.id AND prior.stage = 'automatic_buyback_chunk'
        AND prior.state <> 'verified')
    AND NOT EXISTS (SELECT 1 FROM automation_jobs old_job
      WHERE old_job.entity_id = s.id AND old_job.entity_type = 'settlement'
        AND old_job.job_type = 'sportpad_buyback_burn')
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.buyback_paused = 0)
`;

/** Bind: job ID, step ID, payload JSON, availableAt. */
export const INSERT_AUTOMATIC_BUYBACK_CHUNK_JOB_SQL = `
  INSERT INTO automation_jobs
    (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
  SELECT ?1, 'sportpad_buyback_burn', 'settlement_step', step.id,
    'solana', ?3, 'queued', ?4
  FROM settlement_steps step
  WHERE step.id = ?2 AND step.stage = 'automatic_buyback_chunk'
    AND step.state = 'planned'
    AND NOT EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.job_type = 'sportpad_buyback_burn' AND job.entity_id = step.id)
`;

/** Bind: step ID, finalized swap signature, bought amount, finalized slot,
 * exact chunk input, SPORTPAD mint, armed job ID, swap intent key. Call only
 * after independent on-chain swap receipt and signed-order verification. The
 * parent spent counter stays unchanged until the matching burn is final. */
export const RECORD_AUTOMATIC_BUYBACK_CHUNK_SWAP_SQL = `
  UPDATE settlement_steps SET state = 'swap_verified', tx_signature = ?2,
    output_amount_atomic = ?3, verified_slot = ?4, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND stage = 'automatic_buyback_chunk' AND state = 'planned'
    AND tx_signature IS NULL AND burn_signature IS NULL
    AND input_amount_atomic = ?5 AND output_mint = ?6
    AND ?3 GLOB '[1-9]*' AND ?3 NOT GLOB '*[^0-9]*'
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.id = ?7 AND job.entity_type = 'settlement_step'
        AND job.entity_id = settlement_steps.id AND job.job_type = 'sportpad_buyback_burn'
        AND job.state = 'broadcasting')
    AND EXISTS (SELECT 1 FROM transaction_intents intent
      WHERE intent.idempotency_key = ?8
        AND intent.settlement_id = settlement_steps.settlement_id
        AND intent.action = 'sportpad_buyback_automation'
        AND intent.state = 'confirmed' AND intent.tx_signature = ?2
        AND intent.input_amount_atomic = ?5
        AND intent.output_mint = ?6)
`;

/** Bind: step ID, finalized swap signature, finalized burn signature, bought
 * and fully burned amount, armed job ID, swap intent key, burn intent key.
 * Requires settlement_steps.burn_signature and unique index in migration.
 * Both on-chain receipts and exact signed intents must be verified first. */
export const COMPLETE_AUTOMATIC_BUYBACK_CHUNK_SQL = `
  UPDATE settlement_steps SET state = 'verified', burn_signature = ?3,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND stage = 'automatic_buyback_chunk'
    AND state = 'swap_verified' AND tx_signature = ?2
    AND burn_signature IS NULL AND output_amount_atomic = ?4 AND ?2 <> ?3
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.id = ?5 AND job.entity_type = 'settlement_step'
        AND job.entity_id = settlement_steps.id AND job.job_type = 'sportpad_buyback_burn'
        AND job.state = 'complete' AND job.tx_hash = ?3)
    AND EXISTS (SELECT 1 FROM transaction_intents swap_intent
      WHERE swap_intent.idempotency_key = ?6
        AND swap_intent.settlement_id = settlement_steps.settlement_id
        AND swap_intent.action = 'sportpad_buyback_automation'
        AND swap_intent.tx_signature = ?2 AND swap_intent.state = 'confirmed')
    AND EXISTS (SELECT 1 FROM transaction_intents burn_intent
      WHERE burn_intent.idempotency_key = ?7
        AND burn_intent.settlement_id = settlement_steps.settlement_id
        AND burn_intent.action = 'sportpad_burn_automation'
        AND burn_intent.tx_signature = ?3 AND burn_intent.state = 'confirmed'
        AND burn_intent.input_amount_atomic = ?4
        AND burn_intent.input_mint = settlement_steps.output_mint)
`;

/** Bind: settlement ID, old spent, total, next spent, swap signature, burn
 * signature, step ID, exact chunk input. Batch with job/intent/step completion
 * and one-row assertions. Final parent signatures are compatibility pointers;
 * all per-chunk receipts live in settlement_steps. */
export const ADVANCE_AUTOMATIC_BUYBACK_SETTLEMENT_SQL = `
  UPDATE settlements SET buyback_spent_atomic = ?4,
    buyback_swap_signature = CASE WHEN ?4 = ?3 THEN ?5 ELSE NULL END,
    burn_signature = CASE WHEN ?4 = ?3 THEN ?6 ELSE NULL END,
    state = CASE WHEN ?4 = ?3 THEN
      CASE WHEN reward_swap_signature IS NOT NULL THEN 'complete' ELSE 'buyback_burned' END
      ELSE state END,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND buyback_spent_atomic = ?2 AND buyback_amount_atomic = ?3
    AND buyback_swap_signature IS NULL AND burn_signature IS NULL
    AND state IN ('reconciled', 'distributed', 'reward_acquired')
    AND ?2 GLOB '[0-9]*' AND ?2 NOT GLOB '*[^0-9]*'
    AND ?3 GLOB '[1-9]*' AND ?3 NOT GLOB '*[^0-9]*'
    AND ?8 GLOB '[1-9]*' AND ?8 NOT GLOB '*[^0-9]*'
    AND CAST(?8 AS INTEGER) BETWEEN 1 AND 100000000
    AND (length(?3) < 19 OR (length(?3) = 19 AND ?3 <= '9223372036854775807'))
    AND CAST(?4 AS INTEGER) = CAST(?2 AS INTEGER) + CAST(?8 AS INTEGER)
    AND CAST(?4 AS INTEGER) <= CAST(?3 AS INTEGER)
    AND EXISTS (SELECT 1 FROM settlement_steps step WHERE step.id = ?7
      AND step.settlement_id = settlements.id
      AND step.stage = 'automatic_buyback_chunk' AND step.state = 'verified'
      AND step.input_amount_atomic = ?8 AND step.tx_signature = ?5
      AND step.burn_signature = ?6 AND step.output_amount_atomic IS NOT NULL)
    AND EXISTS (SELECT 1 FROM fee_events f JOIN launch_drafts l ON l.id = f.launch_id
      JOIN protocol_settings p ON p.key = 'sportpad_mint'
      WHERE f.id = settlements.fee_event_id AND l.status = 'mainnet_published'
        AND l.mainnet_mint IS NOT NULL AND l.mainnet_mint <> p.value
        AND p.value = (SELECT output_mint FROM settlement_steps WHERE id = ?7))
`;
