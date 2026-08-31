CREATE TABLE `leaderboard` (
	`player_name` text PRIMARY KEY NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`best_score` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moves` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`player_id` text NOT NULL,
	`word` text NOT NULL,
	`valid` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`name` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`lives` integer DEFAULT 3 NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_player_id` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`current_letter` text DEFAULT 't' NOT NULL,
	`turn_player_id` text,
	`winner_player_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
