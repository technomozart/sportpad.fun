ALTER TABLE `launch_drafts` ADD `mainnet_creator_wallet` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_metadata_uri` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_mint` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_create_signature` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_fee_signature` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_create_slot` integer;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_fee_slot` integer;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_reward_treasury` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_buyback_treasury` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `mainnet_verified_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_drafts_mainnet_mint` ON `launch_drafts` (`mainnet_mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_drafts_mainnet_create_signature` ON `launch_drafts` (`mainnet_create_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_drafts_mainnet_fee_signature` ON `launch_drafts` (`mainnet_fee_signature`);