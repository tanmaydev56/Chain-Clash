import assert from 'node:assert/strict';
import test from 'node:test';
import { claimRoomFinalization, claimRoomTurn, isHostActionAuthorized } from '../lib/game-state.ts';

type Room = { code: string; status: string; turnPlayerId: string | null; stateVersion: number; statsRecorded: number };

function fakeDb(room: Room) {
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (sql.includes('state_version = state_version + 1')) {
                const [, code, playerId, stateVersion] = values;
                const claimed = room.code === code && room.status === 'active' && room.turnPlayerId === playerId && room.stateVersion === stateVersion;
                if (claimed) { room.stateVersion += 1; room.turnPlayerId = null; }
                return { meta: { changes: claimed ? 1 : 0 } };
              }
              const [code] = values;
              const claimed = room.code === code && room.statsRecorded === 0;
              if (claimed) room.statsRecorded = 1;
              return { meta: { changes: claimed ? 1 : 0 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

void test('only one concurrent turn claim for the same state version succeeds', async () => {
  const room: Room = { code: 'ABC123', status: 'active', turnPlayerId: 'player-a', stateVersion: 4, statsRecorded: 0 };
  const db = fakeDb(room);
  const claims = await Promise.all([
    claimRoomTurn(db, { code: room.code, playerId: 'player-a', stateVersion: 4, now: 1 }),
    claimRoomTurn(db, { code: room.code, playerId: 'player-a', stateVersion: 4, now: 1 }),
  ]);
  assert.deepEqual(claims.sort((left, right) => Number(left) - Number(right)), [false, true]);
  assert.equal(room.stateVersion, 5);
  assert.equal(room.turnPlayerId, null);
});

void test('a non-host player cannot use a player id from room state for host actions', () => {
  assert.equal(isHostActionAuthorized('host-seat', 'other-seat'), false);
  assert.equal(isHostActionAuthorized('host-seat', null), false);
  assert.equal(isHostActionAuthorized('host-seat', 'host-seat'), true);
});

void test('finalization can be claimed exactly once', async () => {
  const room: Room = { code: 'ABC123', status: 'finished', turnPlayerId: null, stateVersion: 5, statsRecorded: 0 };
  const db = fakeDb(room);
  const claims = await Promise.all([claimRoomFinalization(db, room.code), claimRoomFinalization(db, room.code)]);
  assert.deepEqual(claims.sort((left, right) => Number(left) - Number(right)), [false, true]);
  assert.equal(room.statsRecorded, 1);
});
