CREATE TABLE `holder_epoch_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`epoch_id` text NOT NULL,
	`launch_id` text NOT NULL,
	`wallet` text NOT NULL,
	`token_seconds_atomic` text DEFAULT '0' NOT NULL,
	`ending_balance_atomic` text DEFAULT '0' NOT NULL,
	`last_observed_slot` integer,
	`excluded` integer DEFAULT false NOT NULL,
	`exclusion_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`epoch_id`) REFERENCES `reward_epochs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_holder_positions_epoch_wallet` ON `holder_epoch_positions` (`epoch_id`,`wallet`);--> statement-breakpoint
CREATE INDEX `idx_holder_positions_launch_wallet` ON `holder_epoch_positions` (`launch_id`,`wallet`);--> statement-breakpoint
CREATE TABLE `protocol_controls` (
	`key` text PRIMARY KEY NOT NULL,
	`settlement_paused` integer DEFAULT true NOT NULL,
	`rewards_paused` integer DEFAULT true NOT NULL,
	`buyback_paused` integer DEFAULT true NOT NULL,
	`pause_reason` text DEFAULT 'signer_not_configured' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by_user_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `protocol_events` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text NOT NULL,
	`signature` text,
	`slot` integer,
	`amount_atomic` text,
	`mint` text,
	`evidence_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_protocol_events_idempotency` ON `protocol_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_protocol_events_category_created` ON `protocol_events` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_protocol_events_entity` ON `protocol_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `reward_vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`reward_mint` text NOT NULL,
	`owner_address` text NOT NULL,
	`token_account` text,
	`state` text DEFAULT 'observed' NOT NULL,
	`inventory_atomic` text DEFAULT '0' NOT NULL,
	`reserved_atomic` text DEFAULT '0' NOT NULL,
	`allocated_atomic` text DEFAULT '0' NOT NULL,
	`claimed_atomic` text DEFAULT '0' NOT NULL,
	`last_observed_slot` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reward_vaults_launch_mint` ON `reward_vaults` (`launch_id`,`reward_mint`);--> statement-breakpoint
CREATE INDEX `idx_reward_vaults_state` ON `reward_vaults` (`state`);--> statement-breakpoint
CREATE TABLE `settlement_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_id` text NOT NULL,
	`stage` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'planned' NOT NULL,
	`input_mint` text,
	`output_mint` text,
	`input_amount_atomic` text,
	`output_amount_atomic` text,
	`minimum_output_atomic` text,
	`provider_request_id` text,
	`tx_signature` text,
	`verified_slot` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlement_steps_idempotency` ON `settlement_steps` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlement_steps_signature` ON `settlement_steps` (`tx_signature`);--> statement-breakpoint
CREATE INDEX `idx_settlement_steps_settlement_stage` ON `settlement_steps` (`settlement_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_settlement_steps_state` ON `settlement_steps` (`state`);--> statement-breakpoint
CREATE TABLE `treasury_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`address` text NOT NULL,
	`balance_lamports` text NOT NULL,
	`slot` integer NOT NULL,
	`observed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_treasury_observations_purpose_slot` ON `treasury_observations` (`purpose`,`slot`);--> statement-breakpoint
CREATE INDEX `idx_treasury_observations_observed` ON `treasury_observations` (`observed_at`);--> statement-breakpoint
CREATE TABLE `worker_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worker_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`worker` text NOT NULL,
	`trigger` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`items_seen` integer DEFAULT 0 NOT NULL,
	`items_changed` integer DEFAULT 0 NOT NULL,
	`cursor_before` text,
	`cursor_after` text,
	`error_code` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_worker_runs_worker_started` ON `worker_runs` (`worker`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_worker_runs_state_started` ON `worker_runs` (`state`,`started_at`);