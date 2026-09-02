import { getPowerUp, type PowerUpId } from './game-modes.ts';

export type PowerUpPlayer = { id: string; score: number; shield: boolean; joinedAt: number };
export type PowerUpState<T extends PowerUpPlayer = PowerUpPlayer> = { turnPlayerId: string | null; status: 'waiting' | 'active' | 'finished'; blockedLetter: string | null; freezeNext: boolean; turnDirection: 1 | -1; usedPowerUpTurnId: string | null; players: T[] };
export type PowerUpResult<T extends PowerUpPlayer = PowerUpPlayer> = { ok: boolean; error?: string; state: PowerUpState<T>; message?: string };

export function applyPowerUp<T extends PowerUpPlayer>(state: PowerUpState<T>, actorId: string, powerUpId: string): PowerUpResult<T> {
  const definition = getPowerUp(powerUpId); const next = structuredClone(state);
  if (!definition) return { ok: false, error: 'Unknown power-up.', state };
  if (next.status !== 'active' || next.turnPlayerId !== actorId) return { ok: false, error: 'Power-ups can only be used on your turn.', state };
  if (next.usedPowerUpTurnId === actorId) return { ok: false, error: 'Only one power-up can be used each turn.', state };
  const actor = next.players.find((player) => player.id === actorId);
  if (!actor) return { ok: false, error: 'Player is not in this room.', state };
  if (definition.id === 'shield') { if (actor.shield) return { ok: false, error: 'Shield is already active.', state }; actor.shield = true; }
  if (definition.id === 'freeze') { if (next.freezeNext) return { ok: false, error: 'A freeze is already queued.', state }; next.freezeNext = true; }
  if (definition.id === 'reverse') next.turnDirection = next.turnDirection === 1 ? -1 : 1;
  if (definition.id === 'block') {
    const letter = next.players.length ? 'z' : null;
    if (!letter) return { ok: false, error: 'No player to block.', state };
    next.blockedLetter = letter;
  }
  if (definition.id === 'steal') {
    const leader = [...next.players].filter((player) => player.id !== actorId).sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)[0];
    if (!leader || leader.score <= 0) return { ok: false, error: 'No opponent has points to steal.', state };
    const amount = Math.min(5, leader.score); leader.score -= amount; actor.score += amount;
  }
  next.usedPowerUpTurnId = actorId;
  return { ok: true, state: next, message: `${definition.glyph} ${definition.name} activated.` };
}

export function clearPowerUpTurn<T extends PowerUpPlayer>(state: PowerUpState<T>): PowerUpState<T> { return { ...state, usedPowerUpTurnId: null }; }
export function powerUpCost(value: string) { return getPowerUp(value as PowerUpId)?.cost ?? null; }
