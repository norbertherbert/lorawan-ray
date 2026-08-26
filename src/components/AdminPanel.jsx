import { useEffect, useRef, useState } from 'react';
import { RefreshButton } from './Icons.jsx';
import { formatDate } from '../lib.js';

export default function AdminPanel({
  pendingUsers,
  activeInvitations,
  refreshing,
  onRefresh,
  onApprove,
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
          <p className="section-label">Administration</p>
          <h2>Users &amp; invitations</h2>
        </div>
        <span className="number">03</span>
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
            <input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="invite-expiry">Expires after</label>
            <select
              id="invite-expiry"
              name="expiry"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
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

function AdminListItem({ title, detail, actionLabel, disabled, onAction }) {
  return (
    <li className="admin-list-item">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <button className="secondary-button" type="button" disabled={disabled} onClick={onAction}>
        {actionLabel}
      </button>
    </li>
  );
}
