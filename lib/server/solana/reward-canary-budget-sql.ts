/** Operator-only, single-purchase mainnet canary. These statements neither
 * expose an operator endpoint nor override public launch/execution gates.
 * A caller must authenticate the operator and use a D1 batch for RESERVE,
 * ASSERT_ONE_ROW_CHANGED_SQL, INSERT_REWARD_BATCH_INTENT_SQL, and its one-row
 * assertion. The reservation and signed intent must commit or roll back
 * together, before the worker is allowed to broadcast the transaction. */

export const MIN_CANARY_INPUT_LAMPORTS = 1_000_000;
export const MAX_CANARY_INPUT_LAMPORTS = 100_000_000;

export function parseCanaryInputLamports(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("canary_lamports_invalid");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < MIN_CANARY_INPUT_LAMPORTS ||
    number > MAX_CANARY_INPUT_LAMPORTS) throw new Error("canary_lamports_out_of_range");
  return number;
}

/** Bind exact launch ID, settlement ID, and cap as an integer. Creating the
 * row leaves it paused; only an authenticated operator action may arm it. */
export const INSERT_PAUSED_REWARD_CANARY_SQL = `
  INSERT INTO solana_reward_purchase_canary
    (key, launch_id, settlement_id, max_input_lamports)
  SELECT 'initial', l.id, s.id, ?3
  FROM settlements s JOIN fee_events f ON f.id = s.fee_event_id
  JOIN launch_drafts l ON l.id = f.launch_id
  WHERE l.id = ?1 AND s.id = ?2
    AND l.reward_chain = 'solana' AND l.status = 'mainnet_published'
    AND l.mainnet_mint IS NOT NULL AND l.reward_mint IS NOT NULL
    AND l.mainnet_reward_treasury IS NOT NULL
    AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    AND s.reward_swap_signature IS NULL AND s.reward_spent_atomic = '0'
    AND typeof(?3) IN ('integer', 'real')
    AND ?3 = CAST(?3 AS INTEGER) AND ?3 BETWEEN 1000000 AND 100000000
`;

/** Bind exact launch ID and settlement ID. Operator authorization is outside
 * this SQL. Once any lamports are reserved, this canary cannot be re-armed. */
export const ARM_REWARD_CANARY_SQL = `
  UPDATE solana_reward_purchase_canary SET state = 'armed',
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'initial' AND launch_id = ?1 AND settlement_id = ?2
    AND state = 'paused' AND reward_batch_id IS NULL
    AND reserved_input_lamports = 0
`;

/** Bind no parameters. Pausing never erases the reservation or signed intent;
 * finalized receipt recovery may still attribute an already broadcast swap. */
export const PAUSE_REWARD_CANARY_SQL = `
  UPDATE solana_reward_purchase_canary SET state = 'paused',
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'initial' AND state = 'armed'
`;

/** Bind exact launch ID, settlement ID, batch ID, and canonical input amount
 * in lamports (string). Reserve exactly one initial, single-source purchase.
 * A replacement of the same signed intent must *not* call this again. This
 * UPDATE and INSERT_REWARD_BATCH_INTENT_SQL must share one D1 transaction.
 * A zero-row update is a hard fail, not permission to continue broadcasting. */
export const RESERVE_REWARD_CANARY_BUDGET_SQL = `
  UPDATE solana_reward_purchase_canary SET
    reserved_input_lamports = CAST(?4 AS INTEGER),
    reward_batch_id = ?3, updated_at = CURRENT_TIMESTAMP
  WHERE key = 'initial' AND state = 'armed'
    AND launch_id = ?1 AND settlement_id = ?2
    AND reserved_input_lamports = 0 AND reward_batch_id IS NULL
    AND ?4 GLOB '[1-9]*' AND ?4 NOT GLOB '*[^0-9]*'
    AND CAST(?4 AS INTEGER) BETWEEN 1000000 AND max_input_lamports
    AND EXISTS (
      SELECT 1 FROM reward_swap_batches b
      JOIN reward_swap_batch_sources src ON src.batch_id = b.id
      JOIN settlements s ON s.id = src.settlement_id
      JOIN fee_events f ON f.id = s.fee_event_id
      JOIN launch_drafts l ON l.id = f.launch_id
      WHERE b.id = ?3 AND b.launch_id = ?1
        AND b.state = 'broadcasting' AND b.input_amount_atomic = ?4
        AND src.settlement_id = ?2 AND src.state = 'reserved'
        AND src.offset_atomic = '0' AND src.input_amount_atomic = ?4
        AND s.reward_spent_atomic = '0'
        AND s.reward_amount_atomic = src.total_atomic
        AND s.reward_swap_signature IS NULL
        AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
        AND f.launch_id = ?1 AND l.status = 'mainnet_published'
        AND l.reward_chain = 'solana' AND l.reward_mint = b.reward_mint
        AND l.mainnet_reward_treasury = b.treasury
        AND l.mainnet_mint IS NOT NULL
        AND (SELECT COUNT(*) FROM reward_swap_batch_sources other
          WHERE other.batch_id = b.id) = 1
        AND NOT EXISTS (SELECT 1 FROM transaction_intents intent
          WHERE intent.reward_batch_id = b.id)
    )
`;

/** Bind exact launch ID, settlement ID, batch ID, and amount. This deliberately
 * ignores paused/armed state so an already authorized purchase can be
 * reconciled after an emergency pause. It never authorizes another spend. */
export const ASSERT_REWARD_CANARY_RESERVATION_SQL = `
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM solana_reward_purchase_canary c
    WHERE c.key = 'initial' AND c.launch_id = ?1 AND c.settlement_id = ?2
      AND c.reward_batch_id = ?3 AND c.reserved_input_lamports = CAST(?4 AS INTEGER)
      AND c.reserved_input_lamports BETWEEN 1000000 AND c.max_input_lamports
      AND CAST(c.reserved_input_lamports AS TEXT) = ?4
  ) THEN 1 ELSE json_extract('reward_canary_scope_mismatch', '$') END AS matched
`;
