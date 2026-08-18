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

const elements = {
  connectionCard: document.querySelector('#connection-card'),
  googleButton: document.querySelector('#google-button'),
  tasksCard: document.querySelector('#tasks-card'),
  taskForm: document.querySelector('#task-form'),
  taskInput: document.querySelector('#new-task'),
  taskList: document.querySelector('#task-list'),
  taskCount: document.querySelector('#task-count'),
  emptyState: document.querySelector('#empty-state'),
  refreshButton: document.querySelector('#refresh-button'),
  logoutButton: document.querySelector('#logout-button'),
  status: document.querySelector('#status'),
  statusText: document.querySelector('#status-text'),
  error: document.querySelector('#error-message'),
};

let tasks = [];
let signedInUser = null;

elements.logoutButton.addEventListener('click', logout);
elements.taskForm.addEventListener('submit', createTask);
elements.refreshButton.addEventListener('click', loadTasks);
elements.taskList.addEventListener('change', toggleTask);
elements.taskList.addEventListener('click', deleteTask);
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
    setStatus('offline', 'Signed out');
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

/** Exchanges a verified Google credential for a narrowly scoped SurrealDB record token. */
async function authenticateWithGoogle({ credential }) {
  clearError();
  setStatus('connecting', 'Signing in…');
  elements.googleButton.classList.add('is-busy');

  try {
    const response = await fetch(`${config.authBrokerUrl}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
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
    elements.connectionCard.hidden = true;
    elements.logoutButton.hidden = false;
    elements.tasksCard.hidden = false;
    setStatus('online', signedInUser?.name ? `Signed in · ${signedInUser.name}` : 'Signed in');
    await loadTasks();
    elements.taskInput.focus();
  } catch (error) {
    setStatus('offline', 'Sign-in failed');
    showError(error, 'Could not sign in.');
    await db.close().catch(() => {});
  } finally {
    elements.googleButton.classList.remove('is-busy');
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
    tasks = [];
    renderTasks();
    elements.tasksCard.hidden = true;
    elements.connectionCard.hidden = false;
    elements.logoutButton.hidden = true;
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

/** Creates a todo owned by the authenticated record user. */
async function createTask(event) {
  event.preventDefault();
  clearError();

  const title = elements.taskInput.value.trim();
  if (!title) return;

  const button = elements.taskForm.querySelector('button');
  setBusy(button, true, 'Adding…');

  try {
    // The schema assigns owner=$auth and created_at=time::now(); the browser cannot override them.
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
    const id = task.id instanceof RecordId ? task.id : new RecordId('todo', task.id);
    await db.delete(id);
    await loadTasks();
  } catch (error) {
    setBusy(button, false, 'Delete');
    showError(error, 'Could not delete the task.');
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

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button';
  remove.dataset.action = 'delete';
  remove.dataset.id = task.id.toString();
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete “${task.title}”`);

  item.append(checkbox, title, remove);
  return item;
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
