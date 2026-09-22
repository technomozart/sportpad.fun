CREATE TABLE `automation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`chain` text NOT NULL,
	`payload_json` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`tx_hash` text,
	`error_code` text,
	`available_at` integer NOT NULL,
	`leased_until` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_job_entity_type` ON `automation_jobs` (`entity_id`,`job_type`);--> statement-breakpoint
CREATE INDEX `idx_automation_jobs_state_available` ON `automation_jobs` (`state`,`available_at`);--> statement-breakpoint
CREATE TABLE `evm_wallet_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`solana_wallet` text NOT NULL,
	`evm_address` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_evm_challenges_owner_address` ON `evm_wallet_challenges` (`owner_user_id`,`evm_address`);--> statement-breakpoint
CREATE INDEX `idx_evm_challenges_expires` ON `evm_wallet_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `evm_wallet_links` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`solana_wallet` text NOT NULL,
	`evm_address` text NOT NULL,
	`chain_id` integer DEFAULT 88888 NOT NULL,
	`verified_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_evm_links_address` ON `evm_wallet_links` (`evm_address`);--> statement-breakpoint
CREATE INDEX `idx_evm_links_solana_wallet` ON `evm_wallet_links` (`solana_wallet`);--> statement-breakpoint
CREATE TABLE `protocol_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by_user_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `reward_chain` text DEFAULT 'solana' NOT NULL;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `reward_wrapped_contract` text;--> statement-breakpoint
ALTER TABLE `reward_claims` ADD `destination_chain` text DEFAULT 'solana' NOT NULL;--> statement-breakpoint
ALTER TABLE `reward_claims` ADD `destination_address` text;--> statement-breakpoint
ALTER TABLE `reward_claims` ADD `claim_fee_atomic` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `reward_claims` ADD `claim_requested_at` text;--> statement-breakpoint
ALTER TABLE `reward_vaults` ADD `chain` text DEFAULT 'solana' NOT NULL;