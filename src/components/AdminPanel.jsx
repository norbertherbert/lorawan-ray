import { useEffect, useRef, useState } from 'react';
import { Select, TextInput, ToggleSwitch } from 'flowbite-react';
import { RefreshButton } from './Icons.jsx';
import { formatDate } from '../lib.js';

const compactInputStyle = {
  height: '38px',
  minHeight: '38px',
  padding: '2px 8px',
  borderRadius: '2px',
  fontSize: '0.72rem',
  lineHeight: 1.2,
};

const compactSelectStyle = {
  ...compactInputStyle,
  paddingRight: '28px',
};

export default function AdminPanel({
  registeredUsers,
  pendingUsers,
  activeInvitations,
  currentUserId,
  selfRegistrationEnabled,
  refreshing,
  onRefresh,
  onApprove,
  onDeleteUser,
  onSetSelfRegistration,
  onRevoke,
  onCreateInvitation,
  onError,
}) {
  const [email, setEmail] = useState('');
  const [expiry, setExpiry] = useState('7');
  const [invitationLink, setInvitationLink] = useState('');
  const [creating, setCreating] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy link');
  const [activeAction, setActiveAction] = useState('');
  const invitationLinkRef = useRef(null);

  useEffect(() => {
    if (!invitationLink) return;
    invitationLinkRef.current?.focus();
    invitationLinkRef.current?.select();
  }, [invitationLink]);

  async function createInvitation(event) {
    event.preventDefault();
    setCreating(true);
    const link = await onCreateInvitation(email.trim().toLowerCase(), Number(expiry));
    setCreating(false);

    if (link) {
      setInvitationLink(link);
      setEmail('');
      setExpiry('7');
    }
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationLink);
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy link'), 1200);
    } catch (error) {
      invitationLinkRef.current?.focus();
      invitationLinkRef.current?.select();
      onError(error, 'Automatic copying failed; copy the selected link manually.');
    }
  }

  async function runAction(key, action) {
    setActiveAction(key);
    await action();
    setActiveAction('');
  }

  return (
    <section className="card admin-card" id="admin-card">
      <div className="section-heading">
        <div>
          <h2>Users &amp; invitations</h2>
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h3>Self-registration</h3>
            <p>Allow any user with a verified Google identity to register immediately.</p>
          </div>
        </div>
        <div className="registration-setting">
          <div>
            <strong>{selfRegistrationEnabled ? 'Enabled' : 'Disabled'}</strong>
            <span>
              {selfRegistrationEnabled
                ? 'New users receive packet access immediately.'
                : 'New users require approval or a valid invitation.'}
            </span>
          </div>
          <ToggleSwitch
            checked={selfRegistrationEnabled}
            disabled={activeAction === 'registration'}
            label={selfRegistrationEnabled ? 'Disable self-registration' : 'Enable self-registration'}
            onChange={(enabled) =>
              runAction('registration', () => onSetSelfRegistration(enabled))
            }
          />
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h3>Registered users</h3>
            <p>Delete accounts that should no longer have access.</p>
          </div>
        </div>
        <ul className="admin-list">
          {registeredUsers.map((user) => {
            const key = `delete:${user.id}`;
            const isCurrentUser = user.id.toString() === currentUserId?.toString();
            const status = user.is_admin
              ? 'administrator'
              : user.approved
                ? 'approved'
                : 'pending';
            return (
              <AdminListItem
                key={user.id.toString()}
                title={user.email}
                detail={`${user.name || 'Unnamed user'} · ${status}`}
                actionLabel={
                  isCurrentUser
                    ? 'Current user'
                    : activeAction === key
                      ? 'Deleting…'
                      : 'Delete'
                }
                danger={!isCurrentUser}
                disabled={isCurrentUser || activeAction === key}
                onAction={() => {
                  if (!window.confirm(`Delete the user ${user.email}?`)) return;
                  void runAction(key, () => onDeleteUser(user));
                }}
              />
            );
          })}
        </ul>
        <p className="admin-empty" hidden={registeredUsers.length > 0}>
          No registered users.
        </p>
      </div>

      <div className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h3>Pending registrations</h3>
            <p>Approve Google users who requested access without an invitation.</p>
          </div>
          <RefreshButton
            busy={refreshing}
            label="users and invitations"
            onClick={onRefresh}
          />
        </div>
        <ul className="admin-list">
          {pendingUsers.map((user) => {
            const key = `approve:${user.id}`;
            return (
              <AdminListItem
                key={user.id.toString()}
                title={user.email}
                detail={`${user.name || 'Unnamed user'} · registered ${formatDate(
                  user.created_at,
                )}`}
                actionLabel={activeAction === key ? 'Approving…' : 'Approve'}
                disabled={activeAction === key}
                onAction={() => runAction(key, () => onApprove(user))}
              />
            );
          })}
        </ul>
        <p className="admin-empty" hidden={pendingUsers.length > 0}>
          No registrations are waiting.
        </p>
      </div>

      <div className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h3>Create invitation</h3>
            <p>The link is single-use, email-bound, and expires automatically.</p>
          </div>
        </div>
        <form className="invite-form" onSubmit={createInvitation}>
          <div>
            <label htmlFor="invite-email">Google email address</label>
            <TextInput
              id="invite-email"
              name="email"
              type="email"
              sizing="sm"
              style={compactInputStyle}
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="invite-expiry">Expires after</label>
            <Select
              id="invite-expiry"
              name="expiry"
              sizing="sm"
              style={compactSelectStyle}
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </Select>
          </div>
          <button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create invitation'}
          </button>
        </form>

        <div className="invite-result" hidden={!invitationLink}>
          <p>This link is shown only once. Copy it before leaving this page.</p>
          <div className="copy-row">
            <input
              ref={invitationLinkRef}
              type="text"
              readOnly
              aria-label="Invitation link"
              value={invitationLink}
            />
            <button type="button" onClick={copyInvitation}>
              {copyLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h3>Active invitations</h3>
            <p>Invitation tokens are stored only as hashes and cannot be recovered.</p>
          </div>
        </div>
        <ul className="admin-list">
          {activeInvitations.map((invitation) => {
            const key = `revoke:${invitation.id}`;
            return (
              <AdminListItem
                key={invitation.id.toString()}
                title={invitation.email}
                detail={`Expires ${formatDate(invitation.expires_at)}`}
                actionLabel={activeAction === key ? 'Revoking…' : 'Revoke'}
                disabled={activeAction === key}
                onAction={() => runAction(key, () => onRevoke(invitation))}
              />
            );
          })}
        </ul>
        <p className="admin-empty" hidden={activeInvitations.length > 0}>
          No active invitations.
        </p>
      </div>
    </section>
  );
}

function AdminListItem({ title, detail, actionLabel, danger = false, disabled, onAction }) {
  return (
    <li className="admin-list-item">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <button
        className={`secondary-button${danger ? ' danger-button' : ''}`}
        type="button"
        disabled={disabled}
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </li>
  );
}
