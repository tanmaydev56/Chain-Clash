import { getWords, normalizeWord, type Category } from '../../lib/game-data.ts';
import { categoryForWord, getMode, scoreForWord, turnSecondsForWord } from '../../lib/game-modes.ts';

export const ROOM_POLICY = {
  /** Legacy test/client compatibility; mode rules own real turn durations. */
  turnMs: 12_000,
  botDelayMs: 700,
  reconnectGraceMs: 30_000,
  emptyWaitingMs: 5 * 60_000,
  abandonedActiveMs: 15 * 60_000,
  finishedRetentionMs: 5 * 60_000,
} as const;

export type RealtimePlayer = { id: string; userId: string | null; name: string; bot: boolean; score: number; lives: number; shield: boolean; joinedAt: number; disconnectedAt: number | null };
export type RealtimeMove = { id: string; playerId: string; word: string; valid: boolean; createdAt: number };
export type RealtimeRoomState = {
  code: string; hostPlayerId: string; category: Category; mode: string; blockedLetter: string | null; status: 'waiting' | 'active' | 'finished'; currentLetter: string;
  turnPlayerId: string | null; winnerPlayerId: string | null; deadline: number | null; challengeKey: string | null; version: number;
  players: RealtimePlayer[]; moves: RealtimeMove[]; usedWords: string[]; processedCommands: string[]; updatedAt: number; finalized: boolean;
};

export type SubmitResult = { accepted: boolean; error?: string; state: RealtimeRoomState; move?: RealtimeMove };

