ALTER TABLE `rooms` ADD `turn_direction` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `rooms` ADD `freeze_next` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `power_up_uses` (`command_id` text PRIMARY KEY NOT NULL, `room_code` text NOT NULL, `user_id` text NOT NULL, `power_up` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_power_up_uses_room` ON `power_up_uses` (`room_code`,`created_at`);
--> statement-breakpoint
CREATE TABLE `achievements` (`user_id` text NOT NULL, `achievement_id` text NOT NULL, `unlocked_at` integer NOT NULL, PRIMARY KEY(`user_id`,`achievement_id`));
