import { Badge, Button } from 'flowbite-react';
import { useEffect, useState } from 'react';
import type { UplinkFilters } from '../../api/types.ts';
import type { Modulation } from '../../api/types.ts';

export interface FilterDraft {
  text: string;
  from: string;
  to: string;
  devEui: string;
  devAddr: string;
  gatewayId: string;
  fPort: string;
  modulation: string;
  dataRate: string;
  spreadingFactor: string;
  rssiMinimum: string;
  snrMinimum: string;
}

const EMPTY_FILTERS: FilterDraft = {
  text: '',
  from: '',
  to: '',
  devEui: '',
  devAddr: '',
  gatewayId: '',
  fPort: '',
  modulation: '',
  dataRate: '',
  spreadingFactor: '',
  rssiMinimum: '',
  snrMinimum: '',
};

interface FilterBuilderProps {
  value: FilterDraft;
  busy: boolean;
  onApply: (draft: FilterDraft, filters: UplinkFilters | undefined) => void;
}

export default function FilterBuilder({ value, busy, onApply }: FilterBuilderProps) {
  const [draft, setDraft] = useState(value);
  const [validationError, setValidationError] = useState('');
  const activeCount = countActiveFilters(value);

  useEffect(() => setDraft(value), [value]);

  function update(field: keyof FilterDraft, nextValue: string) {
    setDraft((current) => ({ ...current, [field]: nextValue }));
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    try {
      const normalized = normalizeFilterDraft(draft);
      setValidationError('');
      onApply(normalized.draft, normalized.filters);
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'The filters are invalid.');
    }
  }

  function clear() {
    const cleared = { ...EMPTY_FILTERS };
    setDraft(cleared);
    setValidationError('');
    onApply(cleared, undefined);
  }

  return (
    <details className="analyzer-filters">
      <summary>
        <span>Display filter</span>
        <span className="analyzer-filter-state">
          {activeCount ? <Badge color="warning">{activeCount} active</Badge> : 'No filters'}
          <span aria-hidden="true">⌄</span>
        </span>
      </summary>
      <form onSubmit={apply}>
        <div className="analyzer-filter-grid">
          <FilterField label="Search" value={draft.text} placeholder="Payload, address, MType…" onChange={(value) => update('text', value)} />
          <FilterField label="Observed from" value={draft.from} placeholder="YYYY-MM-DD HH:MM:SS" onChange={(value) => update('from', value)} />
          <FilterField label="Observed to" value={draft.to} placeholder="YYYY-MM-DD HH:MM:SS" onChange={(value) => update('to', value)} />
          <FilterField label="DevEUI" value={draft.devEui} placeholder="70B3D57ED0001001" onChange={(value) => update('devEui', value)} />
          <FilterField label="DevAddr" value={draft.devAddr} placeholder="26011ABC" onChange={(value) => update('devAddr', value)} />
          <FilterField label="Gateway" value={draft.gatewayId} placeholder="647FDAFFFE005E17" onChange={(value) => update('gatewayId', value)} />
          <FilterField label="FPort" value={draft.fPort} placeholder="1, 10, 100" inputMode="numeric" onChange={(value) => update('fPort', value)} />
          <FilterSelect label="Modulation" value={draft.modulation} onChange={(value) => update('modulation', value)} />
          <FilterField label="Data rate" value={draft.dataRate} placeholder="M0CW137, SF7BW125" onChange={(value) => update('dataRate', value)} />
          <FilterField label="LoRa SF" value={draft.spreadingFactor} placeholder="7, 8, 12" inputMode="numeric" onChange={(value) => update('spreadingFactor', value)} />
          <FilterField label="Minimum RSSI" value={draft.rssiMinimum} placeholder="-110" inputMode="decimal" onChange={(value) => update('rssiMinimum', value)} />
          <FilterField label="Minimum SNR" value={draft.snrMinimum} placeholder="-10" inputMode="decimal" onChange={(value) => update('snrMinimum', value)} />
        </div>
        {validationError ? <p className="analyzer-filter-error" role="alert">{validationError}</p> : null}
        <div className="analyzer-filter-actions">
          <Button color="alternative" size="xs" type="button" onClick={clear} disabled={busy}>Clear</Button>
          <Button color="dark" size="xs" type="submit" disabled={busy}>Apply filter</Button>
        </div>
      </form>
    </details>
  );
}

interface FilterFieldProps {
  label: string;
  value: string;
  placeholder: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  onChange: (value: string) => void;
}

