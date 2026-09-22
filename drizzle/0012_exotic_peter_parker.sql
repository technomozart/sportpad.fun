ALTER TABLE `transaction_intents` ADD `settlement_id` text REFERENCES settlements(id);--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `signer_address` text;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `unsigned_transaction_base64` text;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `transaction_message_hash` text;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `last_valid_block_height` integer;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `input_mint` text;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `output_mint` text;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `input_amount_atomic` text;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `minimum_output_atomic` text;--> statement-breakpoint
CREATE INDEX `idx_transaction_intents_settlement_action` ON `transaction_intents` (`settlement_id`,`action`);