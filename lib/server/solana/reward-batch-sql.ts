import { NATIVE_MINT } from "@solana/spl-token";

/** A Jupiter order is capped independently of how many tiny fee events fund it. */
export const MAX_REWARD_BATCH_LAMPORTS = 100_000_000n;
export const MIN_REWARD_BATCH_QUEUE_LAMPORTS = 1_000_000n;
const MAX_SQLITE_INTEGER = 9_223_372_036_854_775_807n;

function atomic(value: string, allowZero: boolean) {
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) {
    throw new Error("reward_batch_amount_invalid");
  }
  const result = BigInt(value);
  if (result > MAX_SQLITE_INTEGER) throw new Error("reward_batch_amount_exceeds_sqlite_integer");
  return result;
}

/** Return the next maximal contribution. A partially used settlement can be
 * reserved again only after its prior purchase has a finalized receipt. */
export function planRewardBatchSource(totalAtomic: string, spentAtomic: string, batchAtomic: string) {
  const total = atomic(totalAtomic, false);
  const spent = atomic(spentAtomic, true);
  const batch = atomic(batchAtomic, true);
  if (spent > total || batch > MAX_REWARD_BATCH_LAMPORTS) {
    throw new Error("reward_batch_progress_invalid");
  }
  if (spent === total || batch === MAX_REWARD_BATCH_LAMPORTS) return null;
  const remaining = total - spent;
  const capacity = MAX_REWARD_BATCH_LAMPORTS - batch;
  const amount = remaining < capacity ? remaining : capacity;
  return {
    offsetAtomic: spent.toString(),
    totalAtomic: total.toString(),
    inputAmountLamports: amount.toString(),
    nextBatchAtomic: (batch + amount).toString(),
    nextSpentAtomic: (spent + amount).toString(),
    settlementComplete: spent + amount === total,
  };
}

export function rewardBatchIntentKey(batchId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
    throw new Error("reward_batch_id_invalid");
  }
  return `automation:reward:batch:${batchId}`;
}

/** Bind batch ID, launch ID, official reward mint, treasury, optional platform
 * mint. An open batch belongs to one launch; launch suspend stops collection. */
export const INSERT_REWARD_BATCH_SQL = `
  INSERT INTO reward_swap_batches (id, launch_id, reward_mint, treasury)
  SELECT ?1, l.id, l.reward_mint, ?4
  FROM launch_drafts l LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
  WHERE l.id = ?2 AND l.reward_chain = 'solana' AND l.reward_mint = ?3
    AND l.mainnet_reward_treasury = ?4 AND l.status = 'mainnet_published'
    AND l.mainnet_mint IS NOT NULL
    AND (p.value IS NULL OR l.mainnet_mint <> p.value)
    AND (?5 IS NULL OR l.mainnet_mint <> ?5)
    AND (?5 IS NULL OR p.value IS NULL OR p.value = ?5)
    AND NOT EXISTS (SELECT 1 FROM reward_swap_batches old
      WHERE old.launch_id = l.id AND old.state IN ('collecting', 'queued'))
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0)
`;

/** Bind batch ID, settlement ID, prior spent, contribution, total, old batch
 * sum, optional platform mint. The source insert, batch total CAS, optional
 * queued-job payload CAS, and one-row assertions must be one D1 batch.
 * No quote or wallet action occurs while a source is only reserved. */
