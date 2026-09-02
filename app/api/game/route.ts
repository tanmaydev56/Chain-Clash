import { env } from 'cloudflare:workers';
import { getGameDb } from '@/lib/game-db';
import { categories, getWords, normalizeWord, type Category } from '@/lib/game-data';
import { d1WordCache, validateCategoryWord } from '@/lib/word-validation';
import { clearGuestSession, issueGuestSession, requireGuest } from '@/lib/game-session';
import { claimRoomTurn, isHostActionAuthorized } from '@/lib/game-state';
import { createRealtimeTicket } from '@/lib/realtime-ticket';
import { cleanDisplayName } from '@/lib/user-input';
import { categoryForWord, getMode, levelForXp, scoreForWord, turnSecondsForWord } from '@/lib/game-modes';
import { applyPowerUp, powerUpCost, type PowerUpState } from '@/lib/power-ups';

type RoomRow = { code: string; host_player_id: string; category: Category; status: 'waiting' | 'active' | 'finished'; current_letter: string; turn_player_id: string | null; winner_player_id: string | null; mode: string; blocked_letter: string | null; freeze_next: number; turn_direction: number; is_public: number; turn_deadline: number | null; challenge_key: string | null; stats_recorded: number; state_version: number; created_at: number; updated_at: number };
type PlayerRow = { id: string; user_id: string | null; room_code: string; name: string; is_bot: number; score: number; lives: number; shield: number; joined_at: number };
type PlayerStatsRow = { games_played: number; wins: number; losses: number; best_score: number; total_score: number; xp: number; mmr: number; coins: number; daily_streak: number; last_daily_key: string | null };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const botNames = ['WordBot', 'Lime Lynx', 'Coral Crow', 'Turbo Tapir', 'Neon Narwhal'];
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function json(data: unknown, status = 200) { return Response.json(data, { status }); }
function stringValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function utcDay(now: number) { return new Date(now).toISOString().slice(0, 10); }
function previousUtcDay(day: string) { return new Date(`${day}T00:00:00.000Z`).getTime() - 86_400_000; }
function dailyCategory(day: string): Category { return (Object.keys(categories) as Category[])[Number(day.replaceAll('-', '')) % Object.keys(categories).length]; }
function weekKey(now: number) { const date = new Date(now); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return date.toISOString().slice(0, 10); }
function requestIp(request: Request) { return request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'; }
function allowRequest(request: Request, action: string, now: number, limit: number, windowMs: number) {
  const key = `${action}:${requestIp(request)}`; const current = rateBuckets.get(key);
  if (!current || now >= current.resetAt) { rateBuckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (current.count >= limit) return false;
  current.count += 1; return true;
}

async function createCode(db: D1Database) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    if (!await db.prepare('SELECT code FROM rooms WHERE code = ?').bind(code).first()) return code;
  }
  throw new Error('Could not create a room code.');
}

async function readRoom(db: D1Database, code: string) { return db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first<RoomRow>(); }
async function readPlayers(db: D1Database, code: string) { return db.prepare('SELECT * FROM players WHERE room_code = ? ORDER BY joined_at ASC').bind(code).all<PlayerRow>(); }

function nextAlive(players: PlayerRow[], currentId: string, currentLives: number, direction = 1) {
  const alive = players.filter((player) => player.id === currentId ? currentLives > 0 : player.lives > 0);
  const currentIndex = alive.findIndex((player) => player.id === currentId);
  return { alive, next: alive.length ? alive[(currentIndex >= 0 ? currentIndex + direction + alive.length : 0) % alive.length] : null };
}

