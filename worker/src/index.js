import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { createSessionCookie, restoreSession, clearSessionCookie } from './session.js';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder = new TextEncoder();
export const SESSION_DURATION_SECONDS = 60 * 60;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return isAllowedOrigin(origin, env)
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : json({ error: 'Origin is not allowed.' }, 403);
    }

    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/auth/google', '/auth/session', '/auth/logout'].includes(path)) {
      return json({ error: 'Not found.' }, 404, origin, env);
    }

    if (!isAllowedOrigin(origin, env)) {
      return json({ error: 'Origin is not allowed.' }, 403);
    }

    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return json({ error: 'JSON requests are required.' }, 415, origin, env);
    }

    if (path === '/auth/logout') {
      const response = json({ signedOut: true }, 200, origin, env);
      response.headers.set('Set-Cookie', clearSessionCookie());
      return response;
    }

    if (path === '/auth/session') {
      try {
        assertConfiguration(env);
        const session = await restoreSession(request, origin, env);
        if (session) return json(session, 200, origin, env);
      } catch {
        // Expired, malformed, or foreign-origin cookies cannot restore a session.
      }
      const response = json({ error: 'No active session.' }, 401, origin, env);
      response.headers.set('Set-Cookie', clearSessionCookie());
      return response;
    }

    try {
      assertConfiguration(env);
      const body = await request.json();
      const credential = body?.credential;
      const invitation = body?.invitation;

      if (typeof credential !== 'string' || credential.length > 16_384) {
        return json({ error: 'A valid Google credential is required.' }, 400, origin, env);
      }

      if (invitation !== undefined && !isValidInvitationToken(invitation)) {
        return json({ error: 'The invitation link is invalid.' }, 400, origin, env);
      }

      const { payload } = await jwtVerify(credential, googleKeys, {
        algorithms: ['RS256'],
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: env.GOOGLE_CLIENT_ID,
      });

      if (
        typeof payload.sub !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub) ||
        payload.email_verified !== true ||
        typeof payload.email !== 'string'
      ) {
        return json({ error: 'The Google account identity is incomplete.' }, 401, origin, env);
      }

      const normalizedEmail = normalizeEmail(payload.email);
      const invitationHash = invitation ? await hashInvitationToken(invitation) : undefined;
      const expiresInSeconds = SESSION_DURATION_SECONDS;
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        ns: env.SURREAL_NAMESPACE,
        db: env.SURREAL_DATABASE,
        ac: env.SURREAL_ACCESS,
        id: `user:google_${payload.sub}`,
        sub: payload.sub,
        email: normalizedEmail,
        email_verified: true,
        name: typeof payload.name === 'string' ? payload.name : payload.email,
        picture: typeof payload.picture === 'string' ? payload.picture : undefined,
        invitation_hash: invitationHash,
      })
        .setProtectedHeader({ alg: 'HS512', typ: 'JWT' })
        .setIssuer(env.TOKEN_ISSUER)
        .setAudience(env.TOKEN_AUDIENCE)
        .setIssuedAt(issuedAt)
        .setNotBefore('0s')
        .setExpirationTime(issuedAt + expiresInSeconds)
        .setJti(crypto.randomUUID())
        .sign(encoder.encode(env.SURREAL_JWT_SECRET));

      const response = json(
        {
          token,
          expiresAt: new Date((issuedAt + expiresInSeconds) * 1000).toISOString(),
          serverTime: new Date().toISOString(),
          user: {
            name: typeof payload.name === 'string' ? payload.name : payload.email,
            email: normalizedEmail,
            picture: typeof payload.picture === 'string' ? payload.picture : null,
          },
        },
        200,
        origin,
        env,
      );
      response.headers.set('Set-Cookie', await createSessionCookie(token, origin, env));
      return response;
    } catch (error) {
      console.error('Authentication failed:', {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: typeof error?.code === 'string' ? error.code : undefined,
        message: error instanceof Error ? error.message : 'Unknown authentication error',
      });
      return json({ error: 'Google authentication failed.' }, 401, origin, env);
    }
  },
};

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function isValidInvitationToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function hashInvitationToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function assertConfiguration(env) {
  const required = [
    'GOOGLE_CLIENT_ID',
    'SURREAL_NAMESPACE',
    'SURREAL_DATABASE',
    'SURREAL_ACCESS',
    'SURREAL_JWT_SECRET',
    'TOKEN_ISSUER',
    'TOKEN_AUDIENCE',
    'ALLOWED_ORIGINS',
  ];
  const missing = required.filter((name) => !env[name]);

  if (missing.length) throw new Error(`Missing Worker configuration: ${missing.join(', ')}`);
  if (env.SURREAL_JWT_SECRET.length < 64) {
    throw new Error('SURREAL_JWT_SECRET must contain at least 64 characters.');
  }
}

function isAllowedOrigin(origin, env) {
  if (!origin || !env.ALLOWED_ORIGINS) return false;
  return env.ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .includes(origin.replace(/\/$/, ''));
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function json(value, status = 200, origin = '', env = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };

  if (isAllowedOrigin(origin, env)) Object.assign(headers, corsHeaders(origin));
  return Response.json(value, { status, headers });
}
