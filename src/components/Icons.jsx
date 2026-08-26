export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12A9 9 0 0 1 18.5 5.8L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 2v4M18 2v4M3 9h18" />
      <rect x="3" y="4" width="18" height="17" rx="2" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m5 15 7-7 7 7" />
    </svg>
  );
}

export function ArrowDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m5 9 7 7 7-7" />
    </svg>
  );
}

export function RefreshButton({ busy, label, onClick }) {
  const accessibleLabel = busy ? `Refreshing ${label}…` : `Refresh ${label}`;

  return (
    <button
      className={`refresh-icon-button${busy ? ' is-busy' : ''}`}
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <RefreshIcon />
    </button>
  );
}
