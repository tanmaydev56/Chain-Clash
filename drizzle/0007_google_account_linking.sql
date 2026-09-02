ALTER TABLE `users` ADD `google_subject` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `google_email` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `linked_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_google_subject` ON `users` (`google_subject`);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_states_expiry` ON `oauth_states` (`expires_at`);
