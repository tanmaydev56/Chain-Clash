import { getGameDb } from '@/lib/game-db';
import { categories, getWords, isBlockedWord, isPlausibleCategoryWord, isValidWord, normalizeWord, type Category } from '@/lib/game-data';

type RoomRow = { code: string; host_player_id: string; category: Category; status: 'waiting' | 'active' | 'finished'; current_letter: string; turn_player_id: string | null; winner_player_id: string | null; turn_deadline: number | null; created_at: number; updated_at: number };
type PlayerRow = { id: string; user_id: string | null; room_code: string; name: string; is_bot: number; score: number; lives: number; joined_at: number };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const turnMs = 12_000;
const botNames = ['WordBot', 'Lime Lynx', 'Coral Crow', 'Turbo Tapir', 'Neon Narwhal'];

function json(data: unknown, status = 200) { return Response.json(data, { status }); }
function cleanName(value: unknown) { return String(value ?? '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Player'; }
function stableUserId(value: unknown) { const id = String(value ?? ''); return /^[a-f0-9-]{36}$/i.test(id) ? id : crypto.randomUUID(); }

async function createCode(db: D1Database) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    if (!await db.prepare('SELECT code FROM rooms WHERE code = ?').bind(code).first()) return code;
  }
  throw new Error('Could not create a room code.');
}

async function upsertUser(db: D1Database, userId: string, name: string, now: number) {
  await db.prepare(`INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`).bind(userId, name, now, now).run();
}

async function readRoom(db: D1Database, code: string) { return db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first<RoomRow>(); }
async function readPlayers(db: D1Database, code: string) { return db.prepare('SELECT * FROM players WHERE room_code = ? ORDER BY joined_at ASC').bind(code).all<PlayerRow>(); }

function nextAlive(players: PlayerRow[], currentId: string, currentLives: number) {
  const alive = players.filter((player) => player.id === currentId ? currentLives > 0 : player.lives > 0);
  const currentIndex = alive.findIndex((player) => player.id === currentId);
  return { alive, next: alive.length ? alive[(currentIndex >= 0 ? currentIndex + 1 : 0) % alive.length] : null };
}

async function advance(db: D1Database, room: RoomRow, players: PlayerRow[], currentId: string, currentLives: number, now: number, nextLetter = room.current_letter) {
  const { alive, next } = nextAlive(players, currentId, currentLives);
  const finished = players.length > 1 && alive.length === 1;
  const winner = finished ? alive[0] : null;
  await db.prepare(`UPDATE rooms SET status = ?, current_letter = ?, turn_player_id = ?, winner_player_id = ?, turn_deadline = ?, updated_at = ? WHERE code = ?`).bind(
    finished ? 'finished' : 'active', nextLetter, finished ? null : next?.id ?? null, winner?.id ?? null, finished ? null : now + turnMs, now, room.code,
  ).run();
  if (winner?.user_id) {
    await db.prepare(`INSERT INTO leaderboard_entries (user_id, player_name, wins, best_score, updated_at) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET player_name = excluded.player_name, wins = wins + 1, best_score = MAX(best_score, excluded.best_score), updated_at = excluded.updated_at`).bind(winner.user_id, winner.name, winner.score, now).run();
  }
}

async function cacheVerdict(db: D1Database, category: Category, word: string, verdict: string, source: string, now: number) {
  await db.prepare(`INSERT INTO word_cache (category, word, verdict, source, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, word) DO UPDATE SET verdict = excluded.verdict, source = excluded.source, updated_at = excluded.updated_at`).bind(category, word, verdict, source, now).run();
}

async function validateWord(db: D1Database, category: Category, word: string, now: number) {
  if (!word || isBlockedWord(word)) return { valid: false, source: 'blocked' };
  const cached = await db.prepare('SELECT verdict, source FROM word_cache WHERE category = ? AND word = ?').bind(category, word).first<{ verdict: string; source: string }>();
  if (cached) return { valid: cached.verdict !== 'rejected', source: cached.source };
  if (isValidWord(category, word)) { await cacheVerdict(db, category, word, 'accepted', 'curated', now); return { valid: true, source: 'curated' }; }
  if (isPlausibleCategoryWord(word)) { await cacheVerdict(db, category, word, 'provisional', 'community', now); return { valid: true, source: 'community' }; }
  await cacheVerdict(db, category, word, 'rejected', 'format', now);
  return { valid: false, source: 'format' };
}

