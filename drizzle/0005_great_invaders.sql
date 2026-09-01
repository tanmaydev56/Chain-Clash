CREATE TABLE `guest_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_guest_sessions_user` ON `guest_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `state_version` integer DEFAULT 0 NOT NULL;