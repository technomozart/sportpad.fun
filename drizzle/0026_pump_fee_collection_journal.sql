CREATE TABLE `pump_fee_collection_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`mint` text NOT NULL,
	`collector_signer` text NOT NULL,
	`reward_treasury` text NOT NULL,
	`buyback_treasury` text NOT NULL,
	`recent_blockhash` text NOT NULL,
	`last_valid_block_height` integer NOT NULL,
	`history_anchor_signature` text NOT NULL,
	`signed_transaction_base64` text NOT NULL,
	`signed_transaction_sha256` text NOT NULL,
	`source_signature` text NOT NULL,
	`instruction_effect_state` text DEFAULT 'unverified' NOT NULL,
	`instruction_evidence_json` text,
	`state` text DEFAULT 'prepared' NOT NULL,
	`broadcast_attempted_at_ms` integer,
	`finalized_slot` integer,
	`finalized_evidence_json` text,
	`expired_observed_block_height` integer,
	`expiry_evidence_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `pump_fee_collection_policies`(`launch_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pump_fee_collection_intent_state" CHECK("pump_fee_collection_intents"."state" IN ('prepared', 'broadcast_attempted', 'held', 'finalized', 'expired')),
	CONSTRAINT "chk_pump_fee_collection_effect_state" CHECK("pump_fee_collection_intents"."instruction_effect_state" IN ('unverified', 'verified')),
	CONSTRAINT "chk_pump_fee_collection_block_height" CHECK("pump_fee_collection_intents"."last_valid_block_height" > 0),
	CONSTRAINT "chk_pump_fee_collection_signer" CHECK("pump_fee_collection_intents"."collector_signer" <> "pump_fee_collection_intents"."reward_treasury" AND "pump_fee_collection_intents"."collector_signer" <> "pump_fee_collection_intents"."buyback_treasury"),
	CONSTRAINT "chk_pump_fee_collection_treasuries" CHECK("pump_fee_collection_intents"."reward_treasury" <> "pump_fee_collection_intents"."buyback_treasury"),
	CONSTRAINT "chk_pump_fee_collection_sha256" CHECK(length("pump_fee_collection_intents"."signed_transaction_sha256") = 64 AND "pump_fee_collection_intents"."signed_transaction_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_pump_fee_collection_signature" CHECK(length("pump_fee_collection_intents"."source_signature") BETWEEN 64 AND 88 AND "pump_fee_collection_intents"."source_signature" <> "pump_fee_collection_intents"."history_anchor_signature")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pump_fee_collection_intent_signature` ON `pump_fee_collection_intents` (`source_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pump_fee_collection_intent_signed_sha256` ON `pump_fee_collection_intents` (`signed_transaction_sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pump_fee_collection_one_unresolved` ON `pump_fee_collection_intents` (`launch_id`) WHERE "pump_fee_collection_intents"."state" IN ('prepared', 'broadcast_attempted', 'held');--> statement-breakpoint
CREATE INDEX `idx_pump_fee_collection_intent_launch_state` ON `pump_fee_collection_intents` (`launch_id`,`state`);--> statement-breakpoint
CREATE TABLE `pump_fee_collection_policies` (
	`launch_id` text PRIMARY KEY NOT NULL,
	`mint` text NOT NULL,
	`collector_signer` text NOT NULL,
	`reward_treasury` text NOT NULL,
	`buyback_treasury` text NOT NULL,
	`state` text DEFAULT 'paused' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pump_fee_collection_policy_state" CHECK("pump_fee_collection_policies"."state" IN ('paused', 'armed')),
	CONSTRAINT "chk_pump_fee_collection_policy_signer" CHECK(length("pump_fee_collection_policies"."collector_signer") BETWEEN 32 AND 44 AND "pump_fee_collection_policies"."collector_signer" <> "pump_fee_collection_policies"."reward_treasury" AND "pump_fee_collection_policies"."collector_signer" <> "pump_fee_collection_policies"."buyback_treasury"),
	CONSTRAINT "chk_pump_fee_collection_policy_treasuries" CHECK("pump_fee_collection_policies"."reward_treasury" <> "pump_fee_collection_policies"."buyback_treasury")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pump_fee_collection_policy_mint` ON `pump_fee_collection_policies` (`mint`);
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_policy_insert_paused` BEFORE INSERT
  ON `pump_fee_collection_policies`
WHEN NEW.state <> 'paused' OR NOT EXISTS (
  SELECT 1 FROM launch_drafts launch WHERE launch.id = NEW.launch_id
    AND launch.status = 'mainnet_published'
    AND launch.mainnet_verified_at IS NOT NULL
    AND launch.mainnet_mint = NEW.mint
    AND launch.mainnet_reward_treasury = NEW.reward_treasury
    AND launch.mainnet_buyback_treasury = NEW.buyback_treasury
    AND launch.mainnet_creator_wallet <> NEW.collector_signer
)
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_policy_ineligible'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_policy_identity_immutable` BEFORE UPDATE OF
  launch_id, mint, collector_signer, reward_treasury, buyback_treasury
  ON `pump_fee_collection_policies`
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_policy_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_policy_arm` BEFORE UPDATE OF state
  ON `pump_fee_collection_policies`
WHEN NEW.state = 'armed' AND NOT EXISTS (
  SELECT 1 FROM launch_drafts launch WHERE launch.id = OLD.launch_id
    AND launch.status = 'mainnet_published'
    AND launch.mainnet_verified_at IS NOT NULL
    AND launch.mainnet_mint = OLD.mint
    AND launch.mainnet_reward_treasury = OLD.reward_treasury
    AND launch.mainnet_buyback_treasury = OLD.buyback_treasury
)
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_launch_not_published'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_policy_no_delete` BEFORE DELETE
  ON `pump_fee_collection_policies`
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_policy_no_delete'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_intent_insert` BEFORE INSERT
  ON `pump_fee_collection_intents`
WHEN NEW.state <> 'prepared' OR NEW.instruction_effect_state <> 'unverified'
  OR NEW.instruction_evidence_json IS NOT NULL
  OR NEW.broadcast_attempted_at_ms IS NOT NULL
  OR NEW.finalized_slot IS NOT NULL OR NEW.finalized_evidence_json IS NOT NULL
  OR NEW.expired_observed_block_height IS NOT NULL OR NEW.expiry_evidence_json IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM pump_fee_collection_policies policy
    JOIN launch_drafts launch ON launch.id = policy.launch_id
    WHERE policy.launch_id = NEW.launch_id AND policy.state = 'armed'
      AND policy.mint = NEW.mint
      AND policy.collector_signer = NEW.collector_signer
      AND policy.reward_treasury = NEW.reward_treasury
      AND policy.buyback_treasury = NEW.buyback_treasury
      AND launch.status = 'mainnet_published'
      AND launch.mainnet_verified_at IS NOT NULL
      AND launch.mainnet_mint = NEW.mint
      AND launch.mainnet_creator_wallet <> NEW.collector_signer
      AND launch.mainnet_reward_treasury = NEW.reward_treasury
      AND launch.mainnet_buyback_treasury = NEW.buyback_treasury
  )
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_intent_ineligible'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_intent_immutable` BEFORE UPDATE OF
  id, launch_id, mint, collector_signer, reward_treasury, buyback_treasury,
  recent_blockhash, last_valid_block_height, history_anchor_signature,
  signed_transaction_base64, signed_transaction_sha256, source_signature
  ON `pump_fee_collection_intents`
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_intent_immutable'); END;
--> statement-breakpoint
-- No self-attested JSON may unlock money movement. A later migration may
-- replace this hard stop only alongside an independent exact signed-message
-- verifier for Pump V2 instructions and a successful simulation.
CREATE TRIGGER `trg_pump_fee_collection_effect_attestation` BEFORE UPDATE OF
  instruction_effect_state, instruction_evidence_json
  ON `pump_fee_collection_intents`
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_effect_unverified'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_state_transition` BEFORE UPDATE OF state
  ON `pump_fee_collection_intents`
WHEN NOT (
  NEW.state = OLD.state OR
  (OLD.state = 'prepared' AND NEW.state IN ('broadcast_attempted', 'expired')) OR
  (OLD.state = 'broadcast_attempted' AND NEW.state IN ('held', 'finalized', 'expired')) OR
  (OLD.state = 'held' AND NEW.state IN ('finalized', 'expired'))
)
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_state_transition'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_state_shape` BEFORE UPDATE
  ON `pump_fee_collection_intents`
WHEN
  (NEW.instruction_effect_state = 'unverified' AND NEW.instruction_evidence_json IS NOT NULL) OR
  (NEW.instruction_effect_state = 'verified' AND NEW.instruction_evidence_json IS NULL) OR
  (NEW.state = 'prepared' AND (
    NEW.broadcast_attempted_at_ms IS NOT NULL OR NEW.finalized_slot IS NOT NULL OR
    NEW.finalized_evidence_json IS NOT NULL OR
    NEW.expired_observed_block_height IS NOT NULL OR NEW.expiry_evidence_json IS NOT NULL)) OR
  (NEW.state IN ('broadcast_attempted', 'held') AND (
    NEW.instruction_effect_state <> 'verified' OR
    NEW.broadcast_attempted_at_ms IS NULL OR NEW.finalized_slot IS NOT NULL OR
    NEW.finalized_evidence_json IS NOT NULL OR
    NEW.expired_observed_block_height IS NOT NULL OR NEW.expiry_evidence_json IS NOT NULL)) OR
  (NEW.state = 'finalized' AND (
    NEW.instruction_effect_state <> 'verified' OR
    NEW.broadcast_attempted_at_ms IS NULL OR NEW.finalized_slot IS NULL OR
    NEW.finalized_evidence_json IS NULL OR
    NEW.expired_observed_block_height IS NOT NULL OR NEW.expiry_evidence_json IS NOT NULL)) OR
  (NEW.state = 'expired' AND (
    NEW.expired_observed_block_height IS NULL OR NEW.expiry_evidence_json IS NULL OR
    NEW.finalized_slot IS NOT NULL OR NEW.finalized_evidence_json IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_state_shape'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_evidence_immutable` BEFORE UPDATE OF
  broadcast_attempted_at_ms, finalized_slot, finalized_evidence_json,
  expired_observed_block_height, expiry_evidence_json
  ON `pump_fee_collection_intents`
WHEN (OLD.broadcast_attempted_at_ms IS NOT NULL AND
      NEW.broadcast_attempted_at_ms IS NOT OLD.broadcast_attempted_at_ms) OR
     (OLD.finalized_slot IS NOT NULL AND NEW.finalized_slot IS NOT OLD.finalized_slot) OR
     (OLD.finalized_evidence_json IS NOT NULL AND
      NEW.finalized_evidence_json IS NOT OLD.finalized_evidence_json) OR
     (OLD.expired_observed_block_height IS NOT NULL AND
      NEW.expired_observed_block_height IS NOT OLD.expired_observed_block_height) OR
     (OLD.expiry_evidence_json IS NOT NULL AND
      NEW.expiry_evidence_json IS NOT OLD.expiry_evidence_json)
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_evidence_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_pump_fee_collection_intent_no_delete` BEFORE DELETE
  ON `pump_fee_collection_intents`
BEGIN SELECT RAISE(ABORT, 'pump_fee_collection_intent_no_delete'); END;
