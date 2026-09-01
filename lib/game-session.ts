import { env } from 'cloudflare:workers';
import { createGuestSessionToken, verifyGuestSessionToken } from '@/lib/guest-session-token';

const cookieName = 'chain_clash_guest';

function secret() {
  const value = (env as { GUEST_SESSION_SECRET?: string }).GUEST_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('Guest sessions are unavailable. Configure GUEST_SESSION_SECRET.');
  return value;
}

function readCookie(request: Request) {
  const value = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return value ? decodeURIComponent(value) : null;
}

export async function guestSessionId(request: Request) {
  const cookie = readCookie(request); if (!cookie) return null;
  return verifyGuestSessionToken(cookie, secret());
}

function cookieAttributes(request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function issueGuestSession(db: D1Database, request: Request, name: string, now: number) {
  const userId = crypto.randomUUID(); const sessionId = crypto.randomUUID(); const expiresAt = now + 1000 * 60 * 60 * 24 * 365;
  await db.batch([
    db.prepare('INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(userId, name, now, now),
    db.prepare('INSERT INTO guest_sessions (id, user_id, expires_at, revoked_at, created_at) VALUES (?, ?, ?, NULL, ?)').bind(sessionId, userId, expiresAt, now),
  ]);
  return { userId, sessionId, expiresAt, cookie: `${cookieName}=${encodeURIComponent(await createGuestSessionToken(sessionId, secret()))}; ${cookieAttributes(request, 31536000)}` };
}

export async function requireGuest(db: D1Database, request: Request, now: number) {
  const sessionId = await guestSessionId(request);
  if (!sessionId) throw new Error('Your guest session is missing or expired. Refresh to start a new guest profile.');
  const row = await db.prepare(`SELECT guest_sessions.user_id, users.display_name FROM guest_sessions JOIN users ON users.id = guest_sessions.user_id
    WHERE guest_sessions.id = ? AND guest_sessions.revoked_at IS NULL AND guest_sessions.expires_at > ?`).bind(sessionId, now).first<{ user_id: string; display_name: string }>();
  if (!row) throw new Error('Your guest session is missing or expired. Refresh to start a new guest profile.');
  return { sessionId, userId: row.user_id, name: row.display_name };
}

export function clearGuestSession(request: Request) { return `${cookieName}=; ${cookieAttributes(request, 0)}`; }
