CREATE TABLE `devnet_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`mint` text NOT NULL,
	`signature` text NOT NULL,
	`blockhash` text NOT NULL,
	`last_valid_block_height` integer NOT NULL,
	`status` text DEFAULT 'recorded' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_devnet_submissions_draft_kind` ON `devnet_submissions` (`draft_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_devnet_submissions_signature` ON `devnet_submissions` (`signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_devnet_submissions_mint_kind` ON `devnet_submissions` (`mint`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_devnet_submissions_owner_status` ON `devnet_submissions` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_drafts_devnet_mint` ON `launch_drafts` (`devnet_mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_drafts_devnet_create_signature` ON `launch_drafts` (`devnet_create_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_drafts_devnet_fee_signature` ON `launch_drafts` (`devnet_fee_signature`);