async function advance(db: D1Database, room: RoomRow, players: PlayerRow[], currentId: string, currentLives: number, now: number, nextLetter = room.current_letter, wordCount = 0) {
  const { alive, next } = nextAlive(players, currentId, currentLives, room.turn_direction || 1);
  const finished = players.length > 1 && alive.length === 1;
  const winner = finished ? alive[0] : null;
  const mode = getMode(room.mode); const category = categoryForWord(mode, Object.keys(categories) as Category[], wordCount);
  await db.prepare(`UPDATE rooms SET status = ?, category = ?, current_letter = ?, turn_player_id = ?, winner_player_id = ?, turn_deadline = ?, updated_at = ? WHERE code = ?`).bind(
    finished ? 'finished' : 'active', category, nextLetter, finished ? null : next?.id ?? null, winner?.id ?? null, finished ? null : now + turnSecondsForWord(mode, wordCount) * 1000 * (room.freeze_next ? 0.5 : 1), now, room.code,
  ).run();
  if (room.freeze_next) await db.prepare('UPDATE rooms SET freeze_next = 0 WHERE code = ?').bind(room.code).run();
  if (finished) await recordFinishedRoom(db, room, players, winner, now);
}

async function recordFinishedRoom(db: D1Database, room: RoomRow, players: PlayerRow[], winner: PlayerRow | null, now: number) {
  const statements: D1PreparedStatement[] = [];
  if (winner?.user_id) {
    statements.push(
      db.prepare(`INSERT INTO leaderboard_entries (user_id, player_name, wins, best_score, updated_at)
        SELECT ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND stats_recorded = 0)
        ON CONFLICT(user_id) DO UPDATE SET player_name = excluded.player_name, wins = wins + 1, best_score = MAX(best_score, excluded.best_score), updated_at = excluded.updated_at`).bind(winner.user_id, winner.name, winner.score, now, room.code),
      db.prepare(`INSERT INTO weekly_leaderboard (user_id, week_key, player_name, wins, best_score, updated_at)
        SELECT ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND stats_recorded = 0)
        ON CONFLICT(user_id, week_key) DO UPDATE SET player_name = excluded.player_name, wins = wins + 1, best_score = MAX(best_score, excluded.best_score), updated_at = excluded.updated_at`).bind(winner.user_id, weekKey(now), winner.name, winner.score, now, room.code),
    );
  }
  const humans = players.filter((player) => player.user_id && !player.is_bot);
  for (const player of humans) {
    const won = player.id === winner?.id ? 1 : 0;
    const earnedXp = player.score + (won ? 100 : 25); const earnedCoins = Math.floor(player.score / 10) + (won ? 10 : 0);
    statements.push(db.prepare(`INSERT INTO player_stats (user_id, games_played, wins, losses, best_score, total_score, xp, coins, updated_at)
      SELECT ?, 1, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND stats_recorded = 0)
      ON CONFLICT(user_id) DO UPDATE SET
        games_played = games_played + 1, wins = wins + excluded.wins, losses = losses + excluded.losses,
        best_score = MAX(best_score, excluded.best_score), total_score = total_score + excluded.total_score,
        xp = xp + excluded.xp, coins = coins + excluded.coins, mmr = MAX(100, mmr + ?), updated_at = excluded.updated_at`).bind(player.user_id, won, won ? 0 : 1, player.score, player.score, earnedXp, earnedCoins, now, room.code, won ? 25 : -20));
    statements.push(db.prepare(`INSERT INTO match_history (id, user_id, room_code, mode, category, score, won, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND stats_recorded = 0)`).bind(crypto.randomUUID(), player.user_id, room.code, getMode(room.mode).id, room.category, player.score, won, now, room.code));
    if (room.challenge_key) {
      const yesterday = new Date(previousUtcDay(room.challenge_key)).toISOString().slice(0, 10);
      statements.push(db.prepare(`INSERT OR IGNORE INTO daily_attempts (user_id, challenge_key, score, won, completed_at)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND stats_recorded = 0)`)
        .bind(player.user_id, room.challenge_key, player.score, won, now, room.code));
      statements.push(db.prepare(`UPDATE player_stats SET
        daily_streak = CASE WHEN last_daily_key = ? THEN daily_streak WHEN last_daily_key = ? THEN daily_streak + 1 ELSE 1 END,
        last_daily_key = ?, updated_at = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND stats_recorded = 0)`).bind(room.challenge_key, yesterday, room.challenge_key, now, player.user_id, room.code));
    }
  }
  statements.push(db.prepare('UPDATE rooms SET stats_recorded = 1 WHERE code = ? AND stats_recorded = 0').bind(room.code));
  await db.batch(statements);
}