export const INSERT_REWARD_BATCH_SOURCE_SQL = `
  INSERT INTO reward_swap_batch_sources
    (batch_id, settlement_id, offset_atomic, input_amount_atomic, total_atomic)
  SELECT b.id, s.id, ?3, ?4, ?5
  FROM reward_swap_batches b
  JOIN fee_events f ON f.launch_id = b.launch_id
  JOIN settlements s ON s.fee_event_id = f.id
  JOIN launch_drafts l ON l.id = b.launch_id
  LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
  WHERE b.id = ?1 AND s.id = ?2 AND b.state IN ('collecting', 'queued')
    AND b.input_amount_atomic = ?6
    AND (b.state = 'collecting' OR EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.entity_type = 'reward_swap_batch' AND job.entity_id = b.id
        AND job.job_type = 'solana_reward_purchase' AND job.state = 'queued'))
    AND NOT EXISTS (SELECT 1 FROM transaction_intents intent
      WHERE intent.reward_batch_id = b.id AND intent.action = 'solana_reward_purchase_automation')
    AND l.reward_chain = 'solana' AND l.reward_mint = b.reward_mint
    AND l.mainnet_reward_treasury = b.treasury AND l.status = 'mainnet_published'
    AND l.mainnet_mint IS NOT NULL
    AND (p.value IS NULL OR l.mainnet_mint <> p.value)
    AND (?7 IS NULL OR l.mainnet_mint <> ?7)
    AND (?7 IS NULL OR p.value IS NULL OR p.value = ?7)
    AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    AND s.reward_swap_signature IS NULL
    AND s.reward_spent_atomic = ?3 AND s.reward_amount_atomic = ?5
    AND ?3 GLOB '[0-9]*' AND ?3 NOT GLOB '*[^0-9]*'
    AND ?5 GLOB '[1-9]*' AND ?5 NOT GLOB '*[^0-9]*'
    AND (length(?5) < 19 OR (length(?5) = 19 AND ?5 <= '9223372036854775807'))
    AND ?6 GLOB '[0-9]*' AND ?6 NOT GLOB '*[^0-9]*'
    AND CAST(?6 AS INTEGER) BETWEEN 0 AND 99999999
    AND CAST(?3 AS INTEGER) < CAST(?5 AS INTEGER)
    AND CAST(?4 AS INTEGER) = MIN(100000000 - CAST(?6 AS INTEGER),
      CAST(?5 AS INTEGER) - CAST(?3 AS INTEGER))
    AND ?4 GLOB '[1-9]*' AND ?4 NOT GLOB '*[^0-9]*'
    AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources prior
      WHERE prior.settlement_id = s.id AND prior.state = 'reserved')
    AND NOT EXISTS (SELECT 1 FROM settlement_steps step
      WHERE step.settlement_id = s.id AND step.stage = 'automatic_reward_chunk'
        AND step.state <> 'verified')
    AND NOT EXISTS (SELECT 1 FROM automation_jobs legacy
      WHERE legacy.entity_type = 'settlement' AND legacy.entity_id = s.id
        AND legacy.job_type = 'solana_reward_purchase')
    AND NOT EXISTS (SELECT 1 FROM transaction_intents manual
      WHERE manual.settlement_id = s.id AND manual.action = 'reward_swap'
        AND manual.state <> 'failed')
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0)
`;

/** Bind batch ID, old sum, next sum. Requiring the source sum prevents a
 * ghost source or unaccounted SOL from entering a signed purchase. */
export const ADVANCE_REWARD_BATCH_TOTAL_SQL = `
  UPDATE reward_swap_batches SET input_amount_atomic = ?3,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND input_amount_atomic = ?2
    AND state IN ('collecting', 'queued')
    AND (state = 'collecting' OR EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.entity_type = 'reward_swap_batch' AND job.entity_id = ?1
        AND job.job_type = 'solana_reward_purchase' AND job.state = 'queued'))
    AND CAST(?3 AS INTEGER) BETWEEN 1 AND 100000000
    AND CAST(?3 AS INTEGER) > CAST(?2 AS INTEGER)
    AND CAST(?3 AS INTEGER) = (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
      FROM reward_swap_batch_sources src WHERE src.batch_id = ?1 AND src.state = 'reserved')
`;

/** Once enough SOL has accumulated, create exactly one queued job. A route
 * failure before arm returns the job to queued; later source inserts can
 * enlarge its payload so dust does not remain stranded in a sealed batch. */
export const QUEUE_REWARD_BATCH_JOB_SQL = `
  INSERT INTO automation_jobs
    (id, job_type, entity_type, entity_id, chain, payload_json, state, available_at)
  SELECT ?1, 'solana_reward_purchase', 'reward_swap_batch', b.id,
    'solana', ?3, 'queued', ?4
  FROM reward_swap_batches b
  WHERE b.id = ?2 AND b.state = 'collecting'
    AND CAST(b.input_amount_atomic AS INTEGER) BETWEEN 1000000 AND 100000000
    AND CAST(b.input_amount_atomic AS INTEGER) =
      (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
        FROM reward_swap_batch_sources src WHERE src.batch_id = b.id AND src.state = 'reserved')
    AND json_extract(?3, '$.batchId') = b.id
    AND json_extract(?3, '$.launchId') = b.launch_id
    AND json_extract(?3, '$.rewardMint') = b.reward_mint
    AND json_extract(?3, '$.rewardAmountLamports') = b.input_amount_atomic
`;

