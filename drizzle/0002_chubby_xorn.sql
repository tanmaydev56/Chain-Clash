CREATE TABLE `leaderboard_entries` (
	`user_id` text PRIMARY KEY NOT NULL,
	`player_name` text NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`best_score` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `word_cache` (
	`category` text NOT NULL,
	`word` text NOT NULL,
	`verdict` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_word_cache_category_word` ON `word_cache` (`category`,`word`);--> statement-breakpoint
ALTER TABLE `players` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `players` ADD `is_bot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `turn_deadline` integer;