// Layered validation: pre-checks + seed list (instant) → word_cache (one D1
// read) → AI judge (one call, then cached forever). Set the OPENAI_API_KEY
// Worker secret to enable the AI layer — without it, only the curated seed
// words are accepted. See CODEX-BRIEF.md → Feature 1.
async function validateWord(db: D1Database, category: Category, rawWord: string, now: number) {
  const result = await validateCategoryWord(category, rawWord, {
    cache: d1WordCache(db, () => now),
    aiKey: (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY ?? null,
    fallbackAccept: false,
  });
  return { valid: result.valid, source: result.source };
}

async function settleRoom(db: D1Database, code: string, now: number) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await readRoom(db, code);
    if (!room || room.status !== 'active' || !room.turn_player_id) return;
    const players = (await readPlayers(db, code)).results;
    const current = players.find((player) => player.id === room.turn_player_id);
    if (!current) return;
    if (room.turn_deadline && now >= room.turn_deadline) {
      if (!await claimRoomTurn(db, { code, playerId: current.id, stateVersion: room.state_version, now })) continue;
      const lives = Math.max(0, current.lives - 1);
      await db.batch([
        db.prepare('UPDATE players SET lives = ?, last_seen_at = ? WHERE id = ?').bind(lives, now, current.id),
        db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(crypto.randomUUID(), code, current.id, 'timeout', now),
      ]);
      const used = (await db.prepare('SELECT word FROM moves WHERE room_code = ? AND valid = 1').bind(code).all<{ word: string }>()).results;
      await advance(db, room, players, current.id, lives, now, room.current_letter, used.length);
      continue;
    }
    if (!current.is_bot) return;
    if (!await claimRoomTurn(db, { code, playerId: current.id, stateVersion: room.state_version, now })) continue;
    const used = (await db.prepare('SELECT word FROM moves WHERE room_code = ? AND valid = 1').bind(code).all<{ word: string }>()).results.map((row) => row.word);
    const options = getWords(room.category, room.current_letter, used);
    if (!options.length) {
      const lives = Math.max(0, current.lives - 1);
      await db.batch([
        db.prepare('UPDATE players SET lives = ?, last_seen_at = ? WHERE id = ?').bind(lives, now, current.id),
        db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(crypto.randomUUID(), code, current.id, 'no-word', now),
      ]);
      await advance(db, room, players, current.id, lives, now, room.current_letter, used.length);
      continue;
    }
    const word = options[Math.floor(Math.random() * options.length)];
    const score = current.score + scoreForWord(room.mode, word, Math.max(0, ((room.turn_deadline ?? now) - now) / 1000));
    await db.batch([
      db.prepare('UPDATE players SET score = ?, last_seen_at = ? WHERE id = ?').bind(score, now, current.id),
      db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(crypto.randomUUID(), code, current.id, word, now),
    ]);
    const adjusted = players.map((player) => player.id === current.id ? { ...player, score } : player);
    await advance(db, room, adjusted, current.id, current.lives, now, word.at(-1), used.length + 1);
  }
}

async function roomState(db: D1Database, code: string, now: number) {
  await settleRoom(db, code, now);
  const room = await readRoom(db, code);
  if (!room) return null;
  const players = await db.prepare('SELECT id, user_id, room_code, name, is_bot, score, lives, joined_at FROM players WHERE room_code = ? ORDER BY joined_at ASC').bind(code).all<PlayerRow>();
  const moves = await db.prepare(`SELECT moves.id, moves.word, moves.valid, moves.created_at, players.name AS player_name, players.is_bot
    FROM moves JOIN players ON players.id = moves.player_id WHERE moves.room_code = ? ORDER BY moves.created_at DESC LIMIT 12`).bind(code).all();
  return { room: { ...room, host_player_id: undefined }, players: players.results.map(({ user_id: _userId, ...player }) => player), moves: moves.results };
}

