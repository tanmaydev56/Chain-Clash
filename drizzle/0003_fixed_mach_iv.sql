CREATE TABLE IF NOT EXISTS `daily_attempts` (
	`user_id` text NOT NULL,
	`challenge_key` text NOT NULL,
	`score` integer NOT NULL,
	`won` integer NOT NULL,
	`completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_daily_attempt_user_challenge` ON `daily_attempts` (`user_id`,`challenge_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `player_stats` (
	`user_id` text PRIMARY KEY NOT NULL,
	`games_played` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`best_score` integer DEFAULT 0 NOT NULL,
	`total_score` integer DEFAULT 0 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`daily_streak` integer DEFAULT 0 NOT NULL,
	`last_daily_key` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`reporter_user_id` text NOT NULL,
	`reported_player_id` text,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reports_room_created` ON `reports` (`room_code`,`created_at`);
