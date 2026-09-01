import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeTicket, verifyRealtimeTicket, type RealtimeTicket } from '../lib/realtime-ticket.ts';

const secret = 'test-only-secret-that-is-longer-than-thirty-two-bytes';
const now = 1_800_000_000_000;
const claim: RealtimeTicket = {
  roomCode: 'ABC123', userId: 'user-a', sessionId: 'session-a', playerId: 'player-a', nonce: 'nonce-a', expiresAt: now + 60_000,
};

void test('valid realtime ticket preserves its room, player, session, expiry, and nonce claims', async () => {
  const token = await createRealtimeTicket(claim, secret);
  assert.deepEqual(await verifyRealtimeTicket(token, secret, now), claim);
});

void test('expired realtime ticket is rejected', async () => {
  const token = await createRealtimeTicket({ ...claim, expiresAt: now - 1 }, secret);
  assert.equal(await verifyRealtimeTicket(token, secret, now), null);
});

void test('tampered and partially malformed realtime tickets are rejected', async () => {
  const token = await createRealtimeTicket(claim, secret);
  const [payload, signature] = token.split('.');
  assert.equal(await verifyRealtimeTicket(`${payload}x.${signature}`, secret, now), null);
  assert.equal(await verifyRealtimeTicket(`${token}.extra`, secret, now), null);
  assert.equal(await verifyRealtimeTicket(token, `${secret}-wrong`, now), null);
});

void test('ticket claims cannot be changed to access another room or player', async () => {
  const token = await createRealtimeTicket(claim, secret);
  const verified = await verifyRealtimeTicket(token, secret, now);
  assert.equal(verified?.roomCode === 'OTHER1', false);
  assert.equal(verified?.playerId === 'player-b', false);
});
