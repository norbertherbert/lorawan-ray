/** Loads Google Identity Services once and resolves when its browser API is available. */
export function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    const script = existing || document.createElement('script');

    script.addEventListener('load', resolve, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('Could not load accounts.google.com.')),
      { once: true },
    );

    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.dataset.googleIdentity = 'true';
      document.head.append(script);
    }
  });
}

/** Reads an invitation once, then removes it from the address bar and browser history. */
export function consumeInvitationFragment() {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  if (!parameters.has('invite')) return { token: null, invalid: false };

  const token = parameters.get('invite') || '';
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return { token: valid ? token : null, invalid: !valid };
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';

  const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  const timePart = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return `${datePart} ${timePart}`;
}

export function generateInvitationToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashInvitationToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function buildInvitationLink(token) {
  return `${window.location.origin}${window.location.pathname}#invite=${token}`;
}

export function errorMessage(error, fallback) {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}

/** Reads a JWT expiry for client-side session UX. SurrealDB still verifies the token. */
export function jwtExpirationTime(token) {
  try {
    const expiration = Number(decodeJwtPayload(token).exp);
    return Number.isFinite(expiration) ? expiration * 1000 : null;
  } catch {
    return null;
  }
}

/** Reads the JWT lifetime without relying on the browser's wall clock. */
export function jwtLifetimeMs(token) {
  try {
    const payload = decodeJwtPayload(token);
    const issuedAt = Number(payload.iat);
    const expiration = Number(payload.exp);
    const lifetime = (expiration - issuedAt) * 1000;
    return Number.isFinite(lifetime) && lifetime > 0 ? lifetime : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('The JWT payload is missing.');

  const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return JSON.parse(atob(padded));
}

/** Matches current structured SurrealDB auth failures and their wrapped causes. */
export function isSessionAuthenticationError(error) {
  const visited = new Set();
  let current = error;

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (current.isTokenExpired === true || current.isInvalidAuth === true) return true;

    const details = current.details;
    const authKind = details?.kind === 'Auth' ? details.details?.kind : null;
    if (['TokenExpired', 'SessionExpired', 'InvalidAuth'].includes(authKind)) return true;

    const message = String(current.message || '');
    if (/\b(?:token|session)\b.*\bexpired\b/i.test(message)) return true;
    // An expired record session can become anonymous on an existing connection.
    // Ordinary permission denials must not sign out an authenticated user.
    if (/\banonymous access not allowed\b/i.test(message)) return true;
    current = current.cause;
  }

  return false;
}
