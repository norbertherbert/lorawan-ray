import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return isAllowedOrigin(origin, env)
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : json({ error: 'Origin is not allowed.' }, 403);
    }

    if (request.method !== 'POST' || new URL(request.url).pathname !== '/auth/google') {
      return json({ error: 'Not found.' }, 404, origin, env);
    }

    if (!isAllowedOrigin(origin, env)) {
      return json({ error: 'Origin is not allowed.' }, 403);
    }

    try {
      assertConfiguration(env);
      const body = await request.json();
      const credential = body?.credential;

      if (typeof credential !== 'string' || credential.length > 16_384) {
        return json({ error: 'A valid Google credential is required.' }, 400, origin, env);
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

      const expiresInSeconds = 15 * 60;
      const token = await new SignJWT({
        ns: env.SURREAL_NAMESPACE,
        db: env.SURREAL_DATABASE,
        ac: env.SURREAL_ACCESS,
        id: `user:google_${payload.sub}`,
        sub: payload.sub,
        email: payload.email,
        email_verified: true,
        name: typeof payload.name === 'string' ? payload.name : payload.email,
        picture: typeof payload.picture === 'string' ? payload.picture : undefined,
      })
        .setProtectedHeader({ alg: 'HS512', typ: 'JWT' })
        .setIssuer(env.TOKEN_ISSUER)
        .setAudience(env.TOKEN_AUDIENCE)
        .setIssuedAt()
        .setNotBefore('0s')
        .setExpirationTime(`${expiresInSeconds}s`)
        .setJti(crypto.randomUUID())
        .sign(encoder.encode(env.SURREAL_JWT_SECRET));

      return json(
        {
          token,
          expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
          user: {
            name: typeof payload.name === 'string' ? payload.name : payload.email,
            email: payload.email,
            picture: typeof payload.picture === 'string' ? payload.picture : null,
          },
        },
        200,
        origin,
        env,
      );
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