function FilterField({ label, value, placeholder, inputMode, onChange }: FilterFieldProps) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function FilterSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any modulation</option>
        <option value="LR-FHSS">LR-FHSS</option>
        <option value="LORA">LoRa</option>
        <option value="FSK">FSK</option>
      </select>
    </label>
  );
}

export function normalizeFilterDraft(input: FilterDraft): {
  draft: FilterDraft;
  filters: UplinkFilters | undefined;
} {
  const draft = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value.trim()]),
  ) as unknown as FilterDraft;
  const from = parseLocalTimestamp(draft.from, false);
  const to = parseLocalTimestamp(draft.to, true);
  if (from && to && from > to) throw new Error('Observed from must not be after observed to.');

  const fPorts = parseIntegerList(draft.fPort, 'FPort', 0, 255);
  const spreadingFactors = parseIntegerList(draft.spreadingFactor, 'SF', 5, 12);
  const modulation = draft.modulation as Modulation | '';
  if (modulation && !['LORA', 'LR-FHSS', 'FSK'].includes(modulation)) {
    throw new Error('The modulation filter is invalid.');
  }
  const rssiMinimum = parseOptionalNumber(draft.rssiMinimum, 'RSSI');
  const snrMinimum = parseOptionalNumber(draft.snrMinimum, 'SNR');
  const filters: UplinkFilters = {
    packet: compactObject({
      text: draft.text || undefined,
      from: from?.toISOString(),
      to: to?.toISOString(),
      devEuis: draft.devEui ? splitIdentifiers(draft.devEui) : undefined,
      devAddrs: draft.devAddr ? splitIdentifiers(draft.devAddr) : undefined,
      fPorts,
      modulations: modulation ? [modulation] : undefined,
      dataRates: parseDataRates(draft.dataRate),
    }),
    reception: compactObject({
      gatewayIds: draft.gatewayId ? splitIdentifiers(draft.gatewayId) : undefined,
      spreadingFactors,
      rssiDbm: rssiMinimum === undefined ? undefined : { minimum: rssiMinimum },
      snrDb: snrMinimum === undefined ? undefined : { minimum: snrMinimum },
    }),
  };
  if (!Object.keys(filters.packet ?? {}).length) delete filters.packet;
  if (!Object.keys(filters.reception ?? {}).length) delete filters.reception;
  return { draft, filters: Object.keys(filters).length ? filters : undefined };
}

export function emptyFilterDraft(): FilterDraft {
  return { ...EMPTY_FILTERS };
}

function countActiveFilters(filters: FilterDraft): number {
  return Object.values(filters).filter((value) => value.trim()).length;
}

function parseLocalTimestamp(value: string, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error(`Invalid timestamp: ${value}`);
  const [, year, month, day, hour, minute, second] = match;
  const hasTime = hour !== undefined;
  const expectedYear = Number(year);
  const expectedMonth = Number(month) - 1;
  const expectedDay = Number(day);
  const expectedHour = hasTime ? Number(hour) : endOfDay ? 23 : 0;
  const expectedMinute = hasTime ? Number(minute) : endOfDay ? 59 : 0;
  const expectedSecond = hasTime ? Number(second ?? 0) : endOfDay ? 59 : 0;
  const date = new Date(
    expectedYear,
    expectedMonth,
    expectedDay,
    expectedHour,
    expectedMinute,
    expectedSecond,
    !hasTime && endOfDay ? 999 : 0,
  );
  if (
    date.getFullYear() !== expectedYear ||
    date.getMonth() !== expectedMonth ||
    date.getDate() !== expectedDay ||
    date.getHours() !== expectedHour ||
    date.getMinutes() !== expectedMinute ||
    date.getSeconds() !== expectedSecond
  ) throw new Error(`Invalid timestamp: ${value}`);
  return date;
}

function parseIntegerList(value: string, label: string, minimum: number, maximum: number): number[] | undefined {
  if (!value) return undefined;
  const values = value.split(',').map((item) => Number(item.trim()));
  if (values.some((item) => !Number.isInteger(item) || item < minimum || item > maximum)) {
    throw new Error(`${label} must contain comma-separated integers from ${minimum} to ${maximum}.`);
  }
  return [...new Set(values)];
}

function parseOptionalNumber(value: string, label: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function splitIdentifiers(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseDataRates(value: string): Array<string | number> | undefined {
  if (!value) return undefined;
  return [...new Set(value.split(',').map((item) => {
    const normalized = item.trim();
    return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : normalized.toUpperCase();
  }).filter((item) => item !== ''))];
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}
