import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDate,
  isSessionAuthenticationError,
  jwtExpirationTime,
  stringifyJson,
} from './lib.js';

test('formats browser-local dates with fixed-width components', () => {
  const date = new Date(2026, 7, 6, 4, 5, 9);
  assert.equal(formatDate(date), '2026-08-06 04:05:09');
});

test('omits only the top-level record id from displayed JSON', () => {
  const json = stringifyJson({
    id: 'gateway_rxpk:internal',
    gateway: { id: 'nested-value', gateway_id: '1032547698BADCFE' },
    counter: 12n,
  });

  assert.deepEqual(JSON.parse(json), {
    gateway: { id: 'nested-value', gateway_id: '1032547698BADCFE' },
    counter: '12',
  });
});

test('reads the expiration time from a JWT payload without treating it as verification', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString('base64url');

  assert.equal(jwtExpirationTime(`header.${payload}.signature`), 1_800_000_000_000);
  assert.equal(jwtExpirationTime('not-a-jwt'), null);
});

test('recognizes only session-related authentication errors', () => {
  assert.equal(
    isSessionAuthenticationError({
      details: { kind: 'Auth', details: { kind: 'TokenExpired' } },
    }),
    true,
  );
  assert.equal(
    isSessionAuthenticationError({
      cause: { details: { kind: 'Auth', details: { kind: 'SessionExpired' } } },
    }),
    true,
  );
  assert.equal(
    isSessionAuthenticationError({
      details: {
        kind: 'Auth',
        details: { kind: 'NotAllowed', details: { action: 'view' } },
      },
    }),
    false,
  );
});
