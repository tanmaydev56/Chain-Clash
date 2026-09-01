import assert from 'node:assert/strict';
import test from 'node:test';
import { preCheck, validateCategoryWord, type WordCache } from '../lib/word-validation.ts';

// A fake in-memory cache so the cascade can be tested without D1.
function fakeCache(seed: Record<string, boolean> = {}): WordCache & { writes: Array<{ key: string; valid: boolean; source: string }> } {
  const store = new Map(Object.entries(seed));
  const writes: Array<{ key: string; valid: boolean; source: string }> = [];
  return {
    writes,
    async get(category, word) {
      const key = `${category}:${word}`;
      return store.has(key) ? (store.get(key) as boolean) : null;
    },
    async put(category, word, valid, source) {
      const key = `${category}:${word}`;
      store.set(key, valid);
      writes.push({ key, valid, source });
    },
  };
}

// Swap global fetch for the duration of one call and restore it after.
async function withFakeFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function aiResponse(answer: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

void test('preCheck decides malformed, blocked, and seed words instantly', () => {
  assert.equal(preCheck('animals', 't!ger')?.source, 'malformed');
  assert.equal(preCheck('animals', 'tiger2')?.source, 'malformed');
  assert.equal(preCheck('animals', '')?.source, 'malformed');
  assert.equal(preCheck('things', 'shit')?.source, 'blocked');
  assert.deepEqual(preCheck('animals', 'Tiger'), { valid: true, source: 'seed', word: 'tiger' });
  // Undecided: well-formed, not blocked, not in the seed list.
  assert.equal(preCheck('animals', 'zorptron'), null);
});

void test('expanded seed list accepts common real words that used to fail', async () => {
  for (const word of ['rhinoceros', 'alligator', 'chimpanzee', 'flamingo']) {
    const result = await validateCategoryWord('animals', word);
    assert.equal(result.valid, true, `${word} should be valid`);
    assert.equal(result.source, 'seed');
  }
});

void test('cache hit is used before any AI call (accepted and rejected)', async () => {
  const cache = fakeCache({ 'animals:dragon': true, 'animals:banana': false });
  const yes = await validateCategoryWord('animals', 'dragon', { cache });
  assert.deepEqual(yes, { valid: true, source: 'cache', word: 'dragon' });
  const no = await validateCategoryWord('animals', 'banana', { cache });
  assert.deepEqual(no, { valid: false, source: 'cache', word: 'banana' });
});

void test('AI verdict is used for unknown words and written back to the cache', async () => {
  const cache = fakeCache();
  const result = await withFakeFetch(aiResponse('yes'), () =>
    validateCategoryWord('animals', 'quokka', { cache, aiKey: 'test-key' }),
  );
  assert.deepEqual(result, { valid: true, source: 'ai', word: 'quokka' });
  assert.deepEqual(cache.writes, [{ key: 'animals:quokka', valid: true, source: 'ai' }]);
});

void test('AI "no" rejects the word and caches the rejection', async () => {
  const cache = fakeCache();
  const result = await withFakeFetch(aiResponse('no'), () =>
    validateCategoryWord('food', 'granite', { cache, aiKey: 'test-key' }),
  );
  assert.equal(result.valid, false);
  assert.equal(result.source, 'ai');
  assert.equal(cache.writes[0]?.valid, false);
});

void test('fallback policy applies when no AI key is configured', async () => {
  const strict = await validateCategoryWord('animals', 'zorptron', { fallbackAccept: false });
  assert.deepEqual(strict, { valid: false, source: 'fallback', word: 'zorptron' });
  const lenient = await validateCategoryWord('animals', 'zorptron', { fallbackAccept: true });
  assert.deepEqual(lenient, { valid: true, source: 'fallback', word: 'zorptron' });
});

void test('an AI failure falls back instead of throwing', async () => {
  const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  const result = await withFakeFetch(failing, () =>
    validateCategoryWord('animals', 'zorptron', { aiKey: 'test-key', fallbackAccept: false }),
  );
  assert.deepEqual(result, { valid: false, source: 'fallback', word: 'zorptron' });
});
