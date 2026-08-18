import { RecordId, Surreal, Table } from 'surrealdb';
import './style.css';

const config = {
  endpoint:
    import.meta.env.VITE_SURREAL_ENDPOINT ||
    'wss://nano-things-fre-06fekk904lvvv6p0ocvu8dm7c4.aws-euw1.surreal.cloud',
  namespace: import.meta.env.VITE_SURREAL_NAMESPACE || 'main',
  database: import.meta.env.VITE_SURREAL_DATABASE || 'main',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  authBrokerUrl: (import.meta.env.VITE_AUTH_BROKER_URL || '').replace(/\/$/, ''),
};

const db = new Surreal();
const todos = new Table('todo');
const invitations = new Table('invitation');
const invitationFromUrl = consumeInvitationFragment();

const elements = {
  connectionCard: document.querySelector('#connection-card'),
  googleButton: document.querySelector('#google-button'),
  invitationNotice: document.querySelector('#invitation-notice'),
  pendingCard: document.querySelector('#pending-card'),
  pendingEmail: document.querySelector('#pending-email'),
  checkApprovalButton: document.querySelector('#check-approval-button'),
  tasksCard: document.querySelector('#tasks-card'),
  taskForm: document.querySelector('#task-form'),
  taskInput: document.querySelector('#new-task'),
  taskList: document.querySelector('#task-list'),
  taskCount: document.querySelector('#task-count'),
  emptyState: document.querySelector('#empty-state'),
  refreshButton: document.querySelector('#refresh-button'),
  adminCard: document.querySelector('#admin-card'),
  refreshAdminButton: document.querySelector('#refresh-admin-button'),
  pendingUserList: document.querySelector('#pending-user-list'),
  pendingUserEmpty: document.querySelector('#pending-user-empty'),
  inviteForm: document.querySelector('#invite-form'),
  inviteEmail: document.querySelector('#invite-email'),
  inviteExpiry: document.querySelector('#invite-expiry'),
  inviteResult: document.querySelector('#invite-result'),
  inviteLink: document.querySelector('#invite-link'),
  copyInviteButton: document.querySelector('#copy-invite-button'),
  invitationList: document.querySelector('#invitation-list'),
  invitationEmpty: document.querySelector('#invitation-empty'),
  logoutButton: document.querySelector('#logout-button'),
  status: document.querySelector('#status'),
  statusText: document.querySelector('#status-text'),
  error: document.querySelector('#error-message'),
};

let tasks = [];
let signedInUser = null;
let currentProfile = null;
let pendingUsers = [];
let activeInvitations = [];
let invitationToken = invitationFromUrl.token;

elements.logoutButton.addEventListener('click', logout);
elements.checkApprovalButton.addEventListener('click', checkApproval);
elements.taskForm.addEventListener('submit', createTask);
elements.refreshButton.addEventListener('click', loadTasks);
elements.taskList.addEventListener('change', toggleTask);
elements.taskList.addEventListener('click', deleteTask);
elements.refreshAdminButton.addEventListener('click', loadAdminData);
elements.inviteForm.addEventListener('submit', createInvitation);
elements.copyInviteButton.addEventListener('click', copyInvitationLink);
elements.pendingUserList.addEventListener('click', approveUser);
elements.invitationList.addEventListener('click', revokeInvitation);
window.addEventListener('pagehide', () => {
  void db.close().catch(() => {});
});

void initializeSignIn();

/** Loads Google Identity Services and renders its official sign-in button. */
async function initializeSignIn() {
  const missing = [
    !config.googleClientId && 'VITE_GOOGLE_CLIENT_ID',
    !config.authBrokerUrl && 'VITE_AUTH_BROKER_URL',
  ].filter(Boolean);

  if (missing.length) {
    setStatus('offline', 'Setup required');
    showMessage(
      `Missing ${missing.join(' and ')}. Copy .env.example to .env.local and add the deployment values.`,
    );
    return;
  }

  try {
    await loadGoogleIdentityScript();
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: authenticateWithGoogle,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(elements.googleButton, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      width: Math.min(360, elements.googleButton.clientWidth || 360),
    });
    elements.invitationNotice.hidden = !invitationToken;
    setStatus('offline', 'Signed out');

    if (invitationFromUrl.invalid) {
      showMessage('This invitation link is malformed. Ask the administrator for a new link.');
    }
  } catch (error) {
    showError(error, 'Google Sign-In could not be loaded.');
  }
}

