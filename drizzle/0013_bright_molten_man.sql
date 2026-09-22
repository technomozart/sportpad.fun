ALTER TABLE `holder_epoch_positions` ADD `last_observed_at` integer;--> statement-breakpoint
ALTER TABLE `reward_claims` ADD `confirmed_slot` integer;--> statement-breakpoint
ALTER TABLE `reward_epochs` ADD `allocated_amount_atomic` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `reward_epochs` ADD `dust_amount_atomic` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `reward_epochs` ADD `reward_decimals` integer;--> statement-breakpoint
ALTER TABLE `reward_epochs` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE `reward_epochs` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `transaction_intents` ADD `claim_id` text REFERENCES reward_claims(id);--> statement-breakpoint
CREATE INDEX `idx_transaction_intents_claim_action` ON `transaction_intents` (`claim_id`,`action`);--> statement-breakpoint
INSERT INTO `protocol_controls` (`key`, `settlement_paused`, `rewards_paused`, `buyback_paused`, `pause_reason`, `revision`, `updated_by_user_id`, `updated_at`)
VALUES ('global', 0, 0, 0, 'wallet_confirmed_execution', 1, 'deployment:migration:0013', CURRENT_TIMESTAMP)
ON CONFLICT(`key`) DO UPDATE SET
  `settlement_paused` = 0,
  `rewards_paused` = 0,
  `buyback_paused` = 0,
  `pause_reason` = 'wallet_confirmed_execution',
  `revision` = `protocol_controls`.`revision` + 1,
  `updated_by_user_id` = 'deployment:migration:0013',
  `updated_at` = CURRENT_TIMESTAMP;--> statement-breakpoint
INSERT OR IGNORE INTO `protocol_events` (`id`, `category`, `entity_type`, `entity_id`, `event_type`, `idempotency_key`, `state`)
VALUES ('deployment:0013:wallet-execution', 'control', 'protocol', 'global', 'wallet_execution_enabled', 'deployment:0013:wallet-execution', 'verified');
