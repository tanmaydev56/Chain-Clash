const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
  try { return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)); } catch { return null; }
}

async function signingKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function createGuestSessionToken(sessionId: string, secret: string) {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret, ['sign']), encoder.encode(sessionId)));
  return `${sessionId}.${encodeBase64Url(bytes)}`;
}

/** Returns the session id only after WebCrypto's constant-time HMAC verification. */
export async function verifyGuestSessionToken(token: string, secret: string) {
  const [sessionId, signature] = token.split('.');
  if (!sessionId || !signature || !/^[a-f0-9-]{36}$/i.test(sessionId)) return null;
  const signatureBytes = decodeBase64Url(signature);
  if (!signatureBytes) return null;
  const valid = await crypto.subtle.verify('HMAC', await signingKey(secret, ['verify']), signatureBytes, encoder.encode(sessionId));
  return valid ? sessionId : null;
}
