import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Dropdown,
  DropdownItem,
  Navbar,
  NavbarBrand,
  NavbarCollapse,
  NavbarLink,
  NavbarToggle,
} from 'flowbite-react';
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
  jwtLifetimeMs,
  loadGoogleIdentityScript,
} from './lib.js';
import { mockUplinkDataSource } from './api/mockUplinks.ts';
import { SurrealUplinkDataSource } from './api/surrealUplinks.ts';
import { SurrealSavedFilterDataSource } from './api/savedFilters.ts';
import Analyzer from './pages/Analyzer.tsx';
import PacketErrorRate from './pages/PacketErrorRate.tsx';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

function initialDarkMode() {
  try {
    const savedTheme = window.localStorage.getItem('lorawan-ray-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      const dark = savedTheme === 'dark';
      document.documentElement.classList.toggle('dark', dark);
      return dark;
    }
  } catch {
    // Fall back to the operating-system preference when storage is unavailable.
  }

  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
  return dark;
}

const config = {
  endpoint:
    import.meta.env.VITE_SURREAL_ENDPOINT ||
    'wss://nano-things-fre-06fekk904lvvv6p0ocvu8dm7c4.aws-euw1.surreal.cloud',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  authBrokerUrl: (import.meta.env.VITE_AUTH_BROKER_URL || '').replace(/\/$/, ''),
  uplinkSource: useMockData ? 'mock' : 'surreal',
};

const db = new Surreal();
const surrealUplinkDataSource = new SurrealUplinkDataSource(db);
const savedFilterDataSource = new SurrealSavedFilterDataSource(db);
const analyzerDataSource = config.uplinkSource === 'surreal' ? surrealUplinkDataSource : mockUplinkDataSource;
const invitations = new Table('invitation');
const initialInvitation = consumeInvitationFragment();

