CREATE TABLE `fee_events` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`source_signature` text NOT NULL,
	`source_slot` integer NOT NULL,
	`gross_amount_atomic` text NOT NULL,
	`state` text DEFAULT 'observed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fee_events_source_signature` ON `fee_events` (`source_signature`);--> statement-breakpoint
CREATE INDEX `idx_fee_events_launch_state` ON `fee_events` (`launch_id`,`state`);--> statement-breakpoint
CREATE TABLE `launch_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`reward_symbol` text NOT NULL,
	`reward_mint` text,
	`reward_bps` integer DEFAULT 8000 NOT NULL,
	`buyback_bps` integer DEFAULT 2000 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_launch_drafts_owner_created` ON `launch_drafts` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_launch_drafts_status` ON `launch_drafts` (`status`);--> statement-breakpoint
CREATE TABLE `reward_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`epoch_id` text NOT NULL,
	`solana_wallet` text NOT NULL,
	`amount_atomic` text NOT NULL,
	`claim_signature` text,
	`state` text DEFAULT 'claimable' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`epoch_id`) REFERENCES `reward_epochs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reward_claims_epoch_wallet` ON `reward_claims` (`epoch_id`,`solana_wallet`);--> statement-breakpoint
CREATE INDEX `idx_reward_claims_wallet_state` ON `reward_claims` (`solana_wallet`,`state`);--> statement-breakpoint
CREATE TABLE `reward_epochs` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`cutoff_slot` integer,
	`funded_amount_atomic` text DEFAULT '0' NOT NULL,
	`merkle_root` text,
	`allocation_hash` text,
	`state` text DEFAULT 'accruing' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reward_epochs_launch_state` ON `reward_epochs` (`launch_id`,`state`);--> statement-breakpoint
CREATE TABLE `service_cursors` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_event_id` text NOT NULL,
	`reward_amount_atomic` text NOT NULL,
	`buyback_amount_atomic` text NOT NULL,
	`reward_swap_signature` text,
	`buyback_swap_signature` text,
	`burn_signature` text,
	`state` text DEFAULT 'distributed' NOT NULL,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`fee_event_id`) REFERENCES `fee_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlements_fee_event` ON `settlements` (`fee_event_id`);--> statement-breakpoint
CREATE INDEX `idx_settlements_state` ON `settlements` (`state`);--> statement-breakpoint
PRAGMA optimize;
