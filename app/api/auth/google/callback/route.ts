import { env } from 'cloudflare:workers';
import { getGameDb } from '@/lib/game-db';
import { issueUserSession, requireGuest } from '@/lib/game-session';
import { exchangeGoogleCode, googleOAuthConfig, verifyGoogleIdToken } from '@/lib/google-oauth';

function redirect(location: string, cookie?: string) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

async function hasGuestProgress(db: D1Database, userId: string) {
  const [player, stats, daily] = await db.batch([
    db.prepare('SELECT 1 AS found FROM players WHERE user_id = ? LIMIT 1').bind(userId),
    db.prepare('SELECT 1 AS found FROM player_stats WHERE user_id = ? LIMIT 1').bind(userId),
    db.prepare('SELECT 1 AS found FROM daily_attempts WHERE user_id = ? LIMIT 1').bind(userId),
  ]);
  return Boolean(player.results[0] || stats.results[0] || daily.results[0]);
}

export async function GET(request: Request) {
  const now = Date.now(); const url = new URL(request.url);
  const code = url.searchParams.get('code') ?? ''; const state = url.searchParams.get('state') ?? '';
  const config = googleOAuthConfig(env as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; APP_URL?: string });
  if (!config) return redirect('/?auth=google-unavailable');
  if (!code || code.length > 2048 || !/^[0-9a-f-]{36}$/i.test(state)) return redirect('/?auth=google-failed');
  try {
    const db = await getGameDb();
    const actor = await requireGuest(db, request, now);
    const claimed = await db.prepare('UPDATE oauth_states SET used_at = ? WHERE id = ? AND session_id = ? AND used_at IS NULL AND expires_at > ?').bind(now, state, actor.sessionId, now).run();
    if (claimed.meta.changes !== 1) return redirect('/?auth=google-failed');
    const idToken = await exchangeGoogleCode(code, config.clientId, config.clientSecret, config.redirectUri);
    if (!idToken) return redirect('/?auth=google-failed');
    const identity = await verifyGoogleIdToken(idToken, config.clientId, now);
    if (!identity) return redirect('/?auth=google-failed');
    const existing = await db.prepare('SELECT id, display_name FROM users WHERE google_subject = ?').bind(identity.subject).first<{ id: string; display_name: string }>();
    if (existing && existing.id !== actor.userId) {
      if (await hasGuestProgress(db, actor.userId)) return redirect('/?auth=google-linked-elsewhere');
      const session = await issueUserSession(db, request, existing.id, now);
      await db.prepare('UPDATE guest_sessions SET revoked_at = ? WHERE id = ?').bind(now, actor.sessionId).run();
      return redirect('/?auth=google-signed-in', session.cookie);
    }
    await db.prepare('UPDATE users SET google_subject = ?, google_email = ?, linked_at = ?, updated_at = ? WHERE id = ? AND (google_subject IS NULL OR google_subject = ?)').bind(identity.subject, identity.email, now, now, actor.userId, identity.subject).run();
    return redirect('/?auth=google-linked');
  } catch {
    return redirect('/?auth=google-failed');
  }
}
