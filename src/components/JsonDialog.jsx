import { useEffect, useRef } from 'react';
import { formatDate, stringifyJson } from '../lib.js';

export default function JsonDialog({ reception, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (reception && !dialog.open) dialog.showModal();
    if (!reception && dialog.open) dialog.close();
  }, [reception]);

  return (
    <dialog
      className="json-dialog"
      ref={dialogRef}
      aria-labelledby="reception-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="json-dialog-header">
        <div>
          <p className="section-label">gateway_rxpk record</p>
          <h2 id="reception-dialog-title">Reception JSON</h2>
          <p className="json-dialog-summary">
            {reception
              ? `${reception.gateway?.gateway_id ?? 'Unknown gateway'} · ${formatDate(
                  reception.gateway?.ingested_at,
                )}`
              : ''}
          </p>
        </div>
        <form method="dialog">
          <button className="json-dialog-close" type="submit" aria-label="Close reception JSON">
            Close
          </button>
        </form>
      </div>
      <pre className="json-viewer">
        <code>{reception ? stringifyJson(reception) : ''}</code>
      </pre>
    </dialog>
  );
}
