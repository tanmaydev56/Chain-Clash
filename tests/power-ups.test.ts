import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPowerUp } from '../lib/power-ups.ts';

const state = () => ({ turnPlayerId: 'a', status: 'active' as const, blockedLetter: null, freezeNext: false, turnDirection: 1 as const, usedPowerUpTurnId: null, players: [{ id: 'a', score: 2, shield: false, joinedAt: 1 }, { id: 'b', score: 9, shield: false, joinedAt: 2 }] });
void test('power-up effects are turn-bound and mutate only authoritative fields', () => { const shield = applyPowerUp(state(), 'a', 'shield'); assert.equal(shield.ok, true); assert.equal(shield.state.players[0]?.shield, true); const freeze = applyPowerUp(state(), 'a', 'freeze'); assert.equal(freeze.state.freezeNext, true); const steal = applyPowerUp(state(), 'a', 'steal'); assert.equal(steal.state.players[0]?.score, 7); assert.equal(steal.state.players[1]?.score, 4); });
void test('power-up rejects out-of-turn, duplicate, and impossible steal', () => { assert.equal(applyPowerUp(state(), 'b', 'shield').ok, false); const once = applyPowerUp(state(), 'a', 'shield'); assert.equal(applyPowerUp(once.state, 'a', 'freeze').ok, false); const noPoints = state(); noPoints.players[1]!.score = 0; assert.equal(applyPowerUp(noPoints, 'a', 'steal').ok, false); });
