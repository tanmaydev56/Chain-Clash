// Layered word validation for Chain Clash.
//
// The problem this solves: the curated lists in `game-data.ts` only hold a few
// hundred words, so a player who answers with a perfectly real word that we did
// not hardcode ("rhinoceros", "alligator", "chimpanzee") is punished for being
// right. That single bug makes the game feel broken to every new player.
//
// The fix is a cascade, cheapest-first, so we almost never pay for an AI call:
//   1. pre-checks   — well-formed + not a slur   (pure, instant, no I/O)
//   2. seed list    — the curated `categories`    (pure, instant, no I/O)
//   3. word_cache   — verdicts we have seen before (one indexed D1 read)
//   4. AI fallback  — ask a model, then cache it   (one network call, once ever)
//
// Every AI verdict is written back to `word_cache`, so each unknown word costs
// at most one model call for the entire lifetime of the app.

import { categories, isBlockedWord, isWellFormedWord, normalizeWord, type Category } from './game-data.ts';

export type ValidationSource = 'malformed' | 'blocked' | 'seed' | 'cache' | 'ai' | 'fallback';
export type ValidationResult = { valid: boolean; source: ValidationSource; word: string };

// Minimal shape we need from D1 so this module stays unit-testable without a
// real database. The route passes the live `D1Database`; tests pass a fake.
export type WordCache = {
  get(category: Category, word: string): Promise<boolean | null>;
  put(category: Category, word: string, valid: boolean, source: string): Promise<void>;
};

export type ValidateOptions = {
  cache?: WordCache | null;
  aiKey?: string | null;
  // When the AI layer is unavailable (no key) or fails (timeout/error), should
  // an unknown-but-well-formed word be accepted? Default false = reject, which
  // keeps competitive integrity but reproduces the "only ~300 words" feel until
  // an OPENAI_API_KEY is configured. See CODEX-BRIEF.md → Word Validation.
  fallbackAccept?: boolean;
  aiModel?: string;
  timeoutMs?: number;
};

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 3500;

// Human-readable definition of each category for the AI judge. Keep these tight:
// they are the contract for what counts as "valid" and should match the UI copy.
const categoryPrompt: Record<Category, string> = {
  animals: 'a real animal — any species of mammal, bird, fish, reptile, amphibian, insect, or other creature (common or scientific name)',
  food: 'a food, drink, dish, or edible ingredient that people actually eat or drink',
  countries: 'a sovereign country or widely recognized nation (current or very well known)',
  things: 'a common, concrete, everyday physical object (a tangible thing you could point at)',
};

// --- Layers 1 & 2: pure, synchronous, no I/O. Fully unit-testable. -----------

// Returns a decided result, or null when the word is well-formed but not in the
// seed list (i.e. "undecided" — the caller should consult cache/AI).
export function preCheck(category: Category, raw: string): ValidationResult | null {
  const word = normalizeWord(raw);
  if (!isWellFormedWord(raw)) return { valid: false, source: 'malformed', word };
  if (isBlockedWord(word)) return { valid: false, source: 'blocked', word };
  if ((categories[category] as readonly string[]).includes(word)) return { valid: true, source: 'seed', word };
  return null;
}

// --- Full cascade ------------------------------------------------------------

export async function validateCategoryWord(
  category: Category,
  raw: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const decided = preCheck(category, raw);
  if (decided) return decided;

  const word = normalizeWord(raw);
  const { cache = null, aiKey = null, fallbackAccept = false } = options;

  // Layer 3: cache of prior verdicts (seed hits never reach here).
  if (cache) {
    const cached = await cache.get(category, word).catch(() => null);
    if (cached !== null) return { valid: cached, source: 'cache', word };
  }

  // Layer 4: AI judge. Only runs for words we have never seen before.
  if (aiKey) {
    const verdict = await askAi(category, word, aiKey, options).catch(() => null);
    if (verdict !== null) {
      if (cache) await cache.put(category, word, verdict, 'ai').catch(() => undefined);
      return { valid: verdict, source: 'ai', word };
    }
  }

  // Nothing could decide it. Fall back to the configured policy.
  return { valid: fallbackAccept, source: 'fallback', word };
}

// Ask the model a single yes/no question. Returns true/false, or null if the
// call errored/timed out so the caller can apply its fallback policy.
async function askAi(
  category: Category,
  word: string,
  apiKey: string,
  options: ValidateOptions,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.aiModel ?? DEFAULT_MODEL,
        temperature: 0,
        max_tokens: 3,
        messages: [
          {
            role: 'system',
            content: 'You are a strict but fair judge for a word game. Answer with exactly one lowercase word: "yes" or "no". No punctuation, no explanation.',
          },
          {
            role: 'user',
            content: `Is "${word}" ${categoryPrompt[category]}? Ignore spelling variants and plurals — accept them if the base word qualifies. Answer yes or no.`,
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const answer = (data.choices?.[0]?.message?.content ?? '').trim().toLowerCase();
    if (answer.startsWith('yes')) return true;
    if (answer.startsWith('no')) return false;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Adapter that turns the live D1 `word_cache` table into a `WordCache`.
// Verdicts are stored as the strings 'accepted' / 'rejected' to match the
// existing column, alongside the source ('seed' | 'ai' | 'curated').
export function d1WordCache(db: D1Database, now: () => number = Date.now): WordCache {
  return {
    async get(category, word) {
      const row = await db
        .prepare('SELECT verdict FROM word_cache WHERE category = ? AND word = ?')
        .bind(category, word)
        .first<{ verdict: string }>();
      if (!row) return null;
      return row.verdict === 'accepted';
    },
    async put(category, word, valid, source) {
      await db
        .prepare(
          `INSERT INTO word_cache (category, word, verdict, source, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(category, word) DO UPDATE SET verdict = excluded.verdict, source = excluded.source, updated_at = excluded.updated_at`,
        )
        .bind(category, word, valid ? 'accepted' : 'rejected', source, now())
        .run();
    },
  };
}
