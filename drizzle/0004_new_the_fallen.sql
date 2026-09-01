CREATE TABLE IF NOT EXISTS `weekly_leaderboard` (
	`user_id` text NOT NULL,
	`week_key` text NOT NULL,
	`player_name` text NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`best_score` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_weekly_leaderboard_user_week` ON `weekly_leaderboard` (`user_id`,`week_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_weekly_leaderboard_week` ON `weekly_leaderboard` (`week_key`,`wins`,`best_score`);
