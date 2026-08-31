import { getGameDb } from '@/lib/game-db';
import { categories, isValidWord, normalizeWord, type Category } from '@/lib/game-data';

type RoomRow = {
  code: string;
  host_player_id: string;
  category: Category;
  status: 'waiting' | 'active' | 'finished';
  current_letter: string;
  turn_player_id: string | null;
  winner_player_id: string | null;
  created_at: number;
  updated_at: number;
};

type PlayerRow = {
  id: string;
  room_code: string;
  name: string;
  score: number;
  lives: number;
  joined_at: number;
};

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function cleanName(value: unknown) {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Player';
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function createCode(db: D1Database) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    const found = await db.prepare('SELECT code FROM rooms WHERE code = ?').bind(code).first();
    if (!found) return code;
  }
  throw new Error('Could not create a room code.');
}

async function roomState(db: D1Database, code: string) {
  const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first<RoomRow>();
  if (!room) return null;
  const players = await db.prepare('SELECT id, room_code, name, score, lives, joined_at FROM players WHERE room_code = ? ORDER BY joined_at ASC').bind(code).all<PlayerRow>();
  const moves = await db.prepare(`SELECT moves.id, moves.word, moves.valid, moves.created_at, players.name AS player_name
    FROM moves JOIN players ON players.id = moves.player_id
    WHERE moves.room_code = ? ORDER BY moves.created_at DESC LIMIT 8`).bind(code).all();
  return { room, players: players.results, moves: moves.results };
}

export async function GET(request: Request) {
  try {
    const db = await getGameDb();
    const url = new URL(request.url);
    if (url.searchParams.get('leaderboard') === '1') {
      const rows = await db.prepare('SELECT player_name, wins, best_score FROM leaderboard ORDER BY wins DESC, best_score DESC LIMIT 10').all();
      return json({ leaderboard: rows.results });
    }
    const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();
    if (!code) return json({ error: 'Room code is required.' }, 400);
    const state = await roomState(db, code);
    return state ? json(state) : json({ error: 'Room not found.' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const db = await getGameDb();
    const now = Date.now();

    if (action === 'create') {
      const name = cleanName(body.name);
      const category = String(body.category ?? 'animals') as Category;
      if (!(category in categories)) return json({ error: 'Invalid category.' }, 400);
      const code = await createCode(db);
      const playerId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO rooms (code, host_player_id, category, status, current_letter, turn_player_id, created_at, updated_at)
          VALUES (?, ?, ?, 'waiting', 't', ?, ?, ?)`).bind(code, playerId, category, playerId, now, now),
        db.prepare(`INSERT INTO players (id, room_code, name, score, lives, joined_at, last_seen_at)
          VALUES (?, ?, ?, 0, 3, ?, ?)`).bind(playerId, code, name, now, now),
      ]);
      return json({ code, playerId, state: await roomState(db, code) }, 201);
    }

    if (action === 'join') {
      const code = String(body.code ?? '').trim().toUpperCase();
      const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first<RoomRow>();
      if (!room) return json({ error: 'That room does not exist.' }, 404);
      if (room.status === 'finished') return json({ error: 'That match has finished.' }, 409);
      const count = await db.prepare('SELECT COUNT(*) AS total FROM players WHERE room_code = ?').bind(code).first<{ total: number }>();
      if ((count?.total ?? 0) >= 6) return json({ error: 'That room is full.' }, 409);
      const playerId = crypto.randomUUID();
      await db.prepare(`INSERT INTO players (id, room_code, name, score, lives, joined_at, last_seen_at)
        VALUES (?, ?, ?, 0, 3, ?, ?)`).bind(playerId, code, cleanName(body.name), now, now).run();
      if ((count?.total ?? 0) >= 1 && room.status === 'waiting') {
        await db.prepare(`UPDATE rooms SET status = 'active', turn_player_id = host_player_id, updated_at = ? WHERE code = ?`).bind(now, code).run();
      }
      return json({ code, playerId, state: await roomState(db, code) });
    }

    if (action === 'submit') {
      const code = String(body.code ?? '').trim().toUpperCase();
      const playerId = String(body.playerId ?? '');
      const word = normalizeWord(String(body.word ?? ''));
      const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first<RoomRow>();
      if (!room || room.status !== 'active') return json({ error: 'This match is not active.' }, 409);
      if (room.turn_player_id !== playerId) return json({ error: 'Wait for your turn.' }, 409);
      const player = await db.prepare('SELECT * FROM players WHERE id = ? AND room_code = ?').bind(playerId, code).first<PlayerRow>();
      if (!player || player.lives < 1) return json({ error: 'Player is not active.' }, 403);
      const usedRows = await db.prepare('SELECT word FROM moves WHERE room_code = ? AND valid = 1').bind(code).all<{ word: string }>();
      const used = new Set(usedRows.results.map((row) => row.word));
      const valid = word.length > 1 && word.startsWith(room.current_letter) && !used.has(word) && isValidWord(room.category, word);
      const nextLives = valid ? player.lives : Math.max(0, player.lives - 1);
      const nextScore = player.score + (valid ? word.length * 10 : 0);
      const playersResult = await db.prepare('SELECT * FROM players WHERE room_code = ? ORDER BY joined_at ASC').bind(code).all<PlayerRow>();
      const alive = playersResult.results.filter((item) => item.id !== playerId ? item.lives > 0 : nextLives > 0);
      const currentIndex = alive.findIndex((item) => item.id === playerId);
      const nextPlayer = alive.length ? alive[(currentIndex >= 0 ? currentIndex + 1 : 0) % alive.length] : null;
      const finished = playersResult.results.length > 1 && alive.length === 1;
      const winner = finished ? alive[0] : null;
      const statements = [
        db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), code, playerId, word || '—', valid ? 1 : 0, now),
        db.prepare('UPDATE players SET score = ?, lives = ?, last_seen_at = ? WHERE id = ?').bind(nextScore, nextLives, now, playerId),
        db.prepare(`UPDATE rooms SET status = ?, current_letter = ?, turn_player_id = ?, winner_player_id = ?, updated_at = ? WHERE code = ?`).bind(finished ? 'finished' : 'active', valid ? word.at(-1) : room.current_letter, finished ? null : nextPlayer?.id ?? null, winner?.id ?? null, now, code),
      ];
      if (winner) {
        statements.push(db.prepare(`INSERT INTO leaderboard (player_name, wins, best_score, updated_at) VALUES (?, 1, ?, ?)
          ON CONFLICT(player_name) DO UPDATE SET wins = wins + 1, best_score = MAX(best_score, excluded.best_score), updated_at = excluded.updated_at`).bind(winner.name, winner.score, now));
      }
      await db.batch(statements);
      return json({ valid, state: await roomState(db, code) });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500);
  }
}