export default function App() {
  const queryClient = useQueryClient();
  const [, setStatus] = useState({ state: 'offline', text: 'Not connected' });
  const [error, setError] = useState(
    initialInvitation.invalid
      ? 'This invitation link is malformed. Ask the administrator for a new link.'
      : '',
  );
  const [invitationToken, setInvitationToken] = useState(initialInvitation.token);
  const [signedInUser, setSignedInUser] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [activeInvitations, setActiveInvitations] = useState([]);
  const [selfRegistrationEnabled, setSelfRegistrationEnabled] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [perOpen, setPerOpen] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [adminRefreshing, setAdminRefreshing] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [darkMode, setDarkMode] = useState(initialDarkMode);
  const googleButtonRef = useRef(null);
  const googleInitializedRef = useRef(false);
  const authenticationHandlerRef = useRef(null);
  const sessionExpiresAtRef = useRef(null);
  const sessionExpiryTimerRef = useRef(null);
  const sessionExpiryHandlingRef = useRef(false);

  const approved = currentProfile?.approved === true;
  const isAdmin = approved && currentProfile?.is_admin === true;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      window.localStorage.setItem('lorawan-ray-theme', darkMode ? 'dark' : 'light');
    } catch {
      // The selected theme still applies for this page session.
    }
  }, [darkMode]);

  function clearError() {
    setError('');
  }

  function renderGoogleButton(useDarkMode = darkMode) {
    if (!googleInitializedRef.current || !window.google?.accounts?.id || !googleButtonRef.current) {
      return;
    }

    googleButtonRef.current.replaceChildren();
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      type: 'standard',
      theme: useDarkMode ? 'filled_black' : 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      width: Math.min(360, googleButtonRef.current.clientWidth || 360),
    });
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
    queryClient.removeQueries({ queryKey: ['saved-filters'] });
    clearSessionExpiry();
    setSignedInUser(null);
    setCurrentProfile(null);
    setRegisteredUsers([]);
    setPendingUsers([]);
    setActiveInvitations([]);
    setSelfRegistrationEnabled(false);
    setAdminOpen(false);
    setPerOpen(false);
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
    const lifetime = jwtLifetimeMs(token);
    const advertisedExpiresAt = Date.parse(advertisedExpiration || '');
    const expiresAt = lifetime !== null
      ? Date.now() + lifetime
      : Number.isFinite(advertisedExpiresAt)
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
      const [nextRegisteredUsers, nextPendingUsers, nextActiveInvitations, registrationConfig] =
        await db.query(`
        SELECT id, email, name, approved, is_admin, created_at, last_login
          FROM user ORDER BY is_admin DESC, email ASC;
        SELECT id, email, name, created_at, last_login
          FROM user WHERE approved = false ORDER BY created_at ASC;
        SELECT id, email, status, expires_at, created_at
          FROM invitation
          WHERE status = "pending" AND expires_at > time::now()
          ORDER BY created_at DESC;
        SELECT open_registration FROM ONLY auth_config:registration;
      `);
      setRegisteredUsers(nextRegisteredUsers);
      setPendingUsers(nextPendingUsers);
      setActiveInvitations(nextActiveInvitations);
      setSelfRegistrationEnabled(registrationConfig?.open_registration === true);
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
        googleInitializedRef.current = true;
        renderGoogleButton(darkMode);
        setStatus({ state: 'offline', text: 'Signed out' });
      })
      .catch((cause) => reportError(cause, 'Google Sign-In could not be loaded.'));

    const closeConnection = () => void db.close().catch(() => {});
    window.addEventListener('pagehide', closeConnection);
    window.addEventListener('focus', checkSessionExpiry);
    document.addEventListener('visibilitychange', checkSessionExpiry);

    return () => {
      cancelled = true;
      googleInitializedRef.current = false;
      clearSessionExpiry();
      window.removeEventListener('pagehide', closeConnection);
      window.removeEventListener('focus', checkSessionExpiry);
      document.removeEventListener('visibilitychange', checkSessionExpiry);
    };
  }, []);

  useEffect(() => {
    renderGoogleButton(darkMode);
  }, [darkMode]);

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

  function showAnalyzer() {
    setAdminOpen(false);
    setPerOpen(false);
  }

  function showPacketErrorRate() {
    setAdminOpen(false);
    setPerOpen(true);
  }

  async function showAdminPanel() {
    if (adminOpen && !perOpen) return;
    setPerOpen(false);
    setAdminOpen(true);
    await loadAdminData();
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

  async function deleteUser(user) {
    if (!requireActiveSession()) return;
    if (user.id.toString() === currentProfile?.id?.toString()) {
      setError('You cannot delete your own administrator account.');
      return;
    }

    clearError();
    try {
      await db.delete(user.id);
      await loadAdminData();
    } catch (cause) {
      await handleDatabaseError(cause, 'Could not delete the user.');
    }
  }

  async function setSelfRegistration(enabled) {
    if (!requireActiveSession()) return;
    clearError();
    try {
      await db.query(
        'UPSERT ONLY auth_config:registration SET open_registration = $enabled',
        { enabled },
      );
      await loadAdminData();
    } catch (cause) {
      await handleDatabaseError(cause, 'Could not change the self-registration setting.');
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
      <Navbar fluid border className="app-navbar">
        <NavbarBrand as="div" className="brand">
          <h1>LoRaWAN Ray</h1>
          <img
            className="brand-mark"
            src={`${import.meta.env.BASE_URL}lorawan-ray-mark.png`}
            alt=""
            aria-hidden="true"
          />
        </NavbarBrand>
        <div className="session-actions">
          {approved ? <NavbarToggle /> : null}
          {currentProfile ? (
            <Dropdown
              inline
              label={(
                <span className="user-menu-label">
                  {currentProfile.name || signedInUser?.name || currentProfile.email || signedInUser?.email || 'Account'}
                </span>
              )}
              placement="bottom-end"
            >
              <DropdownItem onClick={logout} disabled={logoutBusy}>
                {logoutBusy ? 'Logging out…' : 'Logout'}
              </DropdownItem>
            </Dropdown>
          ) : null}
          <button
            className="theme-toggle"
            type="button"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setDarkMode((current) => !current)}
          >
            {darkMode ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />
              </svg>
            )}
          </button>
        </div>
        {approved ? (
          <NavbarCollapse className="app-nav-tabs">
            <NavbarLink as="button" active={!adminOpen && !perOpen} onClick={showAnalyzer}>
              Sniffer
            </NavbarLink>
            <NavbarLink as="button" active={perOpen} onClick={showPacketErrorRate}>
              PER
            </NavbarLink>
            {isAdmin ? (
              <NavbarLink as="button" active={adminOpen} onClick={showAdminPanel}>
                Admin
              </NavbarLink>
            ) : null}
          </NavbarCollapse>
        ) : null}
      </Navbar>

      <main className={`shell${approved && !adminOpen && !perOpen ? ' analyzer-shell' : ''}`}>

        <Card className="connection-card" hidden={Boolean(currentProfile)}>
          <h2 className="text-lg font-bold tracking-tight text-gray-900">Sign in</h2>

          <div className="google-signin">
            <div
              ref={googleButtonRef}
              id="google-button"
              className={googleBusy ? 'is-busy' : ''}
              aria-label="Sign in with Google"
            />
            {invitationToken ? (
              <Alert color="success">
                Invitation detected. Sign in with the invited Google account to accept it.
              </Alert>
            ) : null}
            <p className="text-sm text-gray-500">
              Google verifies your identity. A short-lived token grants approved, read-only
              access; no database password is sent to this page.
            </p>
          </div>
        </Card>

        <Card className="pending-card" hidden={!currentProfile || approved}>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">Awaiting approval</h2>
          <p className="text-gray-500">
            Your Google account <strong>{currentProfile?.email || signedInUser?.email || ''}</strong>{' '}
            is registered, but an administrator must approve it before gateway receptions become
            available.
          </p>
          <Button
            color="light"
            size="xs"
            type="button"
            onClick={checkApproval}
            disabled={approvalBusy}
          >
            {approvalBusy ? 'Checking…' : 'Check approval'}
          </Button>
        </Card>

        {approved && !adminOpen && !perOpen ? (
          <Analyzer
            dataSource={analyzerDataSource}
            sourceKey={`${config.uplinkSource}-v1`}
            sourceLabel={config.uplinkSource === 'mock' ? 'Mock data' : undefined}
            savedFilterDataSource={savedFilterDataSource}
            currentUserId={currentProfile.id.toString()}
            requireActiveSession={requireActiveSession}
            onDatabaseError={handleDatabaseError}
          />
        ) : null}

        {approved && perOpen ? <PacketErrorRate /> : null}

        {isAdmin && adminOpen ? (
          <AdminPanel
            registeredUsers={registeredUsers}
            pendingUsers={pendingUsers}
            activeInvitations={activeInvitations}
            currentUserId={currentProfile.id}
            selfRegistrationEnabled={selfRegistrationEnabled}
            refreshing={adminRefreshing}
            onRefresh={loadAdminData}
            onApprove={approveUser}
            onDeleteUser={deleteUser}
            onSetSelfRegistration={setSelfRegistration}
            onRevoke={revokeInvitation}
            onCreateInvitation={createInvitation}
            onError={reportError}
          />
        ) : null}

        {error ? <Alert className="mt-4" color="failure">{error}</Alert> : null}
      </main>

    </>
  );
}
