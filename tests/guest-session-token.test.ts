import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuestSessionToken, verifyGuestSessionToken } from '../lib/guest-session-token.ts';

const secret = 'secure-test-secret-with-at-least-thirty-two-characters';
const sessionId = '123e4567-e89b-12d3-a456-426614174000';

void test('a signed guest session token verifies only with its original secret', async () => {
  const token = await createGuestSessionToken(sessionId, secret);
  assert.equal(await verifyGuestSessionToken(token, secret), sessionId);
  assert.equal(await verifyGuestSessionToken(token, `${secret}-rotated`), null);
});

void test('tampered, unsigned, and malformed guest session tokens are rejected', async () => {
  const token = await createGuestSessionToken(sessionId, secret);
  assert.equal(await verifyGuestSessionToken(`${token.slice(0, -1)}x`, secret), null);
  assert.equal(await verifyGuestSessionToken(sessionId, secret), null);
  assert.equal(await verifyGuestSessionToken('not-a-session.invalid', secret), null);
});
