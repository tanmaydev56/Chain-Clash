ALTER TABLE `rooms` ADD `mode` text DEFAULT 'classic' NOT NULL;
--> statement-breakpoint
ALTER TABLE `rooms` ADD `blocked_letter` text;
--> statement-breakpoint
ALTER TABLE `players` ADD `shield` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `player_stats` ADD `coins` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `avatar` text;
--> statement-breakpoint
CREATE TABLE `match_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`room_code` text NOT NULL,
	`mode` text NOT NULL,
	`category` text NOT NULL,
	`score` integer NOT NULL,
	`won` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_match_history_user_created` ON `match_history` (`user_id`,`created_at`);
