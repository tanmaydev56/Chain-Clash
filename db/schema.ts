import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  hostPlayerId: text('host_player_id').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull().default('waiting'),
  currentLetter: text('current_letter').notNull().default('t'),
  turnPlayerId: text('turn_player_id'),
  winnerPlayerId: text('winner_player_id'),
  mode: text('mode').notNull().default('classic'),
  blockedLetter: text('blocked_letter'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  turnDeadline: integer('turn_deadline'),
  challengeKey: text('challenge_key'),
  statsRecorded: integer('stats_recorded', { mode: 'boolean' }).notNull().default(false),
  stateVersion: integer('state_version').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const players = sqliteTable('players', {
  id: text('id').primaryKey(), userId: text('user_id'), roomCode: text('room_code').notNull(), name: text('name').notNull(), isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false), score: integer('score').notNull().default(0), lives: integer('lives').notNull().default(3), shield: integer('shield', { mode: 'boolean' }).notNull().default(false), joinedAt: integer('joined_at').notNull(), lastSeenAt: integer('last_seen_at').notNull(),
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
  googleSubject: text('google_subject'),
  googleEmail: text('google_email'),
  linkedAt: integer('linked_at'),
  avatar: text('avatar'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('uq_users_google_subject').on(table.googleSubject)]);

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

export const playerStats = sqliteTable('player_stats', {
  userId: text('user_id').primaryKey(),
  gamesPlayed: integer('games_played').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  bestScore: integer('best_score').notNull().default(0),
  totalScore: integer('total_score').notNull().default(0),
  xp: integer('xp').notNull().default(0),
  mmr: integer('mmr').notNull().default(1000),
  coins: integer('coins').notNull().default(0),
  dailyStreak: integer('daily_streak').notNull().default(0),
  lastDailyKey: text('last_daily_key'),
  updatedAt: integer('updated_at').notNull(),
});

export const guestSessions = sqliteTable('guest_sessions', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), expiresAt: integer('expires_at').notNull(), revokedAt: integer('revoked_at'), createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_guest_sessions_user').on(table.userId, table.expiresAt)]);

export const oauthStates = sqliteTable('oauth_states', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_oauth_states_expiry').on(table.expiresAt)]);

export const weeklyLeaderboard = sqliteTable('weekly_leaderboard', {
  userId: text('user_id').notNull(),
  weekKey: text('week_key').notNull(),
  playerName: text('player_name').notNull(),
  wins: integer('wins').notNull().default(0),
  bestScore: integer('best_score').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('uq_weekly_leaderboard_user_week').on(table.userId, table.weekKey), index('idx_weekly_leaderboard_week').on(table.weekKey, table.wins, table.bestScore)]);

export const dailyAttempts = sqliteTable('daily_attempts', {
  userId: text('user_id').notNull(),
  challengeKey: text('challenge_key').notNull(),
  score: integer('score').notNull(),
  won: integer('won', { mode: 'boolean' }).notNull(),
  completedAt: integer('completed_at').notNull(),
}, (table) => [uniqueIndex('uq_daily_attempt_user_challenge').on(table.userId, table.challengeKey)]);

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  roomCode: text('room_code').notNull(),
  reporterUserId: text('reporter_user_id').notNull(),
  reportedPlayerId: text('reported_player_id'),
  reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_reports_room_created').on(table.roomCode, table.createdAt)]);