/** Bind batch ID. Pair with queue insert and assertions in one D1 batch. */
export const MARK_REWARD_BATCH_QUEUED_SQL = `
  UPDATE reward_swap_batches SET state = 'queued', updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'collecting'
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.entity_type = 'reward_swap_batch' AND job.entity_id = ?1
        AND job.job_type = 'solana_reward_purchase' AND job.state = 'queued'
        AND json_extract(job.payload_json, '$.rewardAmountLamports') = input_amount_atomic)
`;

/** Bind batch ID, previous amount, next amount. Must follow source+total CAS
 * in the same D1 transaction if a job already exists. */
export const UPDATE_QUEUED_REWARD_BATCH_PAYLOAD_SQL = `
  UPDATE automation_jobs SET payload_json = json_set(payload_json,
    '$.rewardAmountLamports', ?3), available_at = 0, updated_at = CURRENT_TIMESTAMP
  WHERE entity_type = 'reward_swap_batch' AND entity_id = ?1
    AND job_type = 'solana_reward_purchase' AND state = 'queued'
    AND json_extract(payload_json, '$.rewardAmountLamports') = ?2
    AND (SELECT input_amount_atomic FROM reward_swap_batches WHERE id = ?1) = ?3
`;

/** Bind batch ID, expected amount, job ID, worker ownership string.
 * Invoke only after obtaining an executable quote, before the signed intent
 * is prepared. The job's arm and this CAS must be one D1 transaction. */
export const ARM_REWARD_BATCH_SQL = `
  UPDATE reward_swap_batches SET state = 'broadcasting',
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'queued' AND input_amount_atomic = ?2
    AND CAST(?2 AS INTEGER) = (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
      FROM reward_swap_batch_sources src WHERE src.batch_id = ?1 AND src.state = 'reserved')
    AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src
      JOIN settlements s ON s.id = src.settlement_id
      WHERE src.batch_id = ?1 AND (s.reward_spent_atomic <> src.offset_atomic
        OR s.reward_amount_atomic <> src.total_atomic
        OR s.reward_swap_signature IS NOT NULL
        OR s.state NOT IN ('reconciled', 'distributed', 'buyback_burned')))
    AND EXISTS (SELECT 1 FROM automation_jobs job
      WHERE job.id = ?3 AND job.entity_type = 'reward_swap_batch'
        AND job.entity_id = ?1 AND job.job_type = 'solana_reward_purchase'
        AND job.state = 'broadcasting' AND job.error_code = ?4
        AND json_extract(job.payload_json, '$.rewardAmountLamports') = ?2)
`;

/** Prepared transaction is a batch intent, with settlement_id anchored to
 * the deterministic first source solely for legacy foreign-key compatibility.
 * Bind 1-17 as normal swap intent fields, 18 job ID, 19 owner fence, 20 batch
 * ID, 21 optional configured platform mint. */
