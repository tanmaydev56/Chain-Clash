const encoder = new TextEncoder();

export type RealtimeTicket = { roomCode: string; userId: string; sessionId: string; playerId: string; nonce: string; expiresAt: number };

function bytesToBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch { return null; }
}

async function hmac(value: string, secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function createRealtimeTicket(ticket: RealtimeTicket, secret: string) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(ticket)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmac(payload, secret, ['sign']), encoder.encode(payload)));
  return `${payload}.${bytesToBase64Url(signature)}`;
}

export async function verifyRealtimeTicket(token: string, secret: string, now = Date.now()) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const signatureBytes = base64UrlToBytes(signature);
  if (!signatureBytes) return null;
  const valid = await crypto.subtle.verify('HMAC', await hmac(payload, secret, ['verify']), signatureBytes, encoder.encode(payload));
  if (!valid) return null;
  const payloadBytes = base64UrlToBytes(payload);
  if (!payloadBytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<RealtimeTicket>;
    if (typeof parsed.roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(parsed.roomCode) || typeof parsed.userId !== 'string' || !parsed.userId || typeof parsed.sessionId !== 'string' || !parsed.sessionId || typeof parsed.playerId !== 'string' || !parsed.playerId || typeof parsed.nonce !== 'string' || !parsed.nonce || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= now) return null;
    return { roomCode: parsed.roomCode, userId: parsed.userId, sessionId: parsed.sessionId, playerId: parsed.playerId, nonce: parsed.nonce, expiresAt: parsed.expiresAt } satisfies RealtimeTicket;
  } catch { return null; }
}
