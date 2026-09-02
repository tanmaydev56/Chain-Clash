import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryForWord, getMode, levelForXp, scoreForWord, turnSecondsForWord, xpForLevel } from '../lib/game-modes.ts';

void test('modes default to classic and retain their core rules', () => {
  assert.equal(getMode('unknown').id, 'classic');
  assert.equal(getMode('blitz').turnSeconds, 6);
  assert.equal(getMode('marathon').lives, 5);
});
void test('survival timer shrinks but never falls below three seconds', () => {
  assert.equal(turnSecondsForWord('survival', 0), 10);
  assert.equal(turnSecondsForWord('survival', 10), 7);
  assert.equal(turnSecondsForWord('survival', 99), 3);
});
void test('score calculation is mode authoritative and includes time', () => {
  assert.equal(scoreForWord('classic', 'tiger', 4.1), 60);
  assert.equal(scoreForWord('blitz', 'tiger', 4.1), 120);
});
void test('roulette rotates category every three accepted words', () => {
  const order = ['animals', 'food', 'countries', 'things'] as const;
  assert.equal(categoryForWord('roulette', order, 0), 'animals');
  assert.equal(categoryForWord('roulette', order, 3), 'food');
  assert.equal(categoryForWord('classic', order, 9), 'animals');
});
void test('level progression has stable reversible thresholds', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(xpForLevel(3), 400);
});