export const INSERT_REWARD_BATCH_INTENT_SQL = `
  INSERT INTO transaction_intents (
    id, idempotency_key, settlement_id, reward_batch_id,
    signer_role, signer_address, action, state,
    expected_programs_json, expected_mints_json,
    maximum_spend_lamports, provider_request_id, unsigned_transaction_base64,
    transaction_message_hash, last_valid_block_height, input_mint,
    output_mint, input_amount_atomic, minimum_output_atomic,
    tx_signature, expires_at
  ) SELECT
    ?1, ?2, (SELECT src.settlement_id FROM reward_swap_batch_sources src
      WHERE src.batch_id = b.id ORDER BY src.created_at, src.settlement_id LIMIT 1), b.id,
    'reward_treasury', ?4, 'solana_reward_purchase_automation', 'prepared',
    ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
    ?13, ?14, ?15, ?16, ?17
  FROM reward_swap_batches b JOIN launch_drafts l ON l.id = b.launch_id
  LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
  WHERE b.id = ?20 AND b.state = 'broadcasting'
    AND ?2 = 'automation:reward:batch:' || b.id
    AND b.input_amount_atomic = ?14 AND b.reward_mint = ?13 AND b.treasury = ?4
    AND ?12 = '${NATIVE_MINT.toBase58()}' AND ?7 = ?14
    AND CAST(?14 AS INTEGER) BETWEEN 1000000 AND 100000000
    AND CAST(?14 AS INTEGER) = (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
      FROM reward_swap_batch_sources src WHERE src.batch_id = b.id AND src.state = 'reserved')
    AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src
      JOIN settlements s ON s.id = src.settlement_id
      WHERE src.batch_id = b.id AND (s.reward_spent_atomic <> src.offset_atomic
        OR s.reward_amount_atomic <> src.total_atomic
        OR s.reward_swap_signature IS NOT NULL
        OR s.state NOT IN ('reconciled', 'distributed', 'buyback_burned')
        OR EXISTS (SELECT 1 FROM transaction_intents manual
          WHERE manual.settlement_id = s.id AND manual.action = 'reward_swap'
            AND manual.state <> 'failed')))
    AND l.status = 'mainnet_published' AND l.reward_chain = 'solana'
    AND l.reward_mint = b.reward_mint AND l.mainnet_reward_treasury = b.treasury
    AND l.mainnet_mint IS NOT NULL AND (p.value IS NULL OR l.mainnet_mint <> p.value)
    AND (?21 IS NULL OR l.mainnet_mint <> ?21)
    AND (?21 IS NULL OR p.value IS NULL OR p.value = ?21)
    AND EXISTS (SELECT 1 FROM automation_jobs job WHERE job.id = ?18
      AND job.entity_type = 'reward_swap_batch' AND job.entity_id = b.id
      AND job.job_type = 'solana_reward_purchase' AND job.state = 'broadcasting'
      AND job.error_code = ?19
      AND json_extract(job.payload_json, '$.rewardAmountLamports') = ?14)
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.settlement_paused = 0 AND c.rewards_paused = 0)
`;

/** Bind batch ID, signature, output, finalized slot, exact input, mint, job
 * ID and intent key. Place after job completion in the same D1 transaction. */
export const COMPLETE_REWARD_BATCH_SQL = `
  UPDATE reward_swap_batches SET state = 'verified', tx_signature = ?2,
    output_amount_atomic = ?3, verified_slot = ?4, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'broadcasting' AND tx_signature IS NULL
    AND input_amount_atomic = ?5 AND reward_mint = ?6
    AND CAST(?5 AS INTEGER) = (SELECT SUM(CAST(src.input_amount_atomic AS INTEGER))
      FROM reward_swap_batch_sources src WHERE src.batch_id = ?1 AND src.state = 'reserved')
    AND EXISTS (SELECT 1 FROM automation_jobs job WHERE job.id = ?7
      AND job.entity_type = 'reward_swap_batch' AND job.entity_id = ?1
      AND job.job_type = 'solana_reward_purchase' AND job.state = 'complete'
      AND job.tx_hash = ?2)
    AND EXISTS (SELECT 1 FROM transaction_intents intent
      WHERE intent.idempotency_key = ?8 AND intent.reward_batch_id = ?1
        AND intent.action = 'solana_reward_purchase_automation'
        AND intent.tx_signature = ?2 AND intent.input_amount_atomic = ?5
        AND intent.output_mint = ?6)
`;

/** Bind batch ID and verified signature. The source and parent settlement
 * writes follow in the same D1 batch, with an all-sources assertion. */
export const VERIFY_REWARD_BATCH_SOURCES_SQL = `
  UPDATE reward_swap_batch_sources SET state = 'verified',
    verified_signature = ?2, updated_at = CURRENT_TIMESTAMP
  WHERE batch_id = ?1 AND state = 'reserved' AND verified_signature IS NULL
    AND EXISTS (SELECT 1 FROM reward_swap_batches b WHERE b.id = ?1
      AND b.state = 'verified' AND b.tx_signature = ?2)
    AND EXISTS (SELECT 1 FROM settlements s WHERE s.id = reward_swap_batch_sources.settlement_id
      AND s.reward_spent_atomic = reward_swap_batch_sources.offset_atomic
      AND s.reward_amount_atomic = reward_swap_batch_sources.total_atomic
      AND s.reward_swap_signature IS NULL
      AND s.state IN ('reconciled', 'distributed', 'buyback_burned'))
`;

