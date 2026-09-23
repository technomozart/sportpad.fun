CREATE TABLE `solana_reward_purchase_canary` (
	`key` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`max_input_lamports` integer NOT NULL,
	`reserved_input_lamports` integer DEFAULT 0 NOT NULL,
	`reward_batch_id` text,
	`state` text DEFAULT 'paused' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reward_batch_id`) REFERENCES `reward_swap_batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_solana_reward_canary_singleton" CHECK("solana_reward_purchase_canary"."key" = 'initial'),
	CONSTRAINT "chk_solana_reward_canary_cap" CHECK("solana_reward_purchase_canary"."max_input_lamports" BETWEEN 1000000 AND 100000000),
	CONSTRAINT "chk_solana_reward_canary_spend" CHECK("solana_reward_purchase_canary"."reserved_input_lamports" BETWEEN 0 AND "solana_reward_purchase_canary"."max_input_lamports"),
	CONSTRAINT "chk_solana_reward_canary_batch_reservation" CHECK(("solana_reward_purchase_canary"."reward_batch_id" IS NULL AND "solana_reward_purchase_canary"."reserved_input_lamports" = 0) OR ("solana_reward_purchase_canary"."reward_batch_id" IS NOT NULL AND "solana_reward_purchase_canary"."reserved_input_lamports" > 0)),
	CONSTRAINT "chk_solana_reward_canary_state" CHECK("solana_reward_purchase_canary"."state" IN ('paused', 'armed'))
);
