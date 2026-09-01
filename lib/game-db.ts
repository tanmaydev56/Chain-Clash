import { env } from 'cloudflare:workers';

let ready = false;

export async function getGameDb() {
  const db = env.DB;
  if (!db) throw new Error('Game database is unavailable.');
  if (!ready) {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        host_player_id TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        current_letter TEXT NOT NULL DEFAULT 't',
        turn_player_id TEXT,
        winner_player_id TEXT,
        is_public INTEGER NOT NULL DEFAULT 0,
        turn_deadline INTEGER,
        challenge_key TEXT,
        stats_recorded INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        room_code TEXT NOT NULL,
        name TEXT NOT NULL,
        is_bot INTEGER NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0,
        lives INTEGER NOT NULL DEFAULT 3,
        joined_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS moves (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        word TEXT NOT NULL,
        valid INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS leaderboard (
        player_name TEXT PRIMARY KEY,
        wins INTEGER NOT NULL DEFAULT 0,
        best_score INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_entries (
        user_id TEXT PRIMARY KEY,
        player_name TEXT NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        best_score INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS word_cache (
        category TEXT NOT NULL,
        word TEXT NOT NULL,
        verdict TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (category, word)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS player_stats (
        user_id TEXT PRIMARY KEY,
        games_played INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        best_score INTEGER NOT NULL DEFAULT 0,
        total_score INTEGER NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0,
        daily_streak INTEGER NOT NULL DEFAULT 0,
        last_daily_key TEXT,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS daily_attempts (
        user_id TEXT NOT NULL,
        challenge_key TEXT NOT NULL,
        score INTEGER NOT NULL,
        won INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, challenge_key)
      )`),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_players_room_code ON players(room_code)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_moves_room_created ON moves(room_code, created_at)'),
    ]);
    await Promise.all([
      db.prepare('ALTER TABLE rooms ADD COLUMN turn_deadline INTEGER').run().catch(() => undefined),
      db.prepare('ALTER TABLE rooms ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0').run().catch(() => undefined),
      db.prepare('ALTER TABLE rooms ADD COLUMN challenge_key TEXT').run().catch(() => undefined),
      db.prepare('ALTER TABLE rooms ADD COLUMN stats_recorded INTEGER NOT NULL DEFAULT 0').run().catch(() => undefined),
      db.prepare('ALTER TABLE players ADD COLUMN user_id TEXT').run().catch(() => undefined),
      db.prepare('ALTER TABLE players ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0').run().catch(() => undefined),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_rooms_challenge_key ON rooms(challenge_key)').run().catch(() => undefined),
    ]);
    await db.prepare('PRAGMA optimize').run();
    ready = true;
  }
  return db;
}
