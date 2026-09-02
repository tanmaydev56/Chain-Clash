export type GoogleIdentity = { subject: string; email: string | null };
export type GoogleOAuthConfig = { clientId: string; clientSecret: string; appUrl: string; redirectUri: string };

const googleAuthorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleTokenEndpoint = 'https://oauth2.googleapis.com/token';
const googleTokenInfoEndpoint = 'https://oauth2.googleapis.com/tokeninfo';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

export function googleOAuthConfig(value: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; APP_URL?: string }): GoogleOAuthConfig | null {
  const clientId = value.GOOGLE_CLIENT_ID;
  const clientSecret = value.GOOGLE_CLIENT_SECRET;
  const appUrl = value.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  try {
    const url = new URL(appUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== appUrl || (url.protocol === 'http:' && url.hostname !== 'localhost')) return null;
    return { clientId, clientSecret, appUrl, redirectUri: `${url.origin}/api/auth/google/callback` };
  } catch { return null; }
}

export function googleAuthorizationUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL(googleAuthorizationEndpoint);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export function validateGoogleTokenInfo(value: unknown, clientId: string, now: number): GoogleIdentity | null {
  const token = asRecord(value);
  const subject = typeof token?.sub === 'string' ? token.sub : '';
  const audience = typeof token?.aud === 'string' ? token.aud : '';
  const issuer = typeof token?.iss === 'string' ? token.iss : '';
  const expiresAt = typeof token?.exp === 'string' ? Number(token.exp) * 1000 : Number(token?.exp) * 1000;
  const emailVerified = token?.email_verified === 'true' || token?.email_verified === true;
  const email = typeof token?.email === 'string' && emailVerified ? token.email : null;
  if (!/^[0-9]{8,64}$/.test(subject) || audience !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(issuer) || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { subject, email };
}

export async function exchangeGoogleCode(code: string, clientId: string, clientSecret: string, redirectUri: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(googleTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const payload = asRecord(await response.json().catch(() => null));
  return response.ok && typeof payload?.id_token === 'string' ? payload.id_token : null;
}

export async function verifyGoogleIdToken(idToken: string, clientId: string, now: number, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${googleTokenInfoEndpoint}?id_token=${encodeURIComponent(idToken)}`);
  return response.ok ? validateGoogleTokenInfo(await response.json().catch(() => null), clientId, now) : null;
}
