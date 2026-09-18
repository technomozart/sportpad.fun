DROP INDEX `idx_fee_events_source_signature`;--> statement-breakpoint
ALTER TABLE `fee_events` ADD `instruction_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fee_events_source_instruction` ON `fee_events` (`source_signature`,`instruction_index`);--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `sport` text DEFAULT 'Football' NOT NULL;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `website` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `social` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `rights_attested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `unofficial_attested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `economics_attested` integer DEFAULT false NOT NULL;