// A finalized holder observation is staged across as many D1 batches as it
// needs. Only the final, transactional set-based copy changes the positions
// read by epoch allocation. A failed or interrupted stage is never visible.
export const STAGE_HOLDER_POSITION_SQL = `
  INSERT INTO holder_snapshot_staging (
    generation_id, epoch_id, launch_id, wallet, token_seconds_atomic,
    ending_balance_atomic, observed_slot, observed_at
  )
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
  FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
  WHERE e.id = ?2 AND e.state = 'accruing' AND l.status = 'mainnet_published'
`;

export const ASSERT_STAGED_SNAPSHOT_SQL = `
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM holder_snapshot_staging
    WHERE generation_id = ?1 AND epoch_id = ?2
  ) = ?3 THEN 1 ELSE json_extract('holder_snapshot_incomplete', '$') END AS complete
`;

// A missed first observation cannot make an epoch retroactively eligible.
// The first finalized snapshot sets the opening balance, while this CAS moves
// the whole window forward without shortening it. It runs in the same D1
// transaction as the checkpoint and canonical position replacement.
export const SHIFT_EPOCH_TO_FINALIZED_BASELINE_SQL = `
  UPDATE reward_epochs SET starts_at = ?2, ends_at = ?3, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND state = 'accruing'
    AND starts_at = ?4 AND ends_at = ?5
    AND CAST(strftime('%s', starts_at) AS INTEGER) < ?6
    AND NOT EXISTS (
      SELECT 1 FROM holder_snapshot_checkpoints c WHERE c.epoch_id = reward_epochs.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM holder_epoch_positions p WHERE p.epoch_id = reward_epochs.id
    )
    AND EXISTS (
      SELECT 1 FROM launch_drafts l WHERE l.id = reward_epochs.launch_id
        AND l.status = 'mainnet_published'
    )
`;

export const ASSERT_ONE_EPOCH_SHIFT_SQL = `
  SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('holder_epoch_baseline_conflict', '$') END AS shifted
`;

export const RECORD_HOLDER_BASELINE_SHIFT_SQL = `
  INSERT INTO protocol_events (
    id, category, entity_type, entity_id, event_type, idempotency_key,
    state, slot, amount_atomic, mint, evidence_hash
  ) VALUES (?1, 'rewards', 'epoch', ?2, 'holder_epoch_baseline_shifted',
    ?1, 'verified', ?3, ?4, ?5, ?6)
`;

// A concurrent or older observation cannot replace a newer finalized slot.
// The observation time must also advance, avoiding a second accrual for the
// same wall-clock instant. D1 batch rolls back the whole commit if the
// following changes() assertion fails.
export const COMMIT_HOLDER_CHECKPOINT_SQL = `
  INSERT INTO holder_snapshot_checkpoints (
    epoch_id, generation_id, first_finalized_at, last_observed_slot, last_observed_at,
    position_count, evidence_hash, updated_at
  )
  SELECT ?1, ?2, ?4, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP
  FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
  WHERE e.id = ?1 AND e.state = 'accruing' AND l.status = 'mainnet_published'
    AND e.starts_at = ?8 AND e.ends_at = ?9
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
      SELECT 1 FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
      WHERE e.id = excluded.epoch_id AND e.state = 'accruing'
        AND l.status = 'mainnet_published'
        AND e.starts_at = ?8 AND e.ends_at = ?9
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
  JOIN launch_drafts l ON l.id = e.launch_id AND l.status = 'mainnet_published'
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
  JOIN launch_drafts l ON l.id = e.launch_id AND l.status = 'mainnet_published'
  WHERE c.epoch_id = ?2 AND c.generation_id = ?7
`;

// A checkpoint from the old wall-clock indexer has no first_finalized_at and
// cannot authorize allocation. Every canonical position must belong to the
// same finalized closing snapshot, with accrual reaching the epoch end.
export const COMPLETE_FINALIZED_HOLDER_SNAPSHOT_SQL = `
  EXISTS (
    SELECT 1 FROM holder_snapshot_checkpoints c
    WHERE c.epoch_id = e.id
      AND c.first_finalized_at IS NOT NULL
      AND c.first_finalized_at <= CAST(strftime('%s', e.starts_at) AS INTEGER)
      AND c.last_observed_at >= CAST(strftime('%s', e.ends_at) AS INTEGER)
      AND c.last_observed_slot > 0
      AND c.position_count = (
        SELECT COUNT(*) FROM holder_epoch_positions p WHERE p.epoch_id = e.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM holder_epoch_positions p WHERE p.epoch_id = e.id
          AND (p.last_observed_slot IS NULL OR p.last_observed_slot <> c.last_observed_slot
            OR p.last_observed_at IS NULL
            OR p.last_observed_at < CAST(strftime('%s', e.ends_at) AS INTEGER))
      )
  )
`;
