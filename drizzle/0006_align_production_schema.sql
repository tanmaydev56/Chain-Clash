-- These columns already exist in db/schema.ts. This forward-only migration
-- brings databases created from the original migration chain into alignment.
ALTER TABLE `rooms` ADD `is_public` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `rooms` ADD `challenge_key` text;
--> statement-breakpoint
ALTER TABLE `rooms` ADD `stats_recorded` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `player_stats` ADD `mmr` integer DEFAULT 1000 NOT NULL;