async function settleRoom(db: D1Database, code: string, now: number) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await readRoom(db, code);
    if (!room || room.status !== 'active' || !room.turn_player_id) return;
    const players = (await readPlayers(db, code)).results;
    const current = players.find((player) => player.id === room.turn_player_id);
    if (!current) return;
    if (room.turn_deadline && now >= room.turn_deadline) {
      const lives = Math.max(0, current.lives - 1);
      await db.batch([
        db.prepare('UPDATE players SET lives = ?, last_seen_at = ? WHERE id = ?').bind(lives, now, current.id),
        db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(crypto.randomUUID(), code, current.id, 'timeout', now),
      ]);
      await advance(db, room, players, current.id, lives, now);
      continue;
    }
    if (!current.is_bot) return;
    const used = (await db.prepare('SELECT word FROM moves WHERE room_code = ? AND valid = 1').bind(code).all<{ word: string }>()).results.map((row) => row.word);
    const options = getWords(room.category, room.current_letter, used);
    if (!options.length) {
      const lives = Math.max(0, current.lives - 1);
      await db.batch([
        db.prepare('UPDATE players SET lives = ?, last_seen_at = ? WHERE id = ?').bind(lives, now, current.id),
        db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(crypto.randomUUID(), code, current.id, 'no-word', now),
      ]);
      await advance(db, room, players, current.id, lives, now);
      continue;
    }
    const word = options[Math.floor(Math.random() * options.length)];
    const score = current.score + word.length * 10;
    await db.batch([
      db.prepare('UPDATE players SET score = ?, last_seen_at = ? WHERE id = ?').bind(score, now, current.id),
      db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(crypto.randomUUID(), code, current.id, word, now),
    ]);
    const adjusted = players.map((player) => player.id === current.id ? { ...player, score } : player);
    await advance(db, room, adjusted, current.id, current.lives, now, word.at(-1));
  }
}

async function roomState(db: D1Database, code: string, now: number) {
  await settleRoom(db, code, now);
  const room = await readRoom(db, code);
  if (!room) return null;
  const players = await db.prepare('SELECT id, user_id, room_code, name, is_bot, score, lives, joined_at FROM players WHERE room_code = ? ORDER BY joined_at ASC').bind(code).all<PlayerRow>();
  const moves = await db.prepare(`SELECT moves.id, moves.word, moves.valid, moves.created_at, players.name AS player_name, players.is_bot
    FROM moves JOIN players ON players.id = moves.player_id WHERE moves.room_code = ? ORDER BY moves.created_at DESC LIMIT 12`).bind(code).all();
  return { room, players: players.results, moves: moves.results };
}

