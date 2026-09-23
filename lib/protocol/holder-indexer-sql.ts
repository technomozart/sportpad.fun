// A finalized holder observation is staged across as many D1 batches as it
// needs. Only the final, transactional set-based copy changes the positions
// read by epoch allocation. A failed or interrupted stage is never visible.
export const STAGE_HOLDER_POSITION_SQL = `
  INSERT INTO holder_snapshot_staging (
    generation_id, epoch_id, launch_id, wallet, token_seconds_atomic,
    ending_balance_atomic, observed_slot, observed_at
  )
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
  FROM reward_epochs e WHERE e.id = ?2 AND e.state = 'accruing'
`;

export const ASSERT_STAGED_SNAPSHOT_SQL = `
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM holder_snapshot_staging
    WHERE generation_id = ?1 AND epoch_id = ?2
  ) = ?3 THEN 1 ELSE json_extract('holder_snapshot_incomplete', '$') END AS complete
`;

// A concurrent or older observation cannot replace a newer finalized slot.
// The observation time must also advance, avoiding a second accrual for the
// same wall-clock instant. D1 batch rolls back the whole commit if the
// following changes() assertion fails.
export const COMMIT_HOLDER_CHECKPOINT_SQL = `
  INSERT INTO holder_snapshot_checkpoints (
    epoch_id, generation_id, last_observed_slot, last_observed_at,
    position_count, evidence_hash, updated_at
  )
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP
  FROM reward_epochs e WHERE e.id = ?1 AND e.state = 'accruing'
  ON CONFLICT(epoch_id) DO UPDATE SET
    generation_id = excluded.generation_id,
    last_observed_slot = excluded.last_observed_slot,
    last_observed_at = excluded.last_observed_at,
    position_count = excluded.position_count,
    evidence_hash = excluded.evidence_hash,
    updated_at = CURRENT_TIMESTAMP
  WHERE holder_snapshot_checkpoints.last_observed_slot <= excluded.last_observed_slot
    AND holder_snapshot_checkpoints.last_observed_at < excluded.last_observed_at
    AND ?7 IS NOT NULL
    AND holder_snapshot_checkpoints.generation_id = ?7
    AND EXISTS (
      SELECT 1 FROM reward_epochs e
      WHERE e.id = excluded.epoch_id AND e.state = 'accruing'
    )
`;

export const ASSERT_ONE_CHECKPOINT_SQL = `
  SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('holder_snapshot_conflict', '$') END AS committed
`;

// A single SQLite statement, not one write per holder. Epoch closure sees
// either the prior complete generation or this entire generation.
export const COMMIT_STAGED_HOLDER_POSITIONS_SQL = `
  INSERT INTO holder_epoch_positions (
    id, epoch_id, launch_id, wallet, token_seconds_atomic, ending_balance_atomic,
    last_observed_slot, last_observed_at, excluded, updated_at
  )
  SELECT 'position:' || s.epoch_id || ':' || s.wallet,
    s.epoch_id, s.launch_id, s.wallet, s.token_seconds_atomic,
    s.ending_balance_atomic, s.observed_slot, s.observed_at, 0, CURRENT_TIMESTAMP
  FROM holder_snapshot_staging s
  JOIN holder_snapshot_checkpoints c
    ON c.epoch_id = s.epoch_id AND c.generation_id = s.generation_id
  JOIN reward_epochs e ON e.id = s.epoch_id AND e.state = 'accruing'
  WHERE s.generation_id = ?1 AND s.epoch_id = ?2
  ON CONFLICT(epoch_id, wallet) DO UPDATE SET
    token_seconds_atomic = excluded.token_seconds_atomic,
    ending_balance_atomic = excluded.ending_balance_atomic,
    last_observed_slot = excluded.last_observed_slot,
    last_observed_at = excluded.last_observed_at,
    updated_at = CURRENT_TIMESTAMP
`;

export const ASSERT_POSITION_COUNT_SQL = `
  SELECT CASE WHEN changes() = ?1 THEN 1 ELSE json_extract('holder_snapshot_commit_incomplete', '$') END AS complete
`;

export const RECORD_HOLDER_SNAPSHOT_SQL = `
  INSERT INTO protocol_events (
    id, category, entity_type, entity_id, event_type, idempotency_key, state,
    slot, amount_atomic, mint, evidence_hash
  )
  SELECT ?1, 'rewards', 'epoch', ?2, 'holder_snapshot_indexed', ?1, 'verified', ?3, ?4, ?5, ?6
  FROM holder_snapshot_checkpoints c
  JOIN reward_epochs e ON e.id = c.epoch_id AND e.state = 'accruing'
  WHERE c.epoch_id = ?2 AND c.generation_id = ?7
`;
