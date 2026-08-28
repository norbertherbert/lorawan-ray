import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Surreal, Table } from 'surrealdb';
import AdminPanel from './components/AdminPanel.jsx';
import {
  buildInvitationLink,
  consumeInvitationFragment,
  errorMessage,
  generateInvitationToken,
  hashInvitationToken,
  isSessionAuthenticationError,
  jwtExpirationTime,
  loadGoogleIdentityScript,
} from './lib.js';
import { mockUplinkDataSource } from './api/mockUplinks.ts';
import { SurrealUplinkDataSource } from './api/surrealUplinks.ts';
import Analyzer from './pages/Analyzer.tsx';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

const config = {
  endpoint:
    import.meta.env.VITE_SURREAL_ENDPOINT ||
    'wss://nano-things-fre-06fekk904lvvv6p0ocvu8dm7c4.aws-euw1.surreal.cloud',
  namespace: import.meta.env.VITE_SURREAL_NAMESPACE || 'lorawan',
  database: import.meta.env.VITE_SURREAL_DATABASE || 'sniffer',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  authBrokerUrl: (import.meta.env.VITE_AUTH_BROKER_URL || '').replace(/\/$/, ''),
  uplinkSource: useMockData ? 'mock' : 'surreal',
};

const db = new Surreal();
const surrealUplinkDataSource = new SurrealUplinkDataSource(db);
const analyzerDataSource = config.uplinkSource === 'surreal' ? surrealUplinkDataSource : mockUplinkDataSource;
const invitations = new Table('invitation');
const initialInvitation = consumeInvitationFragment();