/** Resolves after the Google Identity Services browser library is available. */
function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    const script = existing || document.createElement('script');

    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('Could not load accounts.google.com.')), {
      once: true,
    });

    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.dataset.googleIdentity = 'true';
      document.head.append(script);
    }
  });
}

/** Exchanges a Google credential and optional invitation for a SurrealDB record token. */
async function authenticateWithGoogle({ credential }) {
  clearError();
  setStatus('connecting', 'Signing in…');
  elements.googleButton.classList.add('is-busy');

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

    signedInUser = result.user || null;
    currentProfile = await loadCurrentProfile();
    invitationToken = null;
    elements.invitationNotice.hidden = true;
    await showAuthenticatedView();
  } catch (error) {
    setStatus('offline', 'Sign-in failed');
    showError(error, 'Could not sign in.');
    await db.close().catch(() => {});
  } finally {
    elements.googleButton.classList.remove('is-busy');
  }
}

/** Loads approval and administrator flags from the authenticated user record. */
async function loadCurrentProfile() {
  const [profiles] = await db.query(
    'SELECT id, email, name, picture, approved, approved_at, is_admin FROM user WHERE id = $auth.id',
  );
  const profile = profiles?.[0];

  if (!profile) throw new Error('Your user profile could not be loaded.');
  return profile;
}

/** Switches between pending, regular-user, and administrator interfaces. */
async function showAuthenticatedView() {
  const approved = currentProfile?.approved === true;
  const isAdmin = approved && currentProfile?.is_admin === true;
  const displayName = currentProfile?.name || signedInUser?.name;

  elements.connectionCard.hidden = true;
  elements.logoutButton.hidden = false;
  elements.pendingCard.hidden = approved;
  elements.tasksCard.hidden = !approved;
  elements.adminCard.hidden = !isAdmin;

  if (!approved) {
    elements.pendingEmail.textContent = currentProfile?.email || signedInUser?.email || '';
    setStatus('pending', displayName ? `Pending · ${displayName}` : 'Approval pending');
    return;
  }

  setStatus('online', displayName ? `Signed in · ${displayName}` : 'Signed in');
  await loadTasks();
  if (isAdmin) await loadAdminData();
  elements.taskInput.focus();
}

/** Rechecks an authenticated pending user's approval without requiring another Google sign-in. */
async function checkApproval() {
  clearError();
  setBusy(elements.checkApprovalButton, true, 'Checking…');

  try {
    currentProfile = await loadCurrentProfile();
    await showAuthenticatedView();
    if (!currentProfile.approved) setStatus('pending', 'Still awaiting approval');
  } catch (error) {
    showError(error, 'Could not check approval.');
  } finally {
    setBusy(elements.checkApprovalButton, false, 'Check approval');
  }
}

/** Invalidates the database session and restores the Google sign-in screen. */
async function logout() {
  clearError();
  setBusy(elements.logoutButton, true, 'Logging out…');

  try {
    await db.invalidate().catch(() => {});
    await db.close();
  } catch (error) {
    showError(error, 'The connection could not be closed cleanly.');
  } finally {
    window.google?.accounts?.id?.disableAutoSelect();
    signedInUser = null;
    currentProfile = null;
    tasks = [];
    pendingUsers = [];
    activeInvitations = [];
    renderTasks();
    renderAdminData();
    elements.tasksCard.hidden = true;
    elements.pendingCard.hidden = true;
    elements.adminCard.hidden = true;
    elements.connectionCard.hidden = false;
    elements.logoutButton.hidden = true;
    elements.inviteResult.hidden = true;
    setBusy(elements.logoutButton, false, 'Logout');
    setStatus('offline', 'Signed out');
  }
}

/** Fetches the current user's todo records and refreshes the task list. */
async function loadTasks() {
  clearError();
  setBusy(elements.refreshButton, true, 'Refreshing…');

  try {
    [tasks] = await db.query('SELECT * FROM todo ORDER BY created_at DESC');
    renderTasks();
  } catch (error) {
    showError(error, 'Could not load tasks.');
  } finally {
    setBusy(elements.refreshButton, false, 'Refresh');
  }
}

