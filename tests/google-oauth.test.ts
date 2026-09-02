import assert from 'node:assert/strict';
import test from 'node:test';
import { googleAuthorizationUrl, googleOAuthConfig, validateGoogleTokenInfo } from '../lib/google-oauth.ts';

const clientId = 'client.apps.googleusercontent.com';
const now = 1_800_000_000_000;

void test('Google authorization URL contains a server-generated state and exact callback', () => {
  const url = new URL(googleAuthorizationUrl(clientId, 'https://play.example.com/api/auth/google/callback', 'state-123'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), clientId);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://play.example.com/api/auth/google/callback');
  assert.equal(url.searchParams.get('state'), 'state-123');
});

void test('Google configuration requires a full trusted application origin', () => {
  assert.deepEqual(googleOAuthConfig({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'secret', APP_URL: 'https://play.example.com' }), {
    clientId, clientSecret: 'secret', appUrl: 'https://play.example.com', redirectUri: 'https://play.example.com/api/auth/google/callback',
  });
  assert.equal(googleOAuthConfig({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'secret', APP_URL: 'https://play.example.com/path' }), null);
  assert.equal(googleOAuthConfig({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'secret', APP_URL: 'http://play.example.com' }), null);
});

void test('Google identity requires a verified Google token audience, issuer, and expiry', () => {
  const token = { sub: '12345678901234567890', aud: clientId, iss: 'https://accounts.google.com', exp: String(Math.floor((now + 60_000) / 1000)), email: 'player@example.com', email_verified: 'true' };
  assert.deepEqual(validateGoogleTokenInfo(token, clientId, now), { subject: token.sub, email: token.email });
  assert.equal(validateGoogleTokenInfo({ ...token, aud: 'another-client' }, clientId, now), null);
  assert.equal(validateGoogleTokenInfo({ ...token, iss: 'https://issuer.invalid' }, clientId, now), null);
  assert.equal(validateGoogleTokenInfo({ ...token, exp: String(Math.floor((now - 1) / 1000)) }, clientId, now), null);
});
