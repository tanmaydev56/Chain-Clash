import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidCategoryWord } from '../lib/game-data.ts';

void test('accepts words from the selected category dictionary', () => {
  assert.equal(isValidCategoryWord('animals', 'Tiger'), true);
  assert.equal(isValidCategoryWord('food', '  samosa  '), true);
  assert.equal(isValidCategoryWord('countries', 'India'), true);
  assert.equal(isValidCategoryWord('things', 'table'), true);
});

void test('rejects plausible-looking nonsense words', () => {
  assert.equal(isValidCategoryWord('animals', 'abbit'), false);
  assert.equal(isValidCategoryWord('animals', 'nena'), false);
  assert.equal(isValidCategoryWord('animals', 'notarealanimal'), false);
});

void test('rejects valid words used in the wrong category', () => {
  assert.equal(isValidCategoryWord('animals', 'samosa'), false);
  assert.equal(isValidCategoryWord('countries', 'tiger'), false);
});

void test('rejects punctuation, numbers, empty input, and blocked words', () => {
  assert.equal(isValidCategoryWord('animals', 't!ger'), false);
  assert.equal(isValidCategoryWord('animals', 'tiger2'), false);
  assert.equal(isValidCategoryWord('animals', ''), false);
  assert.equal(isValidCategoryWord('things', 'shit'), false);
});
