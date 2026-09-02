import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOM_POLICY, RoomCommandQueue, addBot, resolveAlarm, resolveDisconnectGrace, setConnected, shouldExpireRoom, submitWord, type RealtimeRoomState } from '../realtime-worker/src/room-engine.ts';

const now = 1_800_000_000_000;

function room(code = 'ABC123'): RealtimeRoomState {
  return {
    code, hostPlayerId: 'player-a', category: 'animals', mode: 'classic', blockedLetter: null, status: 'active', currentLetter: 't', turnPlayerId: 'player-a', winnerPlayerId: null,
    deadline: now + ROOM_POLICY.turnMs, challengeKey: null, version: 1, usedWords: [], moves: [], processedCommands: [], updatedAt: now, finalized: false,
    players: [
      { id: 'player-a', userId: 'user-a', name: 'A', bot: false, score: 0, lives: 3, shield: false, joinedAt: now, disconnectedAt: null },
      { id: 'player-b', userId: 'user-b', name: 'B', bot: false, score: 0, lives: 3, shield: false, joinedAt: now + 1, disconnectedAt: null },
    ],
  };
}

void test('two connected players share state while separate rooms remain isolated', () => {
  const first = setConnected(setConnected(room(), 'user-a', true, now), 'user-b', true, now);
  const second = room('XYZ789');
  const changed = submitWord(first, 'user-a', 'move-1', 'tiger', true, now + 10);
  assert.equal(changed.accepted, true);
  assert.equal(changed.state.players[0]?.score, 74);
  assert.equal(second.players[0]?.score, 0);
  assert.equal(second.usedWords.length, 0);
});

void test('unauthorized player cannot command another seat or take an out-of-turn move', () => {
  assert.equal(submitWord(room(), 'not-a-member', 'move-1', 'tiger', true, now).accepted, false);
  assert.equal(submitWord(room(), 'user-b', 'move-2', 'tiger', true, now).accepted, false);
});

void test('a valid move advances state and a replay cannot score twice', () => {
  const first = submitWord(room(), 'user-a', 'move-1', 'tiger', true, now + 10);
  assert.equal(first.accepted, true);
  assert.equal(first.state.turnPlayerId, 'player-b');
  assert.equal(first.state.currentLetter, 'r');
  const replay = submitWord(first.state, 'user-a', 'move-1', 'tiger', true, now + 20);
  assert.equal(replay.accepted, false);
  assert.equal(replay.state.players[0]?.score, 74);
});

void test('two concurrent commands are serialized so only one turn succeeds', async () => {
  const queue = new RoomCommandQueue();
  let state = room();
  const command = (id: string, word: string) => queue.run(async () => {
    await Promise.resolve();
    const result = submitWord(state, 'user-a', id, word, true, now + 10);
    if (result.accepted) state = result.state;
    return result.accepted;
  });
  const accepted = await Promise.all([command('move-a', 'tiger'), command('move-b', 'toucan')]);
  assert.deepEqual(accepted.sort((left, right) => Number(left) - Number(right)), [false, true]);
  assert.equal(state.moves.length, 1);
});

void test('a server alarm progresses a timed-out human turn without polling', () => {
  const next = resolveAlarm(room(), now + ROOM_POLICY.turnMs);
  assert.equal(next.players[0]?.lives, 2);
  assert.equal(next.turnPlayerId, 'player-b');
  assert.equal(next.moves[0]?.word, 'timeout');
});

void test('a bot turn progresses from an alarm', () => {
  const start = room();
  start.players[1] = { ...start.players[1]!, userId: null, name: 'WordBot', bot: true };
  start.turnPlayerId = 'player-b'; start.deadline = now;
  const next = resolveAlarm(start, now);
  assert.equal(next.moves.length, 1);
  assert.equal(next.turnPlayerId, 'player-a');
  assert.ok(next.players[1]!.score > 0 || next.players[1]!.lives === 2);
});

void test('disconnect, reconnect, host migration, and abandoned cleanup follow policy', () => {
  const waiting = { ...room(), status: 'waiting' as const, deadline: null };
  const hostLeft = setConnected(waiting, 'user-a', false, now);
  assert.equal(resolveDisconnectGrace(hostLeft, now + ROOM_POLICY.reconnectGraceMs - 1).hostPlayerId, 'player-a');
  assert.equal(resolveDisconnectGrace(hostLeft, now + ROOM_POLICY.reconnectGraceMs).hostPlayerId, 'player-b');
  assert.equal(setConnected(hostLeft, 'user-a', true, now + 1).players[0]?.disconnectedAt, null);
  const allLeft = setConnected(setConnected(room(), 'user-a', false, now), 'user-b', false, now);
  assert.equal(shouldExpireRoom(allLeft, now + ROOM_POLICY.abandonedActiveMs - 1), false);
  assert.equal(shouldExpireRoom(allLeft, now + ROOM_POLICY.abandonedActiveMs), true);
});

void test('host-only add bot rejects non-host and duplicate commands', () => {
  const waiting = { ...room(), status: 'waiting' as const, deadline: null };
  assert.equal(addBot(waiting, 'user-b', 'bot-1', now).accepted, false);
  const added = addBot(waiting, 'user-a', 'bot-1', now);
  assert.equal(added.accepted, true);
  assert.equal(addBot(added.state, 'user-a', 'bot-1', now + 1).accepted, false);
});
