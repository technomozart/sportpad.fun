-- A retry has its own job ID and job type. Keep the original global
-- (entity_id, job_type) uniqueness: the public claim queue uses that exact
-- conflict target, and all existing jobs retain their current identity.
ALTER TABLE `automation_jobs` ADD `retry_of_job_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_jobs_retry_of_job` ON `automation_jobs` (`retry_of_job_id`) WHERE `retry_of_job_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `chiliz_claim_retry_policy` (
  `job_id` text PRIMARY KEY NOT NULL,
  `predecessor_job_id` text NOT NULL,
  `predecessor_intent_id` text NOT NULL,
  `predecessor_tx_hash` text NOT NULL,
  `predecessor_receipt_block_hash` text NOT NULL,
  `predecessor_receipt_block_number` integer NOT NULL,
  `predecessor_finalized_block_number` integer NOT NULL,
  `predecessor_evidence_json` text NOT NULL,
  `predecessor_spent_wei` text NOT NULL,
  `max_retry_spend_wei` text NOT NULL,
  `state` text DEFAULT 'paused' NOT NULL,
  `reserved_intent_id` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `automation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`predecessor_job_id`) REFERENCES `automation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`predecessor_intent_id`) REFERENCES `chiliz_signed_intents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reserved_intent_id`) REFERENCES `chiliz_signed_intents`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_chiliz_claim_retry_state` CHECK(`state` IN ('paused', 'armed', 'reserved')),
  CONSTRAINT `chk_chiliz_claim_retry_reservation` CHECK(`state` <> 'reserved' OR `reserved_intent_id` IS NOT NULL),
  CONSTRAINT `chk_chiliz_claim_retry_cap` CHECK(
    `predecessor_spent_wei` GLOB '[0-9]*' AND
    `predecessor_spent_wei` NOT GLOB '*[^0-9]*' AND
    (`predecessor_spent_wei` = '0' OR substr(`predecessor_spent_wei`, 1, 1) <> '0') AND
    `max_retry_spend_wei` GLOB '[1-9]*' AND
    `max_retry_spend_wei` NOT GLOB '*[^0-9]*' AND
    length(`predecessor_spent_wei`) <= 19 AND
    length(`max_retry_spend_wei`) <= 19 AND
    CAST(`predecessor_spent_wei` AS INTEGER) + CAST(`max_retry_spend_wei` AS INTEGER) <= 1000000000000000000
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_claim_retry_predecessor_job` ON `chiliz_claim_retry_policy` (`predecessor_job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_claim_retry_predecessor_intent` ON `chiliz_claim_retry_policy` (`predecessor_intent_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_claim_retry_reserved_intent` ON `chiliz_claim_retry_policy` (`reserved_intent_id`) WHERE `reserved_intent_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_marker_only` BEFORE INSERT ON `automation_jobs`
WHEN NEW.job_type <> 'chiliz_claim_retry' AND NEW.retry_of_job_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_marker_only'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_job_insert` BEFORE INSERT ON `automation_jobs`
WHEN NEW.job_type = 'chiliz_claim_retry' AND NOT EXISTS (
  SELECT 1 FROM automation_jobs predecessor
  JOIN chiliz_signed_intents intent ON intent.job_id = predecessor.id
  JOIN chiliz_intent_policy original_policy
    ON original_policy.key = 'claim_canary'
   AND original_policy.authorized_job_id = predecessor.id
   AND original_policy.reserved_intent_id = intent.id
  JOIN reward_claims claim ON claim.id = predecessor.entity_id
  WHERE predecessor.id = NEW.retry_of_job_id
    AND predecessor.retry_of_job_id IS NULL
    AND predecessor.job_type = 'chiliz_claim_unwrap'
    AND predecessor.entity_type = 'reward_claim'
    AND predecessor.chain = 'chiliz'
    AND predecessor.state = 'failed'
    AND predecessor.error_code = 'chiliz_finalized_reverted'
    AND predecessor.tx_hash = intent.tx_hash
    AND json_type(predecessor.payload_json, '$.reconciliationReceipt') = 'object'
    AND intent.kind = 'claim' AND intent.state = 'finalized_reverted'
    AND intent.receipt_status = 'reverted'
    AND intent.receipt_block_hash = intent.canonical_receipt_block_hash
    AND intent.receipt_block_number >= 0
    AND intent.finalized_block_number >= intent.receipt_block_number
    AND intent.evidence_json IS NOT NULL AND json_valid(intent.evidence_json)
    AND intent.principal_spent_wei = '0'
    AND intent.network_fee_wei = intent.total_spent_wei
    AND intent.total_spent_wei GLOB '[0-9]*'
    AND intent.total_spent_wei NOT GLOB '*[^0-9]*'
    AND (intent.total_spent_wei = '0' OR substr(intent.total_spent_wei, 1, 1) <> '0')
    AND length(intent.total_spent_wei) <= 19
    AND CAST(intent.total_spent_wei AS INTEGER) < 1000000000000000000
    AND claim.state = 'queued' AND claim.claim_signature IS NULL
    AND claim.destination_chain = 'chiliz'
    AND NEW.entity_type = 'reward_claim'
    AND NEW.entity_id = predecessor.entity_id
    AND NEW.chain = 'chiliz'
    AND NEW.payload_json = json_remove(predecessor.payload_json, '$.reconciliationReceipt')
    AND NEW.state = 'queued' AND NEW.attempt = 0
    AND NEW.tx_hash IS NULL AND NEW.error_code IS NULL AND NEW.leased_until IS NULL
    AND NEW.available_at >= 0
)
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_job_ineligible'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_job_identity_immutable` BEFORE UPDATE OF
  id, job_type, entity_type, entity_id, chain, retry_of_job_id, payload_json
  ON `automation_jobs`
WHEN OLD.job_type = 'chiliz_claim_retry' OR
  EXISTS (SELECT 1 FROM chiliz_claim_retry_policy policy
    WHERE policy.predecessor_job_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_job_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_job_marker_update` BEFORE UPDATE OF
  job_type, retry_of_job_id ON `automation_jobs`
WHEN NEW.job_type <> 'chiliz_claim_retry' AND NEW.retry_of_job_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_marker_only'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_predecessor_job_immutable` BEFORE UPDATE OF
  state, error_code, tx_hash, attempt, leased_until ON `automation_jobs`
WHEN EXISTS (SELECT 1 FROM chiliz_claim_retry_policy policy
  WHERE policy.predecessor_job_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_predecessor_job_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_job_no_delete` BEFORE DELETE ON `automation_jobs`
WHEN OLD.job_type = 'chiliz_claim_retry' OR
  EXISTS (SELECT 1 FROM chiliz_claim_retry_policy policy
    WHERE policy.predecessor_job_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_job_no_delete'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_predecessor_intent_immutable` BEFORE UPDATE OF
  state, broadcast_attempted_at, receipt_status, receipt_block_hash,
  receipt_block_number, canonical_receipt_block_hash, finalized_block_number,
  gas_used, effective_gas_price_wei, network_fee_wei, principal_spent_wei,
  total_spent_wei, evidence_json ON `chiliz_signed_intents`
WHEN EXISTS (SELECT 1 FROM chiliz_claim_retry_policy policy
  WHERE policy.predecessor_intent_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_predecessor_intent_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_policy_insert` BEFORE INSERT ON `chiliz_claim_retry_policy`
WHEN NEW.state <> 'paused' OR NEW.reserved_intent_id IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM automation_jobs retry
  JOIN automation_jobs predecessor ON predecessor.id = retry.retry_of_job_id
  JOIN chiliz_signed_intents intent ON intent.id = NEW.predecessor_intent_id
    AND intent.job_id = predecessor.id
  JOIN chiliz_intent_policy original_policy
    ON original_policy.key = 'claim_canary'
   AND original_policy.authorized_job_id = predecessor.id
   AND original_policy.reserved_intent_id = intent.id
  JOIN reward_claims claim ON claim.id = retry.entity_id
  WHERE retry.id = NEW.job_id AND retry.job_type = 'chiliz_claim_retry'
    AND retry.entity_type = 'reward_claim' AND retry.entity_id = predecessor.entity_id
    AND retry.chain = 'chiliz' AND retry.state = 'queued' AND retry.attempt = 0
    AND retry.tx_hash IS NULL AND retry.error_code IS NULL
    AND retry.payload_json = json_remove(predecessor.payload_json, '$.reconciliationReceipt')
    AND predecessor.id = NEW.predecessor_job_id
    AND predecessor.job_type = 'chiliz_claim_unwrap'
    AND predecessor.entity_type = 'reward_claim' AND predecessor.chain = 'chiliz'
    AND predecessor.state = 'failed'
    AND predecessor.error_code = 'chiliz_finalized_reverted'
    AND predecessor.tx_hash = intent.tx_hash
    AND intent.kind = 'claim' AND intent.state = 'finalized_reverted'
    AND intent.receipt_status = 'reverted'
    AND intent.receipt_block_hash = intent.canonical_receipt_block_hash
    AND intent.receipt_block_number >= 0
    AND intent.finalized_block_number >= intent.receipt_block_number
    AND intent.principal_spent_wei = '0'
    AND intent.network_fee_wei = intent.total_spent_wei
    AND claim.state = 'queued' AND claim.claim_signature IS NULL
    AND claim.destination_chain = 'chiliz'
    AND NEW.predecessor_tx_hash = intent.tx_hash
    AND NEW.predecessor_receipt_block_hash = intent.receipt_block_hash
    AND NEW.predecessor_receipt_block_number = intent.receipt_block_number
    AND NEW.predecessor_finalized_block_number = intent.finalized_block_number
    AND NEW.predecessor_evidence_json = intent.evidence_json
    AND NEW.predecessor_spent_wei = intent.total_spent_wei
)
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_policy_ineligible'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_policy_immutable` BEFORE UPDATE OF
  job_id, predecessor_job_id, predecessor_intent_id, predecessor_tx_hash,
  predecessor_receipt_block_hash, predecessor_receipt_block_number,
  predecessor_finalized_block_number, predecessor_evidence_json,
  predecessor_spent_wei, max_retry_spend_wei ON `chiliz_claim_retry_policy`
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_policy_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_policy_state` BEFORE UPDATE OF state
  ON `chiliz_claim_retry_policy`
WHEN NOT (
  NEW.state = OLD.state OR
  (OLD.state = 'paused' AND OLD.reserved_intent_id IS NULL AND NEW.state = 'armed') OR
  (OLD.state = 'armed' AND NEW.state IN ('paused', 'reserved')) OR
  (OLD.state = 'reserved' AND NEW.state = 'paused')
)
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_policy_state'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_policy_reservation` BEFORE UPDATE OF
  reserved_intent_id ON `chiliz_claim_retry_policy`
WHEN (OLD.reserved_intent_id IS NOT NULL AND NEW.reserved_intent_id IS NOT OLD.reserved_intent_id) OR
  (OLD.reserved_intent_id IS NULL AND NEW.reserved_intent_id IS NOT NULL AND
    NOT EXISTS (SELECT 1 FROM chiliz_signed_intents intent
      WHERE intent.id = NEW.reserved_intent_id AND intent.job_id = OLD.job_id
        AND intent.kind = 'claim'))
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_policy_reservation'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_policy_no_delete` BEFORE DELETE ON `chiliz_claim_retry_policy`
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_policy_no_delete'); END;
--> statement-breakpoint
-- This cap is checked again at the actual signed-intent boundary. A new
-- signed transaction cannot exceed remaining gas budget even if an operator
-- bypasses the helper that created the paused policy.
CREATE TRIGGER `trg_chiliz_claim_retry_intent_insert` BEFORE INSERT ON `chiliz_signed_intents`
WHEN EXISTS (SELECT 1 FROM automation_jobs retry
  WHERE retry.id = NEW.job_id AND retry.job_type = 'chiliz_claim_retry')
  AND NOT EXISTS (
    SELECT 1 FROM chiliz_claim_retry_policy policy
    JOIN automation_jobs retry ON retry.id = policy.job_id
    JOIN reward_claims claim ON claim.id = retry.entity_id
    WHERE policy.job_id = NEW.job_id AND policy.state = 'armed'
      AND policy.reserved_intent_id IS NULL
      AND retry.state = 'broadcasting' AND retry.attempt = 1
      AND claim.state = 'queued' AND claim.claim_signature IS NULL
      AND claim.destination_chain = 'chiliz'
      AND NEW.kind = 'claim' AND NEW.attempt = 1 AND NEW.chain_id = 88888
      AND NEW.state = 'prepared' AND NEW.broadcast_attempted_at IS NULL
      AND NEW.receipt_status IS NULL AND NEW.receipt_block_hash IS NULL
      AND NEW.receipt_block_number IS NULL AND NEW.evidence_json IS NULL
      AND NEW.maximum_principal_wei = '0'
      AND NEW.maximum_network_fee_wei = NEW.maximum_total_spend_wei
      AND NEW.maximum_total_spend_wei GLOB '[1-9]*'
      AND NEW.maximum_total_spend_wei NOT GLOB '*[^0-9]*'
      AND length(NEW.maximum_total_spend_wei) <= 19
      AND CAST(NEW.maximum_total_spend_wei AS INTEGER) <= CAST(policy.max_retry_spend_wei AS INTEGER)
      AND CAST(policy.predecessor_spent_wei AS INTEGER) + CAST(NEW.maximum_total_spend_wei AS INTEGER) <= 1000000000000000000
  )
BEGIN SELECT RAISE(ABORT, 'chiliz_claim_retry_intent_unauthorized'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_claim_retry_intent_reserve` AFTER INSERT ON `chiliz_signed_intents`
WHEN EXISTS (SELECT 1 FROM automation_jobs retry
  WHERE retry.id = NEW.job_id AND retry.job_type = 'chiliz_claim_retry')
BEGIN
  UPDATE chiliz_claim_retry_policy SET state = 'reserved',
    reserved_intent_id = NEW.id, updated_at = CURRENT_TIMESTAMP
  WHERE job_id = NEW.job_id AND state = 'armed' AND reserved_intent_id IS NULL;
END;
