export type TurnClaim = {
  code: string;
  playerId: string;
  stateVersion: number;
  now: number;
};

/**
 * Acquires a room turn with one conditional D1 update. Clearing turn_player_id
 * closes the interval between the claim and the subsequent move write.
 */
export async function claimRoomTurn(db: D1Database, claim: TurnClaim) {
  const result = await db.prepare(`UPDATE rooms SET state_version = state_version + 1, turn_player_id = NULL, updated_at = ?
    WHERE code = ? AND status = 'active' AND turn_player_id = ? AND state_version = ?`)
    .bind(claim.now, claim.code, claim.playerId, claim.stateVersion)
    .run();
  return result.meta.changes === 1;
}

/** The one-way finalization claim makes stats, XP, and ranking writes idempotent. */
export async function claimRoomFinalization(db: D1Database, code: string) {
  const result = await db.prepare('UPDATE rooms SET stats_recorded = 1 WHERE code = ? AND stats_recorded = 0').bind(code).run();
  return result.meta.changes === 1;
}

export function isHostActionAuthorized(hostPlayerId: string, actorPlayerId: string | null) {
  return actorPlayerId !== null && hostPlayerId === actorPlayerId;
}
