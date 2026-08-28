import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  hashInvitationToken,
  isValidInvitationToken,
  normalizeEmail,
  SESSION_DURATION_SECONDS,
} from '../src/index.js';

test('limits authenticated sessions to one hour', () => {
  assert.equal(SESSION_DURATION_SECONDS, 60 * 60);
});

test('normalizes verified Google email addresses', () => {
  assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com');
});

test('accepts only 32-byte base64url invitation tokens', () => {
  assert.equal(isValidInvitationToken('A'.repeat(43)), true);
  assert.equal(isValidInvitationToken('A'.repeat(42)), false);
  assert.equal(isValidInvitationToken(`${'A'.repeat(42)}+`), false);
  assert.equal(isValidInvitationToken(null), false);
});

test('hashes invitation tokens as unpadded base64url SHA-256', async () => {
  const invitation = 'A'.repeat(43);
  const expected = createHash('sha256').update(invitation).digest('base64url');

  assert.equal(await hashInvitationToken(invitation), expected);
  assert.match(expected, /^[A-Za-z0-9_-]{43}$/);
});