/** Fail the enclosing D1 batch if even one reserved source could not verify.
 * SQLite's malformed-json branch intentionally raises an exception. */
export const ASSERT_REWARD_BATCH_SOURCES_VERIFIED_SQL = `
  SELECT CASE WHEN EXISTS (SELECT 1 FROM reward_swap_batch_sources WHERE batch_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src
      WHERE src.batch_id = ?1 AND (src.state <> 'verified' OR src.verified_signature <> ?2))
    THEN 1 ELSE json_extract('reward_batch_cas_conflict', '$') END
`;

/** Bind batch ID and signature. One set-based mutation attributes the exact
 * SOL input to every source; a final source shares the one actual swap hash. */
export const ADVANCE_REWARD_BATCH_SETTLEMENTS_SQL = `
  UPDATE settlements SET
    reward_spent_atomic = (SELECT CAST(CAST(src.offset_atomic AS INTEGER) +
      CAST(src.input_amount_atomic AS INTEGER) AS TEXT)
      FROM reward_swap_batch_sources src WHERE src.batch_id = ?1 AND src.settlement_id = settlements.id),
    reward_swap_signature = CASE WHEN reward_amount_atomic =
      (SELECT CAST(CAST(src.offset_atomic AS INTEGER) + CAST(src.input_amount_atomic AS INTEGER) AS TEXT)
        FROM reward_swap_batch_sources src WHERE src.batch_id = ?1 AND src.settlement_id = settlements.id)
      THEN ?2 ELSE NULL END,
    state = CASE WHEN reward_amount_atomic =
      (SELECT CAST(CAST(src.offset_atomic AS INTEGER) + CAST(src.input_amount_atomic AS INTEGER) AS TEXT)
        FROM reward_swap_batch_sources src WHERE src.batch_id = ?1 AND src.settlement_id = settlements.id)
      THEN CASE WHEN buyback_swap_signature IS NOT NULL AND burn_signature IS NOT NULL
        THEN 'complete' ELSE 'reward_acquired' END ELSE state END,
    updated_at = CURRENT_TIMESTAMP
  WHERE reward_swap_signature IS NULL
    AND EXISTS (SELECT 1 FROM reward_swap_batch_sources src
      JOIN reward_swap_batches b ON b.id = src.batch_id
      JOIN fee_events f ON f.id = settlements.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE src.batch_id = ?1 AND src.settlement_id = settlements.id
        AND src.state = 'verified' AND src.verified_signature = ?2
        AND b.state = 'verified' AND b.tx_signature = ?2
        AND b.launch_id = l.id AND b.reward_mint = l.reward_mint
        -- Suspension after a finalized swap must not strand purchased tokens.
        AND l.reward_chain = 'solana'
        AND settlements.reward_spent_atomic = src.offset_atomic
        AND settlements.reward_amount_atomic = src.total_atomic
        AND CAST(src.offset_atomic AS INTEGER) + CAST(src.input_amount_atomic AS INTEGER)
          <= CAST(src.total_atomic AS INTEGER))
`;

/** Bind batch ID, signature. All source offsets must now be reflected in
 * settlements before vault/epoch inventory can be credited. */
export const ASSERT_REWARD_BATCH_SETTLEMENTS_ADVANCED_SQL = `
  SELECT CASE WHEN EXISTS (SELECT 1 FROM reward_swap_batch_sources WHERE batch_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src
      JOIN settlements s ON s.id = src.settlement_id
      WHERE src.batch_id = ?1 AND (s.reward_spent_atomic <>
          CAST(CAST(src.offset_atomic AS INTEGER) + CAST(src.input_amount_atomic AS INTEGER) AS TEXT)
        OR (s.reward_spent_atomic = s.reward_amount_atomic AND s.reward_swap_signature <> ?2)
        OR (s.reward_spent_atomic <> s.reward_amount_atomic AND s.reward_swap_signature IS NOT NULL)))
    THEN 1 ELSE json_extract('reward_batch_cas_conflict', '$') END
`;
