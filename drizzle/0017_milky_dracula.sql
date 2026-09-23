CREATE TABLE `__new_evm_wallet_links` (
	`owner_user_id` text NOT NULL,
	`solana_wallet` text NOT NULL,
	`evm_address` text NOT NULL,
	`chain_id` integer DEFAULT 88888 NOT NULL,
	`verified_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `solana_wallet`)
);
--> statement-breakpoint
INSERT INTO `__new_evm_wallet_links`("owner_user_id", "solana_wallet", "evm_address", "chain_id", "verified_at", "updated_at") SELECT "owner_user_id", "solana_wallet", "evm_address", "chain_id", "verified_at", "updated_at" FROM `evm_wallet_links`;--> statement-breakpoint
DROP TABLE `evm_wallet_links`;--> statement-breakpoint
ALTER TABLE `__new_evm_wallet_links` RENAME TO `evm_wallet_links`;--> statement-breakpoint
CREATE INDEX `idx_evm_links_address` ON `evm_wallet_links` (`evm_address`);--> statement-breakpoint
CREATE INDEX `idx_evm_links_solana_wallet` ON `evm_wallet_links` (`solana_wallet`);