export class RoomCommandQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>) {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function copy(state: RealtimeRoomState): RealtimeRoomState { return structuredClone(state); }
function humanForUser(state: RealtimeRoomState, userId: string) { return state.players.find((player) => !player.bot && player.userId === userId); }
function connectedHumans(state: RealtimeRoomState) { return state.players.filter((player) => !player.bot && player.disconnectedAt === null); }

function advance(state: RealtimeRoomState, currentPlayerId: string, now: number, nextLetter = state.currentLetter) {
  const alive = state.players.filter((player) => player.lives > 0);
  if (state.players.length > 1 && alive.length === 1) {
    state.status = 'finished'; state.winnerPlayerId = alive[0]?.id ?? null; state.turnPlayerId = null; state.deadline = null;
    return;
  }
  const currentIndex = alive.findIndex((player) => player.id === currentPlayerId);
  const next = alive[(currentIndex < 0 ? 0 : currentIndex + 1) % alive.length];
  state.status = 'active'; state.currentLetter = nextLetter; state.turnPlayerId = next?.id ?? null;
  const words = state.usedWords.length;
  state.category = categoryForWord(state.mode, ['animals', 'food', 'countries', 'things'], words);
  state.deadline = next ? now + (next.bot ? ROOM_POLICY.botDelayMs : turnSecondsForWord(state.mode, words) * 1000) : null;
}

export function submitWord(state: RealtimeRoomState, userId: string, commandId: string, rawWord: string, valid: boolean, now: number): SubmitResult {
  const next = copy(state);
  if (!commandId || next.processedCommands.includes(commandId)) return { accepted: false, error: 'Duplicate command.', state };
  const player = humanForUser(next, userId);
  if (!player) return { accepted: false, error: 'Room membership required.', state };
  if (next.status !== 'active' || next.turnPlayerId !== player.id) return { accepted: false, error: 'Wait for your turn.', state };
  const word = normalizeWord(rawWord);
  const acceptedWord = valid && word.startsWith(next.currentLetter) && !next.usedWords.includes(word);
  if (next.blockedLetter && word.startsWith(next.blockedLetter)) return { accepted: false, error: `The letter ${next.blockedLetter.toUpperCase()} is blocked.`, state };
  if (acceptedWord) { player.score += scoreForWord(next.mode, word, Math.max(0, ((next.deadline ?? now) - now) / 1000)); next.usedWords.push(word); next.blockedLetter = null; }
  else if (player.shield) { player.shield = false; }
  else player.lives = Math.max(0, player.lives - 1);
  const move = { id: crypto.randomUUID(), playerId: player.id, word: word || '—', valid: acceptedWord, createdAt: now };
  next.moves.push(move); next.processedCommands = [...next.processedCommands.slice(-127), commandId]; next.version += 1; next.updatedAt = now;
  advance(next, player.id, now, acceptedWord ? word.at(-1) : next.currentLetter);
  return { accepted: true, state: next, move };
}

export function resolveAlarm(state: RealtimeRoomState, now: number): RealtimeRoomState {
  if (state.status !== 'active' || !state.turnPlayerId || !state.deadline || now < state.deadline) return state;
  const next = copy(state); const player = next.players.find((item) => item.id === next.turnPlayerId);
  if (!player) return state;
  if (player.bot) {
    const options = getWords(next.category, next.currentLetter, next.usedWords);
    if (options.length) {
      const word = options[0]; player.score += scoreForWord(next.mode, word, Math.max(0, ((next.deadline ?? now) - now) / 1000)); next.usedWords.push(word); next.blockedLetter = null;
      next.moves.push({ id: crypto.randomUUID(), playerId: player.id, word, valid: true, createdAt: now });
      next.version += 1; next.updatedAt = now; advance(next, player.id, now, word.at(-1)); return next;
    }
  }
  if (player.shield) player.shield = false;
  else player.lives = Math.max(0, player.lives - 1);
  next.moves.push({ id: crypto.randomUUID(), playerId: player.id, word: player.bot ? 'no-word' : 'timeout', valid: false, createdAt: now });
  next.version += 1; next.updatedAt = now; advance(next, player.id, now); return next;
}

export function addBot(state: RealtimeRoomState, userId: string, commandId: string, now: number): SubmitResult {
  if (state.processedCommands.includes(commandId)) return { accepted: false, error: 'Duplicate command.', state };
  const actor = humanForUser(state, userId);
  if (!actor || actor.id !== state.hostPlayerId) return { accepted: false, error: 'Only the host can add a bot.', state };
  if (state.players.length >= 6 || state.status === 'finished') return { accepted: false, error: 'Room cannot accept another bot.', state };
  const next = copy(state); const bot: RealtimePlayer = { id: crypto.randomUUID(), userId: null, name: 'WordBot', bot: true, score: 0, lives: getMode(next.mode).lives, shield: false, joinedAt: now, disconnectedAt: null };
  next.players.push(bot); next.processedCommands = [...next.processedCommands.slice(-127), commandId]; next.version += 1; next.updatedAt = now;
  if (next.status === 'waiting') { next.status = 'active'; next.turnPlayerId = next.hostPlayerId; next.deadline = now + turnSecondsForWord(next.mode, next.usedWords.length) * 1000; }
  return { accepted: true, state: next };
}

export function setConnected(state: RealtimeRoomState, userId: string, connected: boolean, now: number) {
  const next = copy(state); const player = humanForUser(next, userId); if (!player) return state;
  player.disconnectedAt = connected ? null : now; next.updatedAt = now;
  return next;
}

export function resolveDisconnectGrace(state: RealtimeRoomState, now: number) {
  if (state.status !== 'waiting') return state;
  const host = state.players.find((player) => player.id === state.hostPlayerId);
  if (!host?.disconnectedAt || now < host.disconnectedAt + ROOM_POLICY.reconnectGraceMs) return state;
  const replacement = connectedHumans(state).find((candidate) => candidate.id !== host.id);
  if (!replacement) return state;
  const next = copy(state); next.hostPlayerId = replacement.id; next.version += 1; next.updatedAt = now; return next;
}

export function shouldExpireRoom(state: RealtimeRoomState, now: number) {
  if (state.status === 'finished') return now - state.updatedAt >= ROOM_POLICY.finishedRetentionMs;
  const humans = state.players.filter((player) => !player.bot);
  const lastHumanActivity = humans.length ? Math.max(...humans.map((player) => player.disconnectedAt ?? player.joinedAt)) : state.updatedAt;
  if (humans.every((player) => player.disconnectedAt !== null)) return now - lastHumanActivity >= (state.status === 'waiting' ? ROOM_POLICY.emptyWaitingMs : ROOM_POLICY.abandonedActiveMs);
  return false;
}

export function publicRoomState(state: RealtimeRoomState) {
  return { room: { code: state.code, category: state.category, mode: state.mode, blocked_letter: state.blockedLetter, status: state.status, current_letter: state.currentLetter, turn_player_id: state.turnPlayerId, winner_player_id: state.winnerPlayerId, turn_deadline: state.deadline, state_version: state.version }, players: state.players.map(({ userId: _userId, disconnectedAt: _disconnectedAt, ...player }) => ({ id: player.id, name: player.name, is_bot: player.bot ? 1 : 0, score: player.score, lives: player.lives, shield: player.shield ? 1 : 0, joined_at: player.joinedAt })), moves: state.moves.slice(-12).reverse().map((move) => ({ id: move.id, word: move.word, valid: move.valid ? 1 : 0, created_at: move.createdAt, player_name: state.players.find((player) => player.id === move.playerId)?.name ?? 'Player' })) };
}
