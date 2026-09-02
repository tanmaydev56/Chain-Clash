import type { Category } from './game-data.ts';

export type GameModeId = 'classic' | 'blitz' | 'survival' | 'marathon' | 'roulette';
export type GameMode = { id: GameModeId; name: string; tagline: string; turnSeconds: number; minTurnSeconds: number; lives: number; scoreMultiplier: number; powerUpsEnabled: boolean };

export const modeOrder: GameModeId[] = ['classic', 'blitz', 'survival', 'marathon', 'roulette'];
export const gameModes: Record<GameModeId, GameMode> = {
  classic: { id: 'classic', name: 'Classic', tagline: 'The original rapid-fire chain.', turnSeconds: 12, minTurnSeconds: 12, lives: 3, scoreMultiplier: 1, powerUpsEnabled: true },
  blitz: { id: 'blitz', name: 'Blitz', tagline: 'Six seconds. Double points.', turnSeconds: 6, minTurnSeconds: 6, lives: 2, scoreMultiplier: 2, powerUpsEnabled: true },
  survival: { id: 'survival', name: 'Survival', tagline: 'One life and a shrinking clock.', turnSeconds: 10, minTurnSeconds: 3, lives: 1, scoreMultiplier: 1.5, powerUpsEnabled: true },
  marathon: { id: 'marathon', name: 'Marathon', tagline: 'Five lives for long chains.', turnSeconds: 14, minTurnSeconds: 14, lives: 5, scoreMultiplier: 1, powerUpsEnabled: true },
  roulette: { id: 'roulette', name: 'Roulette', tagline: 'The category changes every three words.', turnSeconds: 12, minTurnSeconds: 12, lives: 3, scoreMultiplier: 1.25, powerUpsEnabled: true },
};

export function getMode(value: string | null | undefined): GameMode { return value && value in gameModes ? gameModes[value as GameModeId] : gameModes.classic; }
function selectedMode(mode: GameMode | string | null | undefined) { return typeof mode === 'object' && mode !== null ? mode : getMode(mode); }
export function turnSecondsForWord(mode: GameMode | string | null | undefined, wordCount: number) { const selected = selectedMode(mode); return selected.id === 'survival' ? Math.max(selected.minTurnSeconds, selected.turnSeconds - Math.max(0, wordCount) * 0.3) : selected.turnSeconds; }
export function scoreForWord(mode: GameMode | string | null | undefined, word: string, secondsLeft: number) { const selected = selectedMode(mode); return Math.round((word.length * 10 + Math.max(0, Math.ceil(secondsLeft)) * 2) * selected.scoreMultiplier); }
export function categoryForWord(mode: GameMode | string | null | undefined, order: readonly Category[], wordCount: number): Category { const selected = selectedMode(mode); if (!order.length) return 'animals'; return selected.id === 'roulette' ? order[Math.floor(Math.max(0, wordCount) / 3) % order.length] ?? order[0] : order[0] ?? 'animals'; }

export type PowerUpId = 'freeze' | 'reverse' | 'block' | 'shield' | 'skip' | 'steal';
export const powerUps: Record<PowerUpId, { id: PowerUpId; name: string; cost: number; glyph: string; description: string }> = {
  freeze: { id: 'freeze', name: 'Freeze', cost: 14, glyph: '❄', description: 'Halve the next timer.' },
  reverse: { id: 'reverse', name: 'Reverse', cost: 18, glyph: '↺', description: 'Reverse turn order.' },
  block: { id: 'block', name: 'Block', cost: 12, glyph: '⊘', description: 'Block a letter next turn.' },
  shield: { id: 'shield', name: 'Shield', cost: 16, glyph: '◈', description: 'Absorb one wrong answer.' },
  skip: { id: 'skip', name: 'Skip', cost: 10, glyph: '↷', description: 'Pass without losing a life.' },
  steal: { id: 'steal', name: 'Steal', cost: 20, glyph: '⚡', description: 'Take 5 points from the leader.' },
};

export function getPowerUp(value: string | null | undefined) { return value && value in powerUps ? powerUps[value as PowerUpId] : null; }
export function levelForXp(xp: number) { return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1; }
export function xpForLevel(level: number) { return Math.max(0, (Math.max(1, level) - 1) ** 2 * 100); }
