import { Tooltip } from 'flowbite-react';

export function RefreshIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12A9 9 0 0 1 18.5 5.8L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function UpArrowIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

export function DownArrowIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="m18 13-6 6-6-6" />
    </svg>
  );
}

export function RefreshButton({ busy, label, onClick }) {
  const accessibleLabel = busy ? `Refreshing ${label}…` : `Refresh ${label}`;

  return (
    <Tooltip content={accessibleLabel}>
      <button
        className="icon-action"
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label={accessibleLabel}
      >
        <span className={busy ? 'animate-spin' : ''}><RefreshIcon /></span>
      </button>
    </Tooltip>
  );
}
