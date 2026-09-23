CREATE TABLE `reward_swap_batch_sources` (
	`batch_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`offset_atomic` text NOT NULL,
	`input_amount_atomic` text NOT NULL,
	`total_atomic` text NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`verified_signature` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`batch_id`, `settlement_id`, `offset_atomic`),
	FOREIGN KEY (`batch_id`) REFERENCES `reward_swap_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reward_swap_sources_settlement_offset` ON `reward_swap_batch_sources` (`settlement_id`,`offset_atomic`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reward_swap_sources_active_settlement` ON `reward_swap_batch_sources` (`settlement_id`) WHERE "reward_swap_batch_sources"."state" = 'reserved';--> statement-breakpoint
CREATE INDEX `idx_reward_swap_sources_batch_state` ON `reward_swap_batch_sources` (`batch_id`,`state`);--> statement-breakpoint
CREATE TABLE `reward_swap_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`reward_mint` text NOT NULL,
	`treasury` text NOT NULL,
	`input_amount_atomic` text DEFAULT '0' NOT NULL,
	`state` text DEFAULT 'collecting' NOT NULL,
	`tx_signature` text,
	`output_amount_atomic` text,
	`verified_slot` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reward_swap_batches_open_launch` ON `reward_swap_batches` (`launch_id`) WHERE "reward_swap_batches"."state" IN ('collecting', 'queued');--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reward_swap_batches_signature` ON `reward_swap_batches` (`tx_signature`) WHERE "reward_swap_batches"."tx_signature" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_reward_swap_batches_state_created` ON `reward_swap_batches` (`state`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_settlements_reward_swap_signature`;--> statement-breakpoint
CREATE INDEX `idx_settlements_reward_swap_signature` ON `settlements` (`reward_swap_signature`);--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `reward_batch_id` text REFERENCES reward_swap_batches(id);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transaction_intents_reward_batch` ON `transaction_intents` (`reward_batch_id`) WHERE "transaction_intents"."reward_batch_id" IS NOT NULL;