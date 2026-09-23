CREATE TABLE `chiliz_intent_policy` (
	`key` text PRIMARY KEY NOT NULL,
	`authorized_job_id` text,
	`reserved_intent_id` text,
	`max_total_spend_wei` text NOT NULL,
	`state` text DEFAULT 'paused' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`authorized_job_id`) REFERENCES `automation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_policy_slots" CHECK("chiliz_intent_policy"."key" IN ('purchase_canary', 'claim_canary')),
	CONSTRAINT "chk_chiliz_policy_state" CHECK("chiliz_intent_policy"."state" IN ('paused', 'armed', 'reserved')),
	CONSTRAINT "chk_chiliz_policy_reservation" CHECK("chiliz_intent_policy"."state" <> 'reserved' OR ("chiliz_intent_policy"."authorized_job_id" IS NOT NULL AND "chiliz_intent_policy"."reserved_intent_id" IS NOT NULL)),
	CONSTRAINT "chk_chiliz_policy_arm" CHECK("chiliz_intent_policy"."state" <> 'armed' OR ("chiliz_intent_policy"."authorized_job_id" IS NOT NULL AND "chiliz_intent_policy"."reserved_intent_id" IS NULL)),
	CONSTRAINT "chk_chiliz_policy_cap" CHECK("chiliz_intent_policy"."max_total_spend_wei" GLOB '[1-9]*' AND "chiliz_intent_policy"."max_total_spend_wei" NOT GLOB '*[^0-9]*' AND (length("chiliz_intent_policy"."max_total_spend_wei") < 19 OR (length("chiliz_intent_policy"."max_total_spend_wei") = 19 AND (("chiliz_intent_policy"."key" = 'purchase_canary' AND "chiliz_intent_policy"."max_total_spend_wei" <= '9000000000000000000') OR ("chiliz_intent_policy"."key" = 'claim_canary' AND "chiliz_intent_policy"."max_total_spend_wei" <= '1000000000000000000')))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_policy_authorized_job` ON `chiliz_intent_policy` (`authorized_job_id`) WHERE "chiliz_intent_policy"."authorized_job_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_policy_reserved_intent` ON `chiliz_intent_policy` (`reserved_intent_id`) WHERE "chiliz_intent_policy"."reserved_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `chiliz_signed_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`chain_id` integer NOT NULL,
	`treasury_address` text NOT NULL,
	`nonce` integer NOT NULL,
	`kind` text NOT NULL,
	`fan_token_contract` text NOT NULL,
	`tx_hash` text NOT NULL,
	`raw_transaction` text NOT NULL,
	`intent_json` text NOT NULL,
	`maximum_principal_wei` text NOT NULL,
	`maximum_network_fee_wei` text NOT NULL,
	`maximum_total_spend_wei` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`broadcast_attempted_at` integer,
	`receipt_status` text,
	`receipt_block_hash` text,
	`receipt_block_number` integer,
	`canonical_receipt_block_hash` text,
	`finalized_block_number` integer,
	`gas_used` text,
	`effective_gas_price_wei` text,
	`network_fee_wei` text,
	`principal_spent_wei` text,
	`total_spent_wei` text,
	`evidence_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `automation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_intent_chain" CHECK("chiliz_signed_intents"."chain_id" = 88888),
	CONSTRAINT "chk_chiliz_intent_attempt" CHECK("chiliz_signed_intents"."attempt" = 1),
	CONSTRAINT "chk_chiliz_intent_nonce" CHECK("chiliz_signed_intents"."nonce" >= 0),
	CONSTRAINT "chk_chiliz_intent_kind" CHECK("chiliz_signed_intents"."kind" IN ('purchase', 'claim')),
	CONSTRAINT "chk_chiliz_intent_state" CHECK("chiliz_signed_intents"."state" IN ('prepared', 'broadcast_attempted', 'finalized_success', 'finalized_reverted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_intent_job` ON `chiliz_signed_intents` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_intent_job_attempt` ON `chiliz_signed_intents` (`job_id`,`attempt`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_intent_treasury_nonce` ON `chiliz_signed_intents` (`treasury_address`,`nonce`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_intent_tx_hash` ON `chiliz_signed_intents` (`tx_hash`);--> statement-breakpoint
CREATE INDEX `idx_chiliz_intent_state` ON `chiliz_signed_intents` (`state`);
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_signed_intent_immutable` BEFORE UPDATE OF
  job_id, attempt, chain_id, treasury_address, nonce, kind,
  fan_token_contract, tx_hash, raw_transaction, intent_json,
  maximum_principal_wei, maximum_network_fee_wei, maximum_total_spend_wei
  ON `chiliz_signed_intents`
BEGIN SELECT RAISE(ABORT, 'chiliz_signed_intent_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_signed_intent_no_delete` BEFORE DELETE
  ON `chiliz_signed_intents`
BEGIN SELECT RAISE(ABORT, 'chiliz_signed_intent_no_delete'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_policy_reserved_immutable` BEFORE UPDATE OF
  authorized_job_id, reserved_intent_id ON `chiliz_intent_policy`
WHEN OLD.reserved_intent_id IS NOT NULL AND
  (NEW.authorized_job_id IS NOT OLD.authorized_job_id OR
   NEW.reserved_intent_id IS NOT OLD.reserved_intent_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_policy_reserved_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_policy_reserved_no_delete` BEFORE DELETE
  ON `chiliz_intent_policy` WHEN OLD.reserved_intent_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chiliz_policy_reserved_no_delete'); END;