function botInsert(db: D1Database, code: string, index: number, now: number) {
  return db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at)
    VALUES (?, NULL, ?, ?, 1, 0, 3, ?, ?)`).bind(crypto.randomUUID(), code, botNames[index % botNames.length], now + index, now);
}

export async function GET(request: Request) {
  try {
    const db = await getGameDb(); const url = new URL(request.url); const now = Date.now();
    if (url.searchParams.get('leaderboard') === '1') {
      const rows = await db.prepare('SELECT player_name, wins, best_score FROM leaderboard_entries ORDER BY wins DESC, best_score DESC LIMIT 10').all();
      return json({ leaderboard: rows.results });
    }
    const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();
    if (!code) return json({ error: 'Room code is required.' }, 400);
    const state = await roomState(db, code, now); return state ? json(state) : json({ error: 'Room not found.' }, 404);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? ''); const db = await getGameDb(); const now = Date.now();
    if (action === 'create' || action === 'quick') {
      const name = cleanName(body.name); const userId = stableUserId(body.userId); const category = String(body.category ?? 'animals') as Category;
      if (!(category in categories)) return json({ error: 'Invalid category.' }, 400);
      const code = await createCode(db); const playerId = crypto.randomUUID(); const botCount = action === 'quick' ? 1 : Math.max(0, Math.min(3, Number(body.botCount ?? 0)));
      await upsertUser(db, userId, name, now);
      const inserts = [
        db.prepare(`INSERT INTO rooms (code, host_player_id, category, status, current_letter, turn_player_id, turn_deadline, created_at, updated_at) VALUES (?, ?, ?, ?, 't', ?, ?, ?, ?)`).bind(code, playerId, category, botCount ? 'active' : 'waiting', playerId, botCount ? now + turnMs : null, now, now),
        db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at) VALUES (?, ?, ?, ?, 0, 0, 3, ?, ?)`).bind(playerId, userId, code, name, now, now),
        ...Array.from({ length: botCount }, (_, index) => botInsert(db, code, index, now)),
      ];
      await db.batch(inserts); return json({ code, playerId, userId, state: await roomState(db, code, now) }, 201);
    }
    if (action === 'join') {
      const code = String(body.code ?? '').trim().toUpperCase(); const room = await readRoom(db, code);
      if (!room) return json({ error: 'That room does not exist.' }, 404); if (room.status === 'finished') return json({ error: 'That match has finished.' }, 409);
      const players = (await readPlayers(db, code)).results; if (players.length >= 6) return json({ error: 'That room is full.' }, 409);
      const name = cleanName(body.name); const userId = stableUserId(body.userId); const playerId = crypto.randomUUID(); await upsertUser(db, userId, name, now);
      await db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at) VALUES (?, ?, ?, ?, 0, 0, 3, ?, ?)`).bind(playerId, userId, code, name, now, now).run();
      if (room.status === 'waiting') await db.prepare(`UPDATE rooms SET status = 'active', turn_player_id = host_player_id, turn_deadline = ?, updated_at = ? WHERE code = ?`).bind(now + turnMs, now, code).run();
      return json({ code, playerId, userId, state: await roomState(db, code, now) });
    }
    if (action === 'add_bot') {
      const code = String(body.code ?? '').trim().toUpperCase(); const playerId = String(body.playerId ?? ''); const room = await readRoom(db, code);
      if (!room || room.host_player_id !== playerId || room.status === 'finished') return json({ error: 'Only the host can add a bot.' }, 403);
      const players = (await readPlayers(db, code)).results; if (players.length >= 6) return json({ error: 'That room is full.' }, 409);
      await botInsert(db, code, players.filter((player) => player.is_bot).length, now).run();
      if (room.status === 'waiting') await db.prepare(`UPDATE rooms SET status = 'active', turn_player_id = host_player_id, turn_deadline = ?, updated_at = ? WHERE code = ?`).bind(now + turnMs, now, code).run();
      return json({ state: await roomState(db, code, now) });
    }
    if (action === 'submit') {
      const code = String(body.code ?? '').trim().toUpperCase(); const playerId = String(body.playerId ?? ''); const word = normalizeWord(String(body.word ?? ''));
      await settleRoom(db, code, now); const room = await readRoom(db, code);
      if (!room || room.status !== 'active') return json({ error: 'This match is not active.' }, 409); if (room.turn_player_id !== playerId) return json({ error: 'Wait for your turn.' }, 409);
      const player = await db.prepare('SELECT * FROM players WHERE id = ? AND room_code = ?').bind(playerId, code).first<PlayerRow>();
      if (!player || player.lives < 1 || player.is_bot) return json({ error: 'Player is not active.' }, 403);
      const used = new Set((await db.prepare('SELECT word FROM moves WHERE room_code = ? AND valid = 1').bind(code).all<{ word: string }>()).results.map((row) => row.word));
      const check = word.startsWith(room.current_letter) && !used.has(word) ? await validateWord(db, room.category, word, now) : { valid: false, source: 'rule' };
      const lives = check.valid ? player.lives : Math.max(0, player.lives - 1); const score = player.score + (check.valid ? word.length * 10 : 0); const players = (await readPlayers(db, code)).results;
      await db.batch([
        db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), code, playerId, word || '—', check.valid ? 1 : 0, now),
        db.prepare('UPDATE players SET score = ?, lives = ?, last_seen_at = ? WHERE id = ?').bind(score, lives, now, playerId),
      ]);
      const adjusted = players.map((item) => item.id === playerId ? { ...item, score, lives } : item);
      await advance(db, room, adjusted, playerId, lives, now, check.valid ? word.at(-1) : room.current_letter);
      return json({ valid: check.valid, source: check.source, state: await roomState(db, code, now) });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500); }
}
