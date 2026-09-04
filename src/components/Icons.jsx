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

export function DownloadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M4 5h16l-6.5 7.2v5.3l-3 1.5v-6.8L4 5Z" />
    </svg>
  );
}

export function FolderOpenIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M3 7.5h6l2 2h10" />
      <path d="M4.5 20h14a2 2 0 0 0 1.9-1.4L23 10H5.6L3 18.5V5.8A1.8 1.8 0 0 1 4.8 4h4.4l2 2H19a2 2 0 0 1 2 2" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6" />
    </svg>
  );
}

export function ArrowRightStartOnRectangleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d="M10.5 6h-6A2.25 2.25 0 0 0 2.25 8.25v7.5A2.25 2.25 0 0 0 4.5 18h6" />
      <path d="m13.5 9 3 3m0 0-3 3m3-3H7.5" />
    </svg>
  );
}

export function ArrowRightEndOnRectangleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d="M13.5 6h6a2.25 2.25 0 0 1 2.25 2.25v7.5A2.25 2.25 0 0 1 19.5 18h-6" />
      <path d="m10.5 9 3 3m0 0-3 3m3-3H4.5" />
    </svg>
  );
}

export function RefreshButton({ busy, label, onClick, tooltipClassName, tooltipLabel }) {
  const accessibleLabel = tooltipLabel || (busy ? `Refreshing ${label}…` : `Refresh ${label}`);

  return (
    <Tooltip className={tooltipClassName} content={accessibleLabel}>
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
