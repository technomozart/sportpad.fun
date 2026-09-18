CREATE TABLE `wallet_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wallet_challenges_owner_wallet` ON `wallet_challenges` (`owner_user_id`,`wallet_address`);--> statement-breakpoint
CREATE INDEX `idx_wallet_challenges_expires` ON `wallet_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `wallet_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wallet_sessions_owner_wallet` ON `wallet_sessions` (`owner_user_id`,`wallet_address`);--> statement-breakpoint
CREATE INDEX `idx_wallet_sessions_expires` ON `wallet_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `creator_wallet` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `devnet_metadata_uri` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `devnet_mint` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `devnet_create_signature` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `devnet_fee_signature` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `devnet_reward_wallet` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `devnet_burn_wallet` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `devnet_verified_at` text;