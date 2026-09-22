CREATE TABLE `transaction_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`signer_role` text NOT NULL,
	`action` text NOT NULL,
	`state` text DEFAULT 'planned' NOT NULL,
	`expected_programs_json` text NOT NULL,
	`expected_mints_json` text NOT NULL,
	`maximum_spend_lamports` text NOT NULL,
	`provider_request_id` text,
	`tx_signature` text,
	`expires_at` text NOT NULL,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transaction_intents_idempotency` ON `transaction_intents` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transaction_intents_signature` ON `transaction_intents` (`tx_signature`);--> statement-breakpoint
CREATE INDEX `idx_transaction_intents_state_created` ON `transaction_intents` (`state`,`created_at`);