/** Creates a todo owned by the authenticated, approved record user. */
async function createTask(event) {
  event.preventDefault();
  clearError();

  const title = elements.taskInput.value.trim();
  if (!title) return;

  const button = elements.taskForm.querySelector('button');
  setBusy(button, true, 'Adding…');

  try {
    await db.create(todos).content({ title, done: false });
    elements.taskForm.reset();
    await loadTasks();
    elements.taskInput.focus();
  } catch (error) {
    showError(error, 'Could not add the task.');
  } finally {
    setBusy(button, false, 'Add task');
  }
}

/** Updates a todo's completed state when its checkbox changes. */
async function toggleTask(event) {
  if (!event.target.matches('input[type="checkbox"]')) return;

  const task = tasks.find(({ id }) => id.toString() === event.target.dataset.id);
  if (!task) return;

  event.target.disabled = true;
  clearError();

  try {
    await db.update(task.id).merge({ done: event.target.checked });
    await loadTasks();
  } catch (error) {
    event.target.checked = !event.target.checked;
    event.target.disabled = false;
    showError(error, 'Could not update the task.');
  }
}

/** Deletes the todo associated with a clicked Delete button. */
async function deleteTask(event) {
  const button = event.target.closest('[data-action="delete"]');
  if (!button) return;

  const task = tasks.find(({ id }) => id.toString() === button.dataset.id);
  if (!task) return;

  setBusy(button, true, '…');
  clearError();

  try {
    await db.delete(asRecordId('todo', task.id));
    await loadTasks();
  } catch (error) {
    setBusy(button, false, 'Delete');
    showError(error, 'Could not delete the task.');
  }
}

/** Loads pending users and unexpired invitations for the administrator. */
async function loadAdminData() {
  if (!currentProfile?.is_admin) return;

  clearError();
  setBusy(elements.refreshAdminButton, true, 'Refreshing…');

  try {
    [pendingUsers, activeInvitations] = await db.query(`
      SELECT id, email, name, created_at, last_login
        FROM user WHERE approved = false ORDER BY created_at ASC;
      SELECT id, email, status, expires_at, created_at
        FROM invitation
        WHERE status = "pending" AND expires_at > time::now()
        ORDER BY created_at DESC;
    `);
    renderAdminData();
  } catch (error) {
    showError(error, 'Could not load administrator data.');
  } finally {
    setBusy(elements.refreshAdminButton, false, 'Refresh');
  }
}

/** Creates an email-bound invitation while retaining only its token hash. */
async function createInvitation(event) {
  event.preventDefault();
  clearError();

  const email = elements.inviteEmail.value.trim().toLowerCase();
  const days = Number(elements.inviteExpiry.value);
  const button = elements.inviteForm.querySelector('button[type="submit"]');
  setBusy(button, true, 'Creating…');

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

    elements.inviteLink.value = buildInvitationLink(invitation);
    elements.inviteResult.hidden = false;
    elements.inviteForm.reset();
    await loadAdminData();
    elements.inviteLink.focus();
    elements.inviteLink.select();
  } catch (error) {
    showError(error, 'Could not create the invitation.');
  } finally {
    setBusy(button, false, 'Create invitation');
  }
}

/** Copies the one-time invitation link produced by the latest create operation. */
async function copyInvitationLink() {
  clearError();

  try {
    await navigator.clipboard.writeText(elements.inviteLink.value);
    setBusy(elements.copyInviteButton, true, 'Copied');
    window.setTimeout(() => setBusy(elements.copyInviteButton, false, 'Copy link'), 1200);
  } catch (error) {
    elements.inviteLink.focus();
    elements.inviteLink.select();
    showError(error, 'Automatic copying failed; copy the selected link manually.');
  }
}

/** Approves one pending user through protected field permissions. */
async function approveUser(event) {
  const button = event.target.closest('[data-action="approve-user"]');
  if (!button) return;

  const user = pendingUsers.find(({ id }) => id.toString() === button.dataset.id);
  if (!user) return;

  clearError();
  setBusy(button, true, 'Approving…');

  try {
    await db.update(user.id).merge({ approved: true, approved_at: new Date() });
    await loadAdminData();
  } catch (error) {
    setBusy(button, false, 'Approve');
    showError(error, 'Could not approve the user.');
  }
}

