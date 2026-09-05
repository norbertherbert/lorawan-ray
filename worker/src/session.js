import { EncryptJWT, jwtDecrypt, jwtVerify } from 'jose';

const encoder = new TextEncoder();
const COOKIE_NAME = '__Host-ray-session';

async function sessionKey(env) {
  return new Uint8Array(await crypto.subtle.digest(
    'SHA-256', encoder.encode(`lorawan-ray-cookie-v1:${env.SURREAL_JWT_SECRET}`),
  ));
}

async function verifyToken(token, env) {
  const { payload } = await jwtVerify(token, encoder.encode(env.SURREAL_JWT_SECRET), {
    algorithms: ['HS512'], issuer: env.TOKEN_ISSUER, audience: env.TOKEN_AUDIENCE,
    requiredClaims: ['exp', 'iat', 'sub'],
  });
  if (payload.exp - payload.iat > 3600 || payload.exp <= payload.iat ||
      payload.ns !== env.SURREAL_NAMESPACE || payload.db !== env.SURREAL_DATABASE ||
      payload.ac !== env.SURREAL_ACCESS) throw new Error('Invalid session scope or lifetime.');
  return payload;
}

export async function createSessionCookie(token, origin, env) {
  const payload = await verifyToken(token, env);
  const sealed = await new EncryptJWT({ token })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer('lorawan-ray-session').setAudience(origin)
    .setExpirationTime(payload.exp).encrypt(await sessionKey(env));
  const cookie = serializeCookie(sealed, Math.max(0, payload.exp - Math.floor(Date.now() / 1000)));
  if (cookie.length > 4096) throw new Error('Session cookie is too large.');
  return cookie;
}

export async function restoreSession(request, origin, env) {
  const cookie = (request.headers.get('Cookie') || '').split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  const { payload } = await jwtDecrypt(cookie.slice(COOKIE_NAME.length + 1), await sessionKey(env), {
    issuer: 'lorawan-ray-session', audience: origin,
    keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
    requiredClaims: ['exp'],
  });
  const identity = await verifyToken(payload.token, env);
  return {
    token: payload.token,
    expiresAt: new Date(identity.exp * 1000).toISOString(),
    serverTime: new Date().toISOString(),
    user: { name: identity.name, email: identity.email, picture: identity.picture ?? null },
  };
}

function serializeCookie(value, maxAge) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`;
}

export function clearSessionCookie() {
  return serializeCookie('', 0);
}
