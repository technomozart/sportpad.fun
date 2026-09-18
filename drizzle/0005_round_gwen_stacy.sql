ALTER TABLE `devnet_submissions` ADD `creator_wallet` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `devnet_submissions` ADD `metadata_uri` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `devnet_submissions` ADD `reward_wallet` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `devnet_submissions` ADD `burn_wallet` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `devnet_submissions` ADD `token_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `devnet_submissions` ADD `token_symbol` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `devnet_submissions` ADD `verified_slot` integer;