/** Revokes an unused invitation without exposing or recovering its token. */
async function revokeInvitation(event) {
  const button = event.target.closest('[data-action="revoke-invitation"]');
  if (!button) return;

  const invitation = activeInvitations.find(({ id }) => id.toString() === button.dataset.id);
  if (!invitation) return;

  clearError();
  setBusy(button, true, 'Revoking…');

  try {
    await db.update(invitation.id).merge({ status: 'revoked' });
    await loadAdminData();
  } catch (error) {
    setBusy(button, false, 'Revoke');
    showError(error, 'Could not revoke the invitation.');
  }
}

/** Rebuilds the task list, empty state, and task summary from local task data. */
function renderTasks() {
  elements.taskList.replaceChildren(...tasks.map(taskItem));
  elements.emptyState.hidden = tasks.length > 0;

  const openCount = tasks.filter((task) => !task.done).length;
  const noun = tasks.length === 1 ? 'task' : 'tasks';
  elements.taskCount.textContent = `${tasks.length} ${noun} · ${openCount} open`;
}

/** Creates the list-item DOM elements for one todo record. */
function taskItem(task) {
  const item = document.createElement('li');
  item.className = 'task-item';
  if (task.done) item.classList.add('is-done');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(task.done);
  checkbox.dataset.id = task.id.toString();
  checkbox.setAttribute('aria-label', `Mark “${task.title}” as ${task.done ? 'open' : 'done'}`);

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;

  const remove = actionButton('Delete', 'delete', task.id);
  remove.className = 'delete-button';
  remove.setAttribute('aria-label', `Delete “${task.title}”`);

  item.append(checkbox, title, remove);
  return item;
}

/** Renders administrator lists without inserting untrusted text as HTML. */
function renderAdminData() {
  elements.pendingUserList.replaceChildren(
    ...pendingUsers.map((user) =>
      adminListItem(
        user.email,
        `${user.name || 'Unnamed user'} · registered ${formatDate(user.created_at)}`,
        actionButton('Approve', 'approve-user', user.id),
      ),
    ),
  );
  elements.pendingUserEmpty.hidden = pendingUsers.length > 0;

  elements.invitationList.replaceChildren(
    ...activeInvitations.map((invitation) =>
      adminListItem(
        invitation.email,
        `Expires ${formatDate(invitation.expires_at)}`,
        actionButton('Revoke', 'revoke-invitation', invitation.id),
      ),
    ),
  );
  elements.invitationEmpty.hidden = activeInvitations.length > 0;
}

function adminListItem(titleText, detailText, button) {
  const item = document.createElement('li');
  item.className = 'admin-list-item';

  const identity = document.createElement('div');
  const title = document.createElement('strong');
  const detail = document.createElement('span');
  title.textContent = titleText;
  detail.textContent = detailText;
  identity.append(title, detail);
  item.append(identity, button);
  return item;
}

function actionButton(label, action, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary-button';
  button.dataset.action = action;
  button.dataset.id = id.toString();
  button.textContent = label;
  return button;
}

function asRecordId(table, value) {
  return value instanceof RecordId ? value : new RecordId(table, value);
}

function generateInvitationToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hashInvitationToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function buildInvitationLink(token) {
  return `${window.location.origin}${window.location.pathname}#invite=${token}`;
}

/** Reads an invitation once, then removes it from the address bar and browser history. */
function consumeInvitationFragment() {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  if (!parameters.has('invite')) return { token: null, invalid: false };

  const token = parameters.get('invite') || '';
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return { token: valid ? token : null, invalid: !valid };
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function setStatus(state, text) {
  elements.status.dataset.state = state;
  elements.statusText.textContent = text;
}

function setBusy(element, busy, label) {
  element.disabled = busy;
  element.textContent = label;
}

function showError(error, fallback) {
  console.error(error);
  showMessage(error instanceof Error ? `${fallback} ${error.message}` : fallback);
}

function showMessage(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = '';
}
