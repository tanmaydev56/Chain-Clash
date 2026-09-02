import { isBlockedWord, normalizeWord } from './game-data.ts';

export function cleanDisplayName(value: unknown) {
  const name = typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) : '';
  return name && !isBlockedWord(normalizeWord(name)) ? name : 'Player';
}
