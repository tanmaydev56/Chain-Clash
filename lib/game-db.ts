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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        name TEXT NOT NULL,
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
      db.prepare('CREATE INDEX IF NOT EXISTS idx_players_room_code ON players(room_code)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_moves_room_created ON moves(room_code, created_at)'),
    ]);
    await db.prepare('PRAGMA optimize').run();
    ready = true;
  }
  return db;
}