export default function App() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState({ state: 'offline', text: 'Not connected' });
  const [error, setError] = useState(
    initialInvitation.invalid
      ? 'This invitation link is malformed. Ask the administrator for a new link.'
      : '',
  );
  const [invitationToken, setInvitationToken] = useState(initialInvitation.token);
  const [signedInUser, setSignedInUser] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [activeInvitations, setActiveInvitations] = useState([]);
  const [adminOpen, setAdminOpen] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [adminRefreshing, setAdminRefreshing] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const googleButtonRef = useRef(null);
  const authenticationHandlerRef = useRef(null);
  const sessionExpiresAtRef = useRef(null);
  const sessionExpiryTimerRef = useRef(null);
  const sessionExpiryHandlingRef = useRef(false);

  const approved = currentProfile?.approved === true;
  const isAdmin = approved && currentProfile?.is_admin === true;

  function clearError() {
    setError('');
  }

  function reportError(cause, fallback) {
    console.error(cause);
    setError(errorMessage(cause, fallback));
  }

  function clearSessionExpiry() {
    if (sessionExpiryTimerRef.current !== null) {
      window.clearTimeout(sessionExpiryTimerRef.current);
      sessionExpiryTimerRef.current = null;
    }
    sessionExpiresAtRef.current = null;
  }

  function resetAuthenticatedState() {
    queryClient.removeQueries({ queryKey: ['uplinks'] });
    queryClient.removeQueries({ queryKey: ['uplink'] });
    clearSessionExpiry();
    setSignedInUser(null);
    setCurrentProfile(null);
    setPendingUsers([]);
    setActiveInvitations([]);
    setAdminOpen(false);
  }

  async function expireSession(cause) {
    if (sessionExpiryHandlingRef.current) return;
    sessionExpiryHandlingRef.current = true;
    if (cause) console.warn('The database session expired.', cause);

    try {
      clearSessionExpiry();
      await db.close().catch(() => {});
      window.google?.accounts?.id?.disableAutoSelect();
      resetAuthenticatedState();
      setStatus({ state: 'offline', text: 'Session expired' });
      setError('Your session expired. Sign in again to continue.');
    } finally {
      sessionExpiryHandlingRef.current = false;
    }
  }

  function scheduleSessionExpiry(token, advertisedExpiration) {
    clearSessionExpiry();
    const advertisedExpiresAt = Date.parse(advertisedExpiration || '');
    const expiresAt = Number.isFinite(advertisedExpiresAt)
      ? advertisedExpiresAt
      : jwtExpirationTime(token);
    if (expiresAt === null) return;

    sessionExpiresAtRef.current = expiresAt;
    const delay = Math.max(0, expiresAt - Date.now());
    sessionExpiryTimerRef.current = window.setTimeout(() => void expireSession(), delay);
  }

  function requireActiveSession() {
    const expiresAt = sessionExpiresAtRef.current;
    if (expiresAt === null || Date.now() < expiresAt) return true;

    void expireSession();
    return false;
  }

  function checkSessionExpiry() {
    const expiresAt = sessionExpiresAtRef.current;
    if (expiresAt !== null && Date.now() >= expiresAt) void expireSession();
  }

  async function handleDatabaseError(cause, fallback) {
    const expiresAt = sessionExpiresAtRef.current;
    if (
      (expiresAt !== null && Date.now() >= expiresAt) ||
      isSessionAuthenticationError(cause)
    ) {
      await expireSession(cause);
      return;
    }
    reportError(cause, fallback);
  }

  async function loadCurrentProfile() {
    const [profiles] = await db.query(
      'SELECT id, email, name, picture, approved, approved_at, is_admin FROM user WHERE id = $auth.id',
    );
    const profile = profiles?.[0];
    if (!profile) throw new Error('Your user profile could not be loaded.');
    return profile;
  }

  async function loadAdminData() {
    if (!currentProfile?.is_admin) return false;
    if (!requireActiveSession()) return false;

    clearError();
    setAdminRefreshing(true);

    try {
      const [nextPendingUsers, nextActiveInvitations] = await db.query(`
        SELECT id, email, name, created_at, last_login
          FROM user WHERE approved = false ORDER BY created_at ASC;
        SELECT id, email, status, expires_at, created_at
          FROM invitation
          WHERE status = "pending" AND expires_at > time::now()
          ORDER BY created_at DESC;
      `);
      setPendingUsers(nextPendingUsers);
      setActiveInvitations(nextActiveInvitations);
      return true;
    } catch (cause) {
      await handleDatabaseError(cause, 'Could not load administrator data.');
      return false;
    } finally {
      setAdminRefreshing(false);
    }
  }

  async function authenticateWithGoogle({ credential }) {
    clearError();
    setStatus({ state: 'connecting', text: 'Signing in…' });
    setGoogleBusy(true);

    try {
      const response = await fetch(`${config.authBrokerUrl}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, invitation: invitationToken || undefined }),
        credentials: 'omit',
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || typeof result.token !== 'string') {
        throw new Error(result.error || 'The authentication broker rejected this sign-in.');
      }

      await db.connect(config.endpoint, {
        namespace: config.namespace,
        database: config.database,
        reconnect: true,
      });
      await db.authenticate(result.token);

      const profile = await loadCurrentProfile();
      scheduleSessionExpiry(result.token, result.expiresAt);
      setSignedInUser(result.user || null);
      setCurrentProfile(profile);
      setInvitationToken(null);
      setAdminOpen(false);

      const name = profile.name || result.user?.name;
      if (profile.approved) {
        setStatus({ state: 'online', text: name ? `Signed in · ${name}` : 'Signed in' });
      } else {
        setStatus({
          state: 'pending',
          text: name ? `Pending · ${name}` : 'Approval pending',
        });
      }
    } catch (cause) {
      clearSessionExpiry();
      setStatus({ state: 'offline', text: 'Sign-in failed' });
      reportError(cause, 'Could not sign in.');
      await db.close().catch(() => {});
    } finally {
      setGoogleBusy(false);
    }
  }

  authenticationHandlerRef.current = authenticateWithGoogle;

  useEffect(() => {
    const missing = [
      !config.googleClientId && 'VITE_GOOGLE_CLIENT_ID',
      !config.authBrokerUrl && 'VITE_AUTH_BROKER_URL',
    ].filter(Boolean);

    if (missing.length) {
      setStatus({ state: 'offline', text: 'Setup required' });
      setError(
        `Missing ${missing.join(' and ')}. Copy .env.example to .env.local and add the deployment values.`,
      );
      return undefined;
    }

    let cancelled = false;
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: (payload) => authenticationHandlerRef.current?.(payload),
          cancel_on_tap_outside: true,
        });
        googleButtonRef.current?.replaceChildren();
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          width: Math.min(360, googleButtonRef.current?.clientWidth || 360),
        });
        setStatus({ state: 'offline', text: 'Signed out' });
      })
      .catch((cause) => reportError(cause, 'Google Sign-In could not be loaded.'));

    const closeConnection = () => void db.close().catch(() => {});
    window.addEventListener('pagehide', closeConnection);
    window.addEventListener('focus', checkSessionExpiry);
    document.addEventListener('visibilitychange', checkSessionExpiry);

    return () => {
      cancelled = true;
      clearSessionExpiry();
      window.removeEventListener('pagehide', closeConnection);
      window.removeEventListener('focus', checkSessionExpiry);
      document.removeEventListener('visibilitychange', checkSessionExpiry);
    };
  }, []);

  async function checkApproval() {
    if (!requireActiveSession()) return;
    clearError();
    setApprovalBusy(true);

    try {
      const profile = await loadCurrentProfile();
      setCurrentProfile(profile);
      if (profile.approved) {
        setStatus({
          state: 'online',
          text: profile.name ? `Signed in · ${profile.name}` : 'Signed in',
        });
      } else {
        setStatus({ state: 'pending', text: 'Still awaiting approval' });
      }
    } catch (cause) {
      await handleDatabaseError(cause, 'Could not check approval.');
    } finally {
      setApprovalBusy(false);
    }
  }

  async function logout() {
    clearError();
    setLogoutBusy(true);

    try {
      await db.invalidate().catch(() => {});
      await db.close();
    } catch (cause) {
      reportError(cause, 'The connection could not be closed cleanly.');
    } finally {
      window.google?.accounts?.id?.disableAutoSelect();
      resetAuthenticatedState();
      setLogoutBusy(false);
      setStatus({ state: 'offline', text: 'Signed out' });
    }
  }

  async function toggleAdminPanel() {
    const opening = !adminOpen;
    setAdminOpen(opening);
    if (opening) await loadAdminData();
  }

  async function approveUser(user) {
    if (!requireActiveSession()) return;
    clearError();
    try {
      await db.update(user.id).merge({ approved: true, approved_at: new Date() });
      await loadAdminData();
    } catch (cause) {
      await handleDatabaseError(cause, 'Could not approve the user.');
    }
  }

  async function revokeInvitation(invitation) {
    if (!requireActiveSession()) return;
    clearError();
    try {
      await db.update(invitation.id).merge({ status: 'revoked' });
      await loadAdminData();
    } catch (cause) {
      await handleDatabaseError(cause, 'Could not revoke the invitation.');
    }
  }

  async function createInvitation(email, days) {
    if (!requireActiveSession()) return null;
    clearError();
    try {
      const invitation = generateInvitationToken();
      const tokenHash = await hashInvitationToken(invitation);
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      await db.query(
        'UPDATE invitation SET status = "revoked" WHERE email = $email AND status = "pending"',
        { email },
      );
      await db.create(invitations).content({
        email,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
      });

      await loadAdminData();
      return buildInvitationLink(invitation);
    } catch (cause) {
      await handleDatabaseError(cause, 'Could not create the invitation.');
      return null;
    }
  }

  return (
    <>
      <main className="shell">
        <header className="hero">
          <div>
            <p className="eyebrow">SurrealDB Cloud</p>
            <h1>LoRaWAN Ray</h1>
          </div>
          <div className="session-actions">
            <div className="status" data-state={status.state}>
              <span className="status-dot" aria-hidden="true" />
              <span>{status.text}</span>
            </div>
            <button
              className="admin-toggle-button"
              type="button"
              aria-controls="admin-card"
              aria-expanded={adminOpen}
              onClick={toggleAdminPanel}
              hidden={!isAdmin}
            >
              {adminOpen ? 'Close admin' : 'Users & invitations'}
            </button>
            <button
              className="logout-button"
              type="button"
              onClick={logout}
              disabled={logoutBusy}
              hidden={!currentProfile}
            >
              {logoutBusy ? 'Logging out…' : 'Logout'}
            </button>
          </div>
        </header>

        <section className="card connection-card" hidden={Boolean(currentProfile)}>
          <div className="section-heading">
            <div>
              <p className="section-label">Connection</p>
              <h2>Sign in to the demo</h2>
            </div>
          </div>

          <div className="google-signin">
            <div
              ref={googleButtonRef}
              id="google-button"
              className={googleBusy ? 'is-busy' : ''}
              aria-label="Sign in with Google"
            />
            <p className="invitation-notice" hidden={!invitationToken}>
              Invitation detected. Sign in with the invited Google account to accept it.
            </p>
            <p className="hint">
              Google verifies your identity. A short-lived token grants approved, read-only
              access; no database password is sent to this page.
            </p>
          </div>
        </section>

        <section className="card pending-card" hidden={!currentProfile || approved}>
          <div className="section-heading">
            <div>
              <p className="section-label">Registration</p>
              <h2>Awaiting approval</h2>
            </div>
            <span className="number">02</span>
          </div>
          <p className="pending-copy">
            Your Google account <strong>{currentProfile?.email || signedInUser?.email || ''}</strong>{' '}
            is registered, but an administrator must approve it before gateway receptions become
            available.
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={checkApproval}
            disabled={approvalBusy}
          >
            {approvalBusy ? 'Checking…' : 'Check approval'}
          </button>
        </section>

        {approved && !adminOpen ? (
          <Analyzer
            dataSource={analyzerDataSource}
            sourceKey={`${config.uplinkSource}-v1`}
            sourceLabel={config.uplinkSource === 'mock' ? 'Mock data' : undefined}
            requireActiveSession={requireActiveSession}
            onDatabaseError={handleDatabaseError}
          />
        ) : null}

        {isAdmin && adminOpen ? (
          <AdminPanel
            pendingUsers={pendingUsers}
            activeInvitations={activeInvitations}
            refreshing={adminRefreshing}
            onRefresh={loadAdminData}
            onApprove={approveUser}
            onRevoke={revokeInvitation}
            onCreateInvitation={createInvitation}
            onError={reportError}
          />
        ) : null}

        <p className="error-message" role="alert" hidden={!error}>
          {error}
        </p>
      </main>

    </>
  );
}
