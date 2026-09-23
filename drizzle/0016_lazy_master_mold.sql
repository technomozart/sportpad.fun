CREATE TABLE `holder_snapshot_checkpoints` (
	`epoch_id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`last_observed_slot` integer NOT NULL,
	`last_observed_at` integer NOT NULL,
	`position_count` integer NOT NULL,
	`evidence_hash` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`epoch_id`) REFERENCES `reward_epochs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `holder_snapshot_staging` (
	`generation_id` text NOT NULL,
	`epoch_id` text NOT NULL,
	`launch_id` text NOT NULL,
	`wallet` text NOT NULL,
	`token_seconds_atomic` text NOT NULL,
	`ending_balance_atomic` text NOT NULL,
	`observed_slot` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`epoch_id`) REFERENCES `reward_epochs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_holder_snapshot_stage_generation_wallet` ON `holder_snapshot_staging` (`generation_id`,`wallet`);--> statement-breakpoint
CREATE INDEX `idx_holder_snapshot_stage_epoch` ON `holder_snapshot_staging` (`epoch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_jobs_tx_hash` ON `automation_jobs` (`tx_hash`) WHERE "automation_jobs"."tx_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlements_reward_swap_signature` ON `settlements` (`reward_swap_signature`) WHERE "settlements"."reward_swap_signature" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlements_buyback_swap_signature` ON `settlements` (`buyback_swap_signature`) WHERE "settlements"."buyback_swap_signature" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reward_claims_claim_signature` ON `reward_claims` (`claim_signature`) WHERE "reward_claims"."claim_signature" IS NOT NULL;
