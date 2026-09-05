import assert from 'node:assert/strict';
import test from 'node:test';
import { SignJWT } from 'jose';
import worker from '../src/index.js';
import { createSessionCookie } from '../src/session.js';

const origin = 'https://example.com';
const env = {
  GOOGLE_CLIENT_ID: 'test-client', SURREAL_NAMESPACE: 'lorawan',
  SURREAL_DATABASE: 'ray', SURREAL_ACCESS: 'google',
  SURREAL_JWT_SECRET: 'test-secret-'.repeat(8), TOKEN_ISSUER: 'test-issuer',
  TOKEN_AUDIENCE: 'test-database', ALLOWED_ORIGINS: `${origin},https://other.example`,
};

async function token(issuedAt = Math.floor(Date.now() / 1000), lifetime = 3600) {
  return new SignJWT({
    ns: 'lorawan', db: 'ray', ac: 'google', sub: 'test-user',
    id: 'user:google_test-user', name: 'Test User', email: 'test@example.com',
  }).setProtectedHeader({ alg: 'HS512' }).setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetime).setIssuer(env.TOKEN_ISSUER)
    .setAudience(env.TOKEN_AUDIENCE).sign(new TextEncoder().encode(env.SURREAL_JWT_SECRET));
}

function request(path, cookie = '', requestOrigin = origin, contentType = 'application/json') {
  return new Request(`https://auth.example${path}`, {
    method: 'POST', headers: { Origin: requestOrigin, Cookie: cookie, 'Content-Type': contentType }, body: '{}',
  });
}

test('encrypted HttpOnly cookie restores the same token with only its remaining lifetime', async () => {
  const issuedAt = Math.floor(Date.now() / 1000) - 3500;
  const original = await token(issuedAt);
  const setCookie = await createSessionCookie(original, origin, env);
  assert.match(setCookie, /HttpOnly; Secure; SameSite=None; Partitioned/);
  assert.ok(setCookie.length < 4096);
  assert.ok(!setCookie.includes(original));
  const cookie = setCookie.split(';')[0];
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(request('/auth/session', cookie), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Set-Cookie'), null);
    const restored = await response.json();
    assert.equal(restored.token, original);
    assert.equal(Date.parse(restored.expiresAt), (issuedAt + 3600) * 1000);
    assert.ok(Date.parse(restored.expiresAt) - Date.parse(restored.serverTime) <= 100000);
  }
});

test('missing, malformed and foreign-origin session cookies cannot restore login', async () => {
  const cookie = (await createSessionCookie(await token(), origin, env)).split(';')[0];
  for (const [value, from] of [['', origin], ['__Host-ray-session=broken', origin], [cookie, 'https://other.example']]) {
    const response = await worker.fetch(request('/auth/session', value, from), env);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  }
});

test('expired cookies cannot restore login', async (t) => {
  const cookie = (await createSessionCookie(await token(), origin, env)).split(';')[0];
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 3601000 });
  const response = await worker.fetch(request('/auth/session', cookie), env);
  assert.equal(response.status, 401);
});

test('logout clears the cookie with matching path and security attributes', async () => {
  const response = await worker.fetch(request('/auth/logout'), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie'), /__Host-ray-session=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned/);
});

test('session endpoints reject foreign origins and simple cross-site form requests', async () => {
  for (const path of ['/auth/google', '/auth/session', '/auth/logout']) {
    assert.equal((await worker.fetch(request(path, '', 'https://evil.example'), env)).status, 403);
    assert.equal((await worker.fetch(request(path, '', origin, 'text/plain'), env)).status, 415);
  }
});

test('cookie issuance rejects tokens with a lifetime exceeding one hour', async () => {
  await assert.rejects(createSessionCookie(await token(undefined, 7200), origin, env), /lifetime/);
});
