CREATE INDEX `idx_moves_room_created` ON `moves` (`room_code`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_players_room_code` ON `players` (`room_code`);