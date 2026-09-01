import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  hostPlayerId: text('host_player_id').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull().default('waiting'),
  currentLetter: text('current_letter').notNull().default('t'),
  turnPlayerId: text('turn_player_id'),
  winnerPlayerId: text('winner_player_id'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  turnDeadline: integer('turn_deadline'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const players = sqliteTable('players', {
  id: text('id').primaryKey(), userId: text('user_id'), roomCode: text('room_code').notNull(), name: text('name').notNull(), isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false), score: integer('score').notNull().default(0), lives: integer('lives').notNull().default(3), joinedAt: integer('joined_at').notNull(), lastSeenAt: integer('last_seen_at').notNull(),
}, (table) => [index('idx_players_room_code').on(table.roomCode)]);

export const moves = sqliteTable('moves', {
  id: text('id').primaryKey(), roomCode: text('room_code').notNull(), playerId: text('player_id').notNull(), word: text('word').notNull(), valid: integer('valid', { mode: 'boolean' }).notNull(), createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_moves_room_created').on(table.roomCode, table.createdAt)]);

export const leaderboard = sqliteTable('leaderboard', {
  playerName: text('player_name').primaryKey(),
  wins: integer('wins').notNull().default(0),
  bestScore: integer('best_score').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const leaderboardEntries = sqliteTable('leaderboard_entries', {
  userId: text('user_id').primaryKey(),
  playerName: text('player_name').notNull(),
  wins: integer('wins').notNull().default(0),
  bestScore: integer('best_score').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const wordCache = sqliteTable('word_cache', {
  category: text('category').notNull(),
  word: text('word').notNull(),
  verdict: text('verdict').notNull(),
  source: text('source').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('uq_word_cache_category_word').on(table.category, table.word)]);
