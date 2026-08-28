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
