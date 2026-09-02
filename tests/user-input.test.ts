import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDisplayName } from '../lib/user-input.ts';

void test('display names are bounded and blocked names cannot enter the game', () => {
  assert.equal(cleanDisplayName('  Riya_77  '), 'Riya_77');
  assert.equal(cleanDisplayName('f.u.c.k'), 'Player');
  assert.equal(cleanDisplayName('x'.repeat(40)), 'x'.repeat(16));
  assert.equal(cleanDisplayName(null), 'Player');
});
