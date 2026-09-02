import { env } from 'cloudflare:workers';
import { getGameDb } from '@/lib/game-db';
import { requireGuest } from '@/lib/game-session';
import { googleAuthorizationUrl, googleOAuthConfig } from '@/lib/google-oauth';

function redirect(location: string) { return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } }); }

export async function GET(request: Request) {
  const now = Date.now();
  const config = googleOAuthConfig(env as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; APP_URL?: string });
  if (!config) return redirect('/?auth=google-unavailable');
  try {
    const db = await getGameDb();
    const actor = await requireGuest(db, request, now);
    const state = crypto.randomUUID();
    await db.prepare('INSERT INTO oauth_states (id, session_id, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').bind(state, actor.sessionId, now + 10 * 60_000, now).run();
    return redirect(googleAuthorizationUrl(config.clientId, config.redirectUri, state));
  } catch {
    return redirect('/?auth=google-session-expired');
  }
}
