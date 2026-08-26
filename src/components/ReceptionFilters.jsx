import { useEffect, useRef, useState } from 'react';
import { ArrowDownIcon, CalendarIcon } from './Icons.jsx';
import {
  emptyReceptionFilters,
  normalizeReceptionFilters,
  parseLocalDateTime,
} from '../receptions.js';

export default function ReceptionFilters({ filters, busy, onApply }) {
  const [draft, setDraft] = useState(filters);
  const activeCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => setDraft(filters), [filters]);

  function update(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function apply(event) {
    event.preventDefault();
    onApply(normalizeReceptionFilters(draft));
  }

  function clear() {
    const cleared = { ...emptyReceptionFilters };
    setDraft(cleared);
    onApply(cleared);
  }

  return (
    <details className="reception-filters">
      <summary className="filter-heading">
        <strong>Filters</strong>
        <span className="filter-heading-status">
          {activeCount ? `${activeCount} active` : 'No filters applied'}
          <ArrowDownIcon />
        </span>
      </summary>
      <form onSubmit={apply}>
        <div className="filter-grid">
          <IsoDateTimeField
            id="filter-ingested-from"
            label="Ingested from"
            value={draft.from}
            max={draft.to}
            onChange={(value) => update('from', value)}
            disabled={busy}
          />
          <IsoDateTimeField
            id="filter-ingested-to"
            label="Ingested to"
            value={draft.to}
            min={draft.from}
            endOfDay
            onChange={(value) => update('to', value)}
            disabled={busy}
          />
          <div>
            <label htmlFor="filter-gateway-id">Gateway ID</label>
            <input
              id="filter-gateway-id"
              type="text"
              autoComplete="off"
              placeholder="1032547698BADCFE"
              value={draft.gatewayId}
              onChange={(event) => update('gatewayId', event.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="filter-dev-addr">DevAddr</label>
            <input
              id="filter-dev-addr"
              type="text"
              autoComplete="off"
              placeholder="26011ABC"
              value={draft.devAddr}
              onChange={(event) => update('devAddr', event.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <div className="filter-actions">
          <button className="secondary-button" type="button" onClick={clear} disabled={busy}>
            Clear
          </button>
          <button className="filter-apply-button" type="submit" disabled={busy}>
            Apply filters
          </button>
        </div>
      </form>
    </details>
  );
}

function IsoDateTimeField({ id, label, value, min, max, endOfDay = false, onChange, disabled }) {
  const pickerRef = useRef(null);

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;

    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
    } else {
      picker.click();
    }
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <div className="iso-datetime-control">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD HH:MM:SS"
          pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}( [0-9]{2}:[0-9]{2}(:[0-9]{2})?)?"
          title="Use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <button
          className="calendar-picker-button"
          type="button"
          aria-label={`Open ${label.toLowerCase()} date picker`}
          title="Choose a date"
          onClick={openPicker}
          disabled={disabled}
        >
          <CalendarIcon />
        </button>
        <input
          ref={pickerRef}
          className="native-date-picker"
          type="date"
          tabIndex="-1"
          aria-hidden="true"
          value={toNativeDate(value)}
          min={toNativeDate(min)}
          max={toNativeDate(max)}
          onChange={(event) => onChange(mergePickedDate(event.target.value, value, { endOfDay }))}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function toNativeDate(value) {
  const trimmed = value?.trim();
  if (!trimmed) return '';

  try {
    parseLocalDateTime(trimmed);
  } catch {
    return '';
  }

  return trimmed.slice(0, 10);
}

function mergePickedDate(date, currentValue, { endOfDay = false } = {}) {
  if (!date) return '';

  const timeMatch = currentValue?.match(/[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  const time = timeMatch
    ? `${timeMatch[1]}:${timeMatch[2] || '00'}`
    : endOfDay
      ? '23:59:59'
      : '00:00:00';
  return `${date} ${time}`;
}
