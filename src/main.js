import { NotAllowedError, RecordId, Surreal, Table } from 'surrealdb';
import './style.css';

const config = {
  endpoint:
    import.meta.env.VITE_SURREAL_ENDPOINT ||
    'wss://nano-things-fre-06fekk904lvvv6p0ocvu8dm7c4.aws-euw1.surreal.cloud',
  namespace: import.meta.env.VITE_SURREAL_NAMESPACE || 'main',
  database: import.meta.env.VITE_SURREAL_DATABASE || 'main',
  username: import.meta.env.VITE_SURREAL_USERNAME || 'nano-things-user',
};

const db = new Surreal();
const todos = new Table('todo');

const elements = {
  connectForm: document.querySelector('#connect-form'),
  connectButton: document.querySelector('#connect-button'),
  connectionCard: document.querySelector('#connection-card'),
  host: document.querySelector('#host'),
  namespace: document.querySelector('#namespace'),
  database: document.querySelector('#database'),
  username: document.querySelector('#username'),
  authLevel: document.querySelector('#auth-level'),
  password: document.querySelector('#password'),
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

populateConnectionFields();

elements.connectForm.addEventListener('submit', connect);
elements.logoutButton.addEventListener('click', logout);
elements.taskForm.addEventListener('submit', createTask);
elements.refreshButton.addEventListener('click', loadTasks);
elements.taskList.addEventListener('change', toggleTask);
elements.taskList.addEventListener('click', deleteTask);
window.addEventListener('pagehide', () => {
  void db.close().catch(() => {});
});

/** Fills the editable connection form with the configured default values. */
function populateConnectionFields() {
  elements.host.value = new URL(config.endpoint).host;
  elements.namespace.value = config.namespace;
  elements.database.value = config.database;
  elements.username.value = config.username;
}

/**
 * Opens an authenticated SurrealDB connection using the values from the form.
 * On success, it replaces the login card with the task list.
 * @param {SubmitEvent} event The connection form submission event.
 */
async function connect(event) {
  event.preventDefault();
  clearError();
  setStatus('connecting', 'Connecting…');
  setBusy(elements.connectButton, true, 'Connecting…');

  try {
    updateConfigFromForm();
    await db.connect(config.endpoint, {
      namespace: config.namespace,
      database: config.database,
      authentication: authenticationFor(
        elements.authLevel.value,
        elements.password.value,
      ),
    });

    elements.password.value = '';
    elements.connectionCard.hidden = true;
    elements.logoutButton.hidden = false;
    elements.tasksCard.hidden = false;
    setStatus('online', 'Connected');
    await loadTasks();
    elements.taskInput.focus();
  } catch (error) {
    setStatus('offline', 'Connection failed');
    if (error instanceof NotAllowedError) {
      showAuthenticationError();
    } else {
      showError(error, 'Could not connect. Check the Cloud instance details.');
    }
    await db.close().catch(() => {});
  } finally {
    setBusy(elements.connectButton, false, 'Connect');
  }
}

/** Reads the connection form and updates the configuration used by the SDK. */
function updateConfigFromForm() {
  const host = elements.host.value.trim();
  config.endpoint = /^wss?:\/\//i.test(host) ? host : `wss://${host}`;
  config.namespace = elements.namespace.value.trim();
  config.database = elements.database.value.trim();
  config.username = elements.username.value.trim();
}

/** Invalidates the current session, closes the connection, and restores the login screen. */
async function logout() {
  clearError();
  setBusy(elements.logoutButton, true, 'Logging out…');

  try {
    await db.invalidate().catch(() => {});
    await db.close();
  } catch (error) {
    showError(error, 'The connection could not be closed cleanly.');
  } finally {
    tasks = [];
    renderTasks();
    elements.tasksCard.hidden = true;
    elements.connectionCard.hidden = false;
    elements.logoutButton.hidden = true;
    setBusy(elements.logoutButton, false, 'Logout');
    setStatus('offline', 'Not connected');
    elements.password.focus();
  }
}

/**
 * Builds the credential object required for the selected SurrealDB user scope.
 * @param {'root' | 'namespace' | 'database'} level Where the system user is defined.
 * @param {string} password The password entered by the user.
 * @returns {object} Credentials suitable for the SDK's authentication option.
 */
function authenticationFor(level, password) {
  const credentials = {
    username: config.username,
    password,
  };

  if (level === 'namespace' || level === 'database') {
    credentials.namespace = config.namespace;
  }

  if (level === 'database') {
    credentials.database = config.database;
  }

  return credentials;
}

/** Fetches all todo records from SurrealDB and refreshes the task list. */
async function loadTasks() {
  clearError();
  setBusy(elements.refreshButton, true, 'Refreshing…');

  try {
    // A raw query is useful when you need SurrealQL features such as ORDER BY.
    [tasks] = await db.query('SELECT * FROM todo ORDER BY created_at DESC');
    renderTasks();
  } catch (error) {
    showError(error, 'Could not load tasks.');
  } finally {
    setBusy(elements.refreshButton, false, 'Refresh');
  }
}

/**
 * Creates a todo record from the new-task form and reloads the list.
 * @param {SubmitEvent} event The new-task form submission event.
 */
async function createTask(event) {
  event.preventDefault();
  clearError();

  const title = elements.taskInput.value.trim();
  if (!title) return;

  const button = elements.taskForm.querySelector('button');
  setBusy(button, true, 'Adding…');

  try {
    await db.create(todos).content({
      title,
      done: false,
      created_at: new Date().toISOString(),
    });
    elements.taskForm.reset();
    await loadTasks();
    elements.taskInput.focus();
  } catch (error) {
    showError(error, 'Could not add the task.');
  } finally {
    setBusy(button, false, 'Add task');
  }
}

/**
 * Updates a todo's completed state when its checkbox changes.
 * @param {Event} event The bubbling change event from the task list.
 */
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

/**
 * Deletes the todo associated with a clicked Delete button.
 * @param {MouseEvent} event The bubbling click event from the task list.
 */
async function deleteTask(event) {
  const button = event.target.closest('[data-action="delete"]');
  if (!button) return;

  const task = tasks.find(({ id }) => id.toString() === button.dataset.id);
  if (!task) return;

  setBusy(button, true, '…');
  clearError();

  try {
    // `task.id` is already a RecordId. The fallback shows how to construct one.
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

/**
 * Creates the list-item DOM elements for one todo record.
 * @param {object} task A todo record returned by SurrealDB.
 * @returns {HTMLLIElement} The rendered task list item.
 */
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

/** Updates the connection-status text and its visual state. */
function setStatus(state, text) {
  elements.status.dataset.state = state;
  elements.statusText.textContent = text;
}

/** Disables or enables a button and updates its label during an async operation. */
function setBusy(element, busy, label) {
  element.disabled = busy;
  element.textContent = label;
}

/** Logs an unexpected error and displays a readable message in the page. */
function showError(error, fallback) {
  console.error(error);
  elements.error.textContent = error instanceof Error ? `${fallback} ${error.message}` : fallback;
  elements.error.hidden = false;
}

/** Displays authentication guidance tailored to the currently selected user scope. */
function showAuthenticationError() {
  const scope =
    elements.authLevel.value === 'database'
      ? `database user in ${config.namespace}/${config.database}`
      : `${elements.authLevel.value} user`;

  elements.error.textContent =
    `Authentication as a ${scope} was rejected. Verify that the user is defined at that exact scope and use its system-user password from Surrealist → Authentication.`;
  elements.error.hidden = false;
}

/** Hides and clears the current page-level error message. */
function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = '';
}