function botInsert(db: D1Database, code: string, index: number, now: number, lives = 3) {
  return db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at)
    VALUES (?, NULL, ?, ?, 1, 0, ?, ?, ?)`).bind(crypto.randomUUID(), code, botNames[index % botNames.length], lives, now + index, now);
}

export async function GET(request: Request) {
  try {
    const db = await getGameDb(); const url = new URL(request.url); const now = Date.now();
    if (url.searchParams.get('leaderboard') === '1') {
      const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'week'; const page = Math.max(0, Math.min(100, Number(url.searchParams.get('page') ?? 0) || 0));
      const rows = scope === 'all'
        ? await db.prepare('SELECT player_name, wins, best_score FROM leaderboard_entries ORDER BY wins DESC, best_score DESC LIMIT 20 OFFSET ?').bind(page * 20).all()
        : await db.prepare('SELECT player_name, wins, best_score FROM weekly_leaderboard WHERE week_key = ? ORDER BY wins DESC, best_score DESC LIMIT 20 OFFSET ?').bind(weekKey(now), page * 20).all();
      return json({ leaderboard: rows.results, scope, page });
    }
    if (url.searchParams.get('profile') === '1') {
      const { userId } = await requireGuest(db, request, now);
      const stats = await db.prepare('SELECT games_played, wins, losses, best_score, total_score, xp, mmr, daily_streak, last_daily_key FROM player_stats WHERE user_id = ?').bind(userId).first<PlayerStatsRow>();
      const user = await db.prepare('SELECT display_name, google_subject, avatar FROM users WHERE id = ?').bind(userId).first<{ display_name: string; google_subject: string | null; avatar: string | null }>();
      const xp = stats?.xp ?? 0;
      return json({ name: user?.display_name ?? 'Player', avatar: user?.avatar ?? null, googleLinked: Boolean(user?.google_subject), stats: { gamesPlayed: stats?.games_played ?? 0, wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, bestScore: stats?.best_score ?? 0, totalScore: stats?.total_score ?? 0, xp, mmr: stats?.mmr ?? 1000, coins: stats?.coins ?? 0, level: levelForXp(xp), dailyStreak: stats?.daily_streak ?? 0, lastDailyKey: stats?.last_daily_key ?? null } });
    }
    if (url.searchParams.get('history') === '1') {
      const { userId } = await requireGuest(db, request, now);
      const rows = await db.prepare('SELECT room_code, mode, category, score, won, created_at FROM match_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(userId).all();
      return json({ history: rows.results });
    }
    if (url.searchParams.get('achievements') === '1') {
      const { userId } = await requireGuest(db, request, now); const rows = await db.prepare('SELECT achievement_id FROM achievements WHERE user_id = ?').bind(userId).all<{ achievement_id: string }>();
      return json({ achievements: rows.results.map((row) => row.achievement_id) });
    }
    if (url.searchParams.get('daily') === '1') {
      const { userId } = await requireGuest(db, request, now); const key = utcDay(now);
      const attempt = await db.prepare('SELECT score, won, completed_at FROM daily_attempts WHERE user_id = ? AND challenge_key = ?').bind(userId, key).first();
      return json({ key, category: dailyCategory(key), completed: Boolean(attempt), attempt: attempt ?? null });
    }
    const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();
    if (!code) return json({ error: 'Room code is required.' }, 400);
    const state = await roomState(db, code, now); return state ? json(state) : json({ error: 'Room not found.' }, 404);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>; const action = stringValue(body.action); const db = await getGameDb(); const now = Date.now();
    if (action === 'session') {
      try { const existing = await requireGuest(db, request, now); return json({ name: existing.name }); }
      catch { const name = cleanDisplayName(body.name); const session = await issueGuestSession(db, request, name, now); return new Response(JSON.stringify({ name }), { status: 201, headers: { 'Content-Type': 'application/json', 'Set-Cookie': session.cookie } }); }
    }
    const limits: Record<string, [number, number]> = { submit: [18, 60_000], powerup: [10, 60_000], create: [8, 60_000], quick: [8, 60_000], matchmake: [8, 60_000], daily: [4, 60_000], join: [12, 60_000], realtime_ticket: [30, 60_000], report: [5, 3_600_000], update_profile: [8, 60_000] };
    const limit = limits[action];
    if (limit && !allowRequest(request, action, now, limit[0], limit[1])) return json({ error: 'Too many requests. Please wait a moment.' }, 429);
    const actor = await requireGuest(db, request, now);
    if (action === 'logout') {
      await db.prepare('UPDATE guest_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, actor.sessionId).run();
      return new Response(JSON.stringify({ loggedOut: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearGuestSession(request) } });
    }
    if (action === 'update_profile') {
      const name = cleanDisplayName(body.name); const rawAvatar = stringValue(body.avatar);
      const avatar = /^[a-z0-9_-]{0,24}$/i.test(rawAvatar) ? rawAvatar || null : null;
      await db.prepare('UPDATE users SET display_name = ?, avatar = ?, updated_at = ? WHERE id = ?').bind(name, avatar, now, actor.userId).run();
      return json({ name, avatar });
    }
    if (action === 'realtime_ticket') {
      const code = stringValue(body.code).trim().toUpperCase();
      const origin = (env as { REALTIME_ORIGIN?: string }).REALTIME_ORIGIN;
      const secret = (env as { REALTIME_TICKET_SECRET?: string }).REALTIME_TICKET_SECRET;
      if (!origin || !secret || secret.length < 32) return json({ error: 'Realtime is not configured yet. The polling connection is still active.' }, 503);
      let realtimeOrigin: URL;
      try { realtimeOrigin = new URL(origin); } catch { return json({ error: 'Realtime configuration is invalid. The polling connection is still active.' }, 503); }
      if (!['https:', 'http:'].includes(realtimeOrigin.protocol) || realtimeOrigin.username || realtimeOrigin.password || realtimeOrigin.search || realtimeOrigin.hash) return json({ error: 'Realtime configuration is invalid. The polling connection is still active.' }, 503);
      const seat = await db.prepare('SELECT id FROM players WHERE room_code = ? AND user_id = ?').bind(code, actor.userId).first<{ id: string }>();
      if (!seat) return json({ error: 'Only room participants can connect to realtime.' }, 403);
      const ticket = await createRealtimeTicket({ roomCode: code, userId: actor.userId, sessionId: actor.sessionId, playerId: seat.id, nonce: crypto.randomUUID(), expiresAt: now + 60_000 }, secret);
      return json({ url: `${realtimeOrigin.origin}/rooms/${encodeURIComponent(code)}?ticket=${encodeURIComponent(ticket)}`, expiresAt: now + 60_000 });
    }
    if (action === 'delete_account') {
      const userId = actor.userId;
      const statements: D1PreparedStatement[] = [
        db.prepare('DELETE FROM leaderboard_entries WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM player_stats WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM daily_attempts WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM weekly_leaderboard WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM reports WHERE reporter_user_id = ?').bind(userId),
        db.prepare('UPDATE reports SET reported_player_id = NULL WHERE reported_player_id IN (SELECT id FROM players WHERE user_id = ?)').bind(userId),
        db.prepare('UPDATE players SET user_id = NULL, name = ? WHERE user_id = ?').bind('Deleted player', userId),
        db.prepare('DELETE FROM oauth_states WHERE session_id IN (SELECT id FROM guest_sessions WHERE user_id = ?)').bind(userId),
        db.prepare('DELETE FROM guest_sessions WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      ];
      await db.batch(statements);
      return new Response(JSON.stringify({ deleted: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearGuestSession(request) } });
    }
    if (action === 'daily') {
      const name = actor.name; const userId = actor.userId; const challengeKey = utcDay(now);
      const completed = await db.prepare('SELECT 1 FROM daily_attempts WHERE user_id = ? AND challenge_key = ?').bind(userId, challengeKey).first();
      if (completed) return json({ error: 'You have already completed today’s Daily Clash.' }, 409);
      const active = await db.prepare(`SELECT rooms.* FROM rooms JOIN players ON players.room_code = rooms.code
        WHERE players.user_id = ? AND rooms.challenge_key = ? AND rooms.status IN ('waiting', 'active') LIMIT 1`).bind(userId, challengeKey).first<RoomRow>();
      if (active) {
        const seat = await db.prepare('SELECT id FROM players WHERE room_code = ? AND user_id = ?').bind(active.code, userId).first<{ id: string }>();
        if (seat) return json({ code: active.code, playerId: seat.id, state: await roomState(db, active.code, now), resumed: true });
      }
      const code = await createCode(db); const playerId = crypto.randomUUID(); const category = dailyCategory(challengeKey);
      await db.batch([
        db.prepare(`INSERT INTO rooms (code, host_player_id, category, mode, status, current_letter, turn_player_id, is_public, turn_deadline, challenge_key, created_at, updated_at) VALUES (?, ?, ?, 'classic', 'active', 't', ?, 0, ?, ?, ?, ?)`).bind(code, playerId, category, playerId, now + getMode('classic').turnSeconds * 1000, challengeKey, now, now),
        db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at) VALUES (?, ?, ?, ?, 0, 0, 3, ?, ?)`).bind(playerId, userId, code, name, now, now),
        botInsert(db, code, 0, now, getMode('classic').lives),
      ]);
      return json({ code, playerId, state: await roomState(db, code, now), daily: { key: challengeKey, category } }, 201);
    }
    if (action === 'report') {
      const code = stringValue(body.code).trim().toUpperCase(); const reporterUserId = actor.userId; const playerId = typeof body.playerId === 'string' ? body.playerId : null;
      const reason = stringValue(body.reason).trim().replace(/[^a-zA-Z0-9 .,!?'-]/g, '').slice(0, 240);
      const seat = await db.prepare('SELECT id FROM players WHERE room_code = ? AND user_id = ?').bind(code, reporterUserId).first();
      if (!seat) return json({ error: 'Only room participants can file a report.' }, 403);
      if (playerId && !await db.prepare('SELECT 1 FROM players WHERE room_code = ? AND id = ?').bind(code, playerId).first()) return json({ error: 'Reported player is not in this room.' }, 400);
      if (!reason) return json({ error: 'Tell us what happened.' }, 400);
      await db.prepare('INSERT INTO reports (id, room_code, reporter_user_id, reported_player_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), code, reporterUserId, playerId, reason, now).run();
      return json({ reported: true });
    }
    if (action === 'create' || action === 'quick' || action === 'matchmake') {
      const name = actor.name; const userId = actor.userId; const category = (stringValue(body.category) || 'animals') as Category; const mode = getMode(stringValue(body.mode));
      if (!(category in categories)) return json({ error: 'Invalid category.' }, 400);
      if (action === 'matchmake') {
        const candidates = (await db.prepare(`SELECT * FROM rooms WHERE is_public = 1 AND status = 'active' AND mode = ? ORDER BY updated_at DESC LIMIT 12`).bind(mode.id).all<RoomRow>()).results;
        for (const room of candidates) {
          const players = (await readPlayers(db, room.code)).results;
          const existing = players.find((player) => player.user_id === userId);
          if (existing) return json({ code: room.code, playerId: existing.id, state: await roomState(db, room.code, now), resumed: true });
          const bot = players.find((player) => player.is_bot);
          if (!bot || players.length >= 6) continue;
          const playerId = crypto.randomUUID();
          await db.batch([
            db.prepare('DELETE FROM players WHERE id = ?').bind(bot.id),
            db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`).bind(playerId, userId, room.code, name, getMode(room.mode).lives, now, now),
            db.prepare('UPDATE rooms SET updated_at = ? WHERE code = ?').bind(now, room.code),
          ]);
          return json({ code: room.code, playerId, state: await roomState(db, room.code, now), matched: true });
        }
      }
      const code = await createCode(db); const playerId = crypto.randomUUID(); const botCount = action === 'matchmake' || action === 'quick' ? 1 : Math.max(0, Math.min(3, Number(body.botCount ?? 0)));
      const inserts = [
        db.prepare(`INSERT INTO rooms (code, host_player_id, category, mode, status, current_letter, turn_player_id, is_public, turn_deadline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 't', ?, ?, ?, ?, ?)`).bind(code, playerId, category, mode.id, botCount ? 'active' : 'waiting', playerId, action === 'matchmake' ? 1 : 0, botCount ? now + mode.turnSeconds * 1000 : null, now, now),
        db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`).bind(playerId, userId, code, name, mode.lives, now, now),
        ...Array.from({ length: botCount }, (_, index) => botInsert(db, code, index, now, mode.lives)),
      ];
      await db.batch(inserts); return json({ code, playerId, state: await roomState(db, code, now) }, 201);
    }
    if (action === 'join' || action === 'resume') {
      const code = stringValue(body.code).trim().toUpperCase(); const room = await readRoom(db, code);
      if (!room) return json({ error: 'That room does not exist.' }, 404); if (room.status === 'finished') return json({ error: 'That match has finished.' }, 409);
      const name = actor.name; const userId = actor.userId; const players = (await readPlayers(db, code)).results;
      const existing = players.find((player) => player.user_id === userId);
      if (existing) {
        await db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').bind(now, existing.id).run();
        return json({ code, playerId: existing.id, state: await roomState(db, code, now), resumed: true });
      }
      if (action === 'resume') return json({ error: 'Your seat is no longer available.' }, 404);
      if (players.length >= 6) return json({ error: 'That room is full.' }, 409);
      const playerId = crypto.randomUUID();
      const mode = getMode(room.mode);
      await db.prepare(`INSERT INTO players (id, user_id, room_code, name, is_bot, score, lives, joined_at, last_seen_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`).bind(playerId, userId, code, name, mode.lives, now, now).run();
      if (room.status === 'waiting') await db.prepare(`UPDATE rooms SET status = 'active', turn_player_id = host_player_id, turn_deadline = ?, updated_at = ? WHERE code = ?`).bind(now + mode.turnSeconds * 1000, now, code).run();
      return json({ code, playerId, state: await roomState(db, code, now) });
    }
    if (action === 'add_bot') {
      const code = stringValue(body.code).trim().toUpperCase(); const room = await readRoom(db, code);
      const hostPlayer = await db.prepare('SELECT id FROM players WHERE room_code = ? AND user_id = ?').bind(code, actor.userId).first<{ id: string }>(); const playerId = hostPlayer?.id ?? '';
      if (!room || !isHostActionAuthorized(room.host_player_id, hostPlayer?.id ?? null) || room.status === 'finished') return json({ error: 'Only the host can add a bot.' }, 403);
      const host = await db.prepare('SELECT id FROM players WHERE id = ? AND room_code = ? AND user_id = ?').bind(playerId, code, actor.userId).first();
      if (!host) return json({ error: 'Only the host can add a bot.' }, 403);
      const players = (await readPlayers(db, code)).results; if (players.length >= 6) return json({ error: 'That room is full.' }, 409);
      const mode = getMode(room.mode);
      await botInsert(db, code, players.filter((player) => player.is_bot).length, now, mode.lives).run();
      if (room.status === 'waiting') await db.prepare(`UPDATE rooms SET status = 'active', turn_player_id = host_player_id, turn_deadline = ?, updated_at = ? WHERE code = ?`).bind(now + mode.turnSeconds * 1000, now, code).run();
      return json({ state: await roomState(db, code, now) });
    }
    if (action === 'powerup') {
      const code = stringValue(body.code).trim().toUpperCase(); const commandId = stringValue(body.commandId); const powerUp = stringValue(body.powerUp); const cost = powerUpCost(powerUp);
      if (!commandId || commandId.length > 80 || cost === null) return json({ error: 'Invalid power-up command.' }, 400);
      const room = await readRoom(db, code); const player = await db.prepare('SELECT * FROM players WHERE room_code = ? AND user_id = ?').bind(code, actor.userId).first<PlayerRow>();
      if (!room || !player || player.is_bot || room.status !== 'active' || room.turn_player_id !== player.id || !getMode(room.mode).powerUpsEnabled) return json({ error: 'Power-ups can only be used on your turn.' }, 409);
      const duplicate = await db.prepare('SELECT 1 FROM power_up_uses WHERE command_id = ?').bind(commandId).first(); if (duplicate) return json({ state: await roomState(db, code, now), duplicate: true });
      const players = (await readPlayers(db, code)).results;
      const effect = applyPowerUp({ turnPlayerId: room.turn_player_id, status: room.status, blockedLetter: room.blocked_letter, freezeNext: Boolean(room.freeze_next), turnDirection: room.turn_direction === -1 ? -1 : 1, usedPowerUpTurnId: null, players: players.map((item) => ({ id: item.id, score: item.score, shield: Boolean(item.shield), joinedAt: item.joined_at })) } as PowerUpState, player.id, powerUp);
      if (!effect.ok) return json({ error: effect.error }, 409);
      const spend = await db.prepare('UPDATE player_stats SET coins = coins - ? WHERE user_id = ? AND coins >= ?').bind(cost, actor.userId, cost).run(); if ((spend.meta.changes ?? 0) !== 1) return json({ error: 'Not enough coins.' }, 409);
      await db.batch([
        db.prepare('INSERT INTO power_up_uses (command_id,room_code,user_id,power_up,created_at) VALUES (?, ?, ?, ?, ?)').bind(commandId, code, actor.userId, powerUp, now),
        db.prepare('UPDATE rooms SET blocked_letter = ?, freeze_next = ?, turn_direction = ?, updated_at = ? WHERE code = ?').bind(effect.state.blockedLetter, effect.state.freezeNext ? 1 : 0, effect.state.turnDirection, now, code),
        ...effect.state.players.map((item) => db.prepare('UPDATE players SET score = ?, shield = ? WHERE id = ?').bind(item.score, item.shield ? 1 : 0, item.id)),
      ]);
      if (powerUp === 'skip') await advance(db, { ...room, blocked_letter: effect.state.blockedLetter, freeze_next: effect.state.freezeNext ? 1 : 0, turn_direction: effect.state.turnDirection }, players, player.id, player.lives, now);
      const coins = await db.prepare('SELECT coins FROM player_stats WHERE user_id = ?').bind(actor.userId).first<{ coins: number }>(); return json({ state: await roomState(db, code, now), coins: coins?.coins ?? 0, message: effect.message });
    }
    if (action === 'submit') {
      const code = stringValue(body.code).trim().toUpperCase(); const rawWord = stringValue(body.word); const word = normalizeWord(rawWord);
      const seat = await db.prepare('SELECT id FROM players WHERE room_code = ? AND user_id = ?').bind(code, actor.userId).first<{ id: string }>(); const playerId = seat?.id ?? '';
      await settleRoom(db, code, now); const room = await readRoom(db, code);
      if (!room || room.status !== 'active') return json({ error: 'This match is not active.' }, 409); if (room.turn_player_id !== playerId) return json({ error: 'Wait for your turn.' }, 409);
      const player = await db.prepare('SELECT * FROM players WHERE id = ? AND room_code = ? AND user_id = ?').bind(playerId, code, actor.userId).first<PlayerRow>();
      if (!player || player.lives < 1 || player.is_bot) return json({ error: 'Player is not active.' }, 403);
      const used = new Set((await db.prepare('SELECT word FROM moves WHERE room_code = ? AND valid = 1').bind(code).all<{ word: string }>()).results.map((row) => row.word));
      const check = word.startsWith(room.current_letter) && !used.has(word) ? await validateWord(db, room.category, rawWord, now) : { valid: false, source: 'rule' };
      const shielded = !check.valid && Boolean(player.shield); const lives = check.valid || shielded ? player.lives : Math.max(0, player.lives - 1); const score = player.score + (check.valid ? scoreForWord(room.mode, word, Math.max(0, ((room.turn_deadline ?? now) - now) / 1000)) : 0); const players = (await readPlayers(db, code)).results;
      if (!await claimRoomTurn(db, { code, playerId, stateVersion: room.state_version, now })) return json({ error: 'This turn was already resolved. Refresh the room.' }, 409);
      await db.batch([
        db.prepare('INSERT INTO moves (id, room_code, player_id, word, valid, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), code, playerId, word || '—', check.valid ? 1 : 0, now),
        db.prepare('UPDATE players SET score = ?, lives = ?, shield = ?, last_seen_at = ? WHERE id = ?').bind(score, lives, shielded ? 0 : player.shield, now, playerId),
      ]);
      const adjusted = players.map((item) => item.id === playerId ? { ...item, score, lives } : item);
      await advance(db, room, adjusted, playerId, lives, now, check.valid ? word.at(-1) : room.current_letter, used.size + (check.valid ? 1 : 0));
      return json({ valid: check.valid, source: check.source, state: await roomState(db, code, now) });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500); }
}
