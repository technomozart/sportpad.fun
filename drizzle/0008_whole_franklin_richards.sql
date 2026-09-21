CREATE TABLE `launch_moderation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`reason_code` text,
	`owner_message` text,
	`version` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_launch_moderation_draft_version` ON `launch_moderation_events` (`draft_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_launch_moderation_state_created` ON `launch_moderation_events` (`to_state`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_windows` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limit_windows_expires` ON `rate_limit_windows` (`window_expires_at`);--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_submitted_at` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_reviewed_at` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_actor_user_id` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_actor_role` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_action` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_reason` text;--> statement-breakpoint
ALTER TABLE `launch_drafts` ADD `moderation_owner_message` text;--> statement-breakpoint
CREATE TRIGGER `trg_launch_moderation_audit`
AFTER UPDATE OF `status` ON `launch_drafts`
WHEN OLD.`status` <> NEW.`status`
  AND NEW.`moderation_version` = OLD.`moderation_version` + 1
  AND NEW.`moderation_actor_user_id` IS NOT NULL
  AND NEW.`moderation_actor_role` IS NOT NULL
  AND NEW.`moderation_action` IS NOT NULL
BEGIN
  INSERT INTO `launch_moderation_events` (
    `id`, `draft_id`, `actor_user_id`, `actor_role`, `action`,
    `from_state`, `to_state`, `reason_code`, `owner_message`, `version`, `created_at`
  ) VALUES (
    NEW.`id` || ':' || CAST(NEW.`moderation_version` AS TEXT),
    NEW.`id`, NEW.`moderation_actor_user_id`, NEW.`moderation_actor_role`, NEW.`moderation_action`,
    OLD.`status`, NEW.`status`, NEW.`moderation_reason`, NEW.`moderation_owner_message`,
    NEW.`moderation_version`, CURRENT_TIMESTAMP
  );
END;
