ALTER TABLE `settlement_steps` ADD `burn_signature` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlement_steps_burn_signature` ON `settlement_steps` (`burn_signature`) WHERE "settlement_steps"."burn_signature" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlement_steps_one_active_reward_chunk` ON `settlement_steps` (`settlement_id`) WHERE "settlement_steps"."stage" = 'automatic_reward_chunk' AND "settlement_steps"."state" <> 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_settlement_steps_one_active_buyback_chunk` ON `settlement_steps` (`settlement_id`) WHERE "settlement_steps"."stage" = 'automatic_buyback_chunk' AND "settlement_steps"."state" <> 'verified';--> statement-breakpoint
ALTER TABLE `settlements` ADD `reward_spent_atomic` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `buyback_spent_atomic` text DEFAULT '0' NOT NULL;