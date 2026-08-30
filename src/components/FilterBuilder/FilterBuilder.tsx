import { parseTime } from '@internationalized/date';
import {
  Alert,
  Badge,
  Button,
  Dropdown,
  DropdownItem,
  Label,
  Select,
  TextInput,
} from 'flowbite-react';
import { useEffect, useRef, useState } from 'react';
import { DateInput, DateSegment, TimeField, type TimeValue } from 'react-aria-components';
import type { UplinkFilters } from '../../api/types.ts';
import type { Modulation } from '../../api/types.ts';
import {
  savedFilterDefinitionToFilters,
  type SavedFilterDefinition,
  type SavedFilterType,
} from '../../api/savedFilters.ts';

export interface FilterDraft {
  filterType: SavedFilterType;
  text: string;
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
  devEui: string;
  devAddr: string;
  fCntFrom: string;
  fCntTo: string;
  gatewayId: string;
  fPort: string;
  modulation: string;
  dataRate: string;
  spreadingFactor: string;
  rssiMinimum: string;
  snrMinimum: string;
}

const EMPTY_FILTERS: FilterDraft = {
  filterType: 'sniffer',
  text: '',
  fromDate: '',
  fromTime: '',
  toDate: '',
  toTime: '',
  devEui: '',
  devAddr: '',
  fCntFrom: '',
  fCntTo: '',
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
  activeFilterName?: string;
  activeFilterModified?: boolean;
  canSave: boolean;
  onApply: (draft: FilterDraft, filters: UplinkFilters | undefined) => void;
  onOpenSavedFilters: () => void;
  onSaveAs: (draft: FilterDraft, filters: UplinkFilters | undefined) => void;
  onSave: (draft: FilterDraft, filters: UplinkFilters | undefined) => void;
  onCloseSavedFilter: () => void;
  onDraftDirtyChange: (dirty: boolean) => void;
}

export default function FilterBuilder({
  value,
  busy,
  activeFilterName,
  activeFilterModified,
  canSave,
  onApply,
  onOpenSavedFilters,
  onSaveAs,
  onSave,
  onCloseSavedFilter,
  onDraftDirtyChange,
}: FilterBuilderProps) {
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const [validationError, setValidationError] = useState('');
  const hasUnappliedChanges = JSON.stringify(draft) !== JSON.stringify(value);
  const hasCriteria = hasFilterCriteria(draft) || hasFilterCriteria(value);
  const hasOpenSavedFilter = Boolean(activeFilterName);
  const savedFilterIsModified = hasOpenSavedFilter && Boolean(activeFilterModified || hasUnappliedChanges);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => onDraftDirtyChange(hasUnappliedChanges), [hasUnappliedChanges, onDraftDirtyChange]);

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

  function runFileAction(
    action: (nextDraft: FilterDraft, nextFilters: UplinkFilters | undefined) => void,
  ) {
    try {
      const normalized = normalizeFilterDraft(draft);
      setValidationError('');
      onApply(normalized.draft, normalized.filters);
      action(normalized.draft, normalized.filters);
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'The filters are invalid.');
    }
  }

  function clear() {
    const cleared = { ...EMPTY_FILTERS, filterType: draft.filterType };
    setDraft(cleared);
    setValidationError('');
    onApply(cleared, undefined);
  }

  function changeFilterType(nextType: SavedFilterType) {
    if (nextType === draft.filterType) return;
    if (
      hasCriteria &&
      !window.confirm('Changing the filter type will clear the current filter values. Continue?')
    ) return;
    const cleared = { ...EMPTY_FILTERS, filterType: nextType };
    setDraft(cleared);
    setValidationError('');
    onApply(cleared, undefined);
  }

  return (
    <>
      <Button
        className="analyzer-filter-toggle"
        color="light"
        size="xs"
        type="button"
        aria-controls="analyzer-filter-panel"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <svg className="analyzer-filter-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16l-6.5 7.2v5.3l-3 1.5v-6.8L4 5Z" />
        </svg>
        <span className="analyzer-filter-toggle-label">Filter:</span>
        {draft.filterType === 'per' ? (
          <Badge className="active-filter-label filter-per-label" color="purple" size="xs">PER</Badge>
        ) : null}
        {savedFilterIsModified ? (
          <Badge className="active-filter-label filter-unsaved-label" color="warning" size="xs">Unsaved</Badge>
        ) : null}
        {activeFilterName ? (
          <Badge className="active-filter-label filter-name-label" color="success" size="xs">{activeFilterName}</Badge>
        ) : hasCriteria ? (
          <Badge className="active-filter-label filter-unsaved-label" color="warning" size="xs">Unsaved</Badge>
        ) : (
          <Badge className="active-filter-label filter-empty-label" color="gray" size="xs">Empty</Badge>
        )}
        <svg
          className={`analyzer-filter-chevron${expanded ? ' is-expanded' : ''}`}
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </Button>
      {expanded ? (
        <div className="analyzer-filter-panel" id="analyzer-filter-panel">
          <form onSubmit={apply}>
            <div className="analyzer-filter-menu">
              <Button color="default" outline size="xs" type="button" onClick={clear} disabled={busy}>Clear</Button>
              <Button
                color={hasUnappliedChanges ? 'red' : 'default'}
                outline={!hasUnappliedChanges}
                size="xs"
                type="submit"
                disabled={busy || !hasUnappliedChanges}
              >
                Apply
              </Button>
              <Dropdown color="default" outline size="xs" type="button" label="File" placement="bottom-start" disabled={busy}>
                <DropdownItem className="filter-file-menu-item" onClick={onOpenSavedFilters} disabled={busy}>Open</DropdownItem>
                <DropdownItem
                  className="filter-file-menu-item"
                  onClick={onCloseSavedFilter}
                  disabled={busy || !hasOpenSavedFilter}
                >
                  Close
                </DropdownItem>
                <DropdownItem
                  className="filter-file-menu-item"
                  onClick={() => runFileAction(onSave)}
                  disabled={busy || !hasCriteria || !canSave || !savedFilterIsModified}
                >
                  Save
                </DropdownItem>
                <DropdownItem
                  className="filter-file-menu-item"
                  onClick={() => runFileAction(onSaveAs)}
                  disabled={busy || !hasCriteria}
                >
                  Save as…
                </DropdownItem>
              </Dropdown>
              <Dropdown
                className="analyzer-filter-type"
                aria-label="Filter type"
                color="default"
                outline
                size="xs"
                type="button"
                label={draft.filterType === 'per' ? 'Packet Error Rate filter' : 'Normal filter'}
                placement="bottom-start"
                disabled={busy}
              >
                <DropdownItem onClick={() => changeFilterType('sniffer')}>Normal filter</DropdownItem>
                <DropdownItem onClick={() => changeFilterType('per')}>Packet Error Rate filter</DropdownItem>
              </Dropdown>
            </div>
            <div className="analyzer-filter-grid">
              {draft.filterType === 'sniffer' ? (
                <FilterField label="Search" value={draft.text} placeholder="Payload, address, MType…" onChange={(value) => update('text', value)} />
              ) : null}
              {draft.filterType === 'per' ? (
                <FilterField label="Device Address *" value={draft.devAddr} placeholder="26011ABC" onChange={(value) => update('devAddr', value)} />
              ) : null}
              <DateTimeFilterField
                label={draft.filterType === 'per' ? 'Start time' : 'Observed from'}
                date={draft.fromDate}
                time={draft.fromTime}
                onDateChange={(value) => update('fromDate', value)}
                onTimeChange={(value) => update('fromTime', value)}
              />
              <DateTimeFilterField
                label={draft.filterType === 'per' ? 'End time' : 'Observed to'}
                date={draft.toDate}
                time={draft.toTime}
                onDateChange={(value) => update('toDate', value)}
                onTimeChange={(value) => update('toTime', value)}
              />
              {draft.filterType === 'per' ? (
                <>
                  <FilterField label="Start FCnt" value={draft.fCntFrom} placeholder="100" inputMode="numeric" onChange={(value) => update('fCntFrom', value)} />
                  <FilterField label="End FCnt" value={draft.fCntTo} placeholder="500" inputMode="numeric" onChange={(value) => update('fCntTo', value)} />
                </>
              ) : (
                <>
                  <FilterField label="DevEUI" value={draft.devEui} placeholder="70B3D57ED0001001" onChange={(value) => update('devEui', value)} />
                  <FilterField label="DevAddr" value={draft.devAddr} placeholder="26011ABC" onChange={(value) => update('devAddr', value)} />
                  <FilterField label="Gateway" value={draft.gatewayId} placeholder="647FDAFFFE005E17" onChange={(value) => update('gatewayId', value)} />
                  <FilterField label="FPort" value={draft.fPort} placeholder="1, 10, 100" inputMode="numeric" onChange={(value) => update('fPort', value)} />
                  <FilterSelect label="Modulation" value={draft.modulation} onChange={(value) => update('modulation', value)} />
                  <FilterField label="Data rate" value={draft.dataRate} placeholder="M0CW137, SF7BW125" onChange={(value) => update('dataRate', value)} />
                  <FilterField label="LoRa SF" value={draft.spreadingFactor} placeholder="7, 8, 12" inputMode="numeric" onChange={(value) => update('spreadingFactor', value)} />
                  <FilterField label="Minimum RSSI" value={draft.rssiMinimum} placeholder="-110" inputMode="decimal" onChange={(value) => update('rssiMinimum', value)} />
                  <FilterField label="Minimum SNR" value={draft.snrMinimum} placeholder="-10" inputMode="decimal" onChange={(value) => update('snrMinimum', value)} />
                </>
              )}
            </div>
            {validationError ? <Alert className="mt-3" color="failure">{validationError}</Alert> : null}
          </form>
        </div>
      ) : null}
    </>
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
    <div>
      <div className="filter-field-label"><Label>{label}</Label></div>
      <TextInput
        sizing="sm"
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

interface DateTimeFilterFieldProps {
  label: string;
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}

function DateTimeFilterField({
  label,
  date,
  time,
  onDateChange,
  onTimeChange,
}: DateTimeFilterFieldProps) {
  const nativeDatePicker = useRef<HTMLInputElement>(null);

  function openDatePicker() {
    if (typeof nativeDatePicker.current?.showPicker === 'function') {
      nativeDatePicker.current.showPicker();
    } else {
      nativeDatePicker.current?.click();
    }
  }

  return (
    <div className="analyzer-filter-field">
      <div className="filter-field-label"><Label>{label}</Label></div>
      <span className="analyzer-datetime-inputs">
        <span className="analyzer-date-input">
          <TextInput
            sizing="sm"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${label} date`}
            value={date}
            placeholder="YYYY-MM-DD"
            onChange={(event) => onDateChange(event.target.value)}
          />
          <button
            className="analyzer-date-picker-trigger"
            type="button"
            aria-label={`Pick ${label.toLowerCase()} date`}
            onClick={openDatePicker}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3v3m10-3v3M4.5 9h15M6 5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 6 5Z" />
            </svg>
          </button>
          <input
            ref={nativeDatePicker}
            className="analyzer-native-date-picker"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </span>
        <TimeField
          className="analyzer-time-input"
          aria-label={`${label} time`}
          value={parseTimeFilterValue(time)}
          hourCycle={24}
          granularity="second"
          shouldForceLeadingZeros
          onChange={(value) => onTimeChange(formatTimeFilterValue(value))}
        >
          <DateInput className="analyzer-time-field">
            {(segment) => <DateSegment className="analyzer-time-segment" segment={segment} />}
          </DateInput>
        </TimeField>
      </span>
    </div>
  );
}

function FilterSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <div className="filter-field-label"><Label>{label}</Label></div>
      <Select sizing="sm" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any modulation</option>
        <option value="LR-FHSS">LR-FHSS</option>
        <option value="LORA">LoRa</option>
        <option value="FSK">FSK</option>
      </Select>
    </div>
  );
}

export function normalizeFilterDraft(input: FilterDraft): {
  draft: FilterDraft;
  filters: UplinkFilters | undefined;
} {
  const draft = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
  ) as unknown as FilterDraft;
  const from = parseLocalDateAndTime(draft.fromDate, draft.fromTime, 'Observed from', false);
  const to = parseLocalDateAndTime(draft.toDate, draft.toTime, 'Observed to', true);
  if (from && to && from > to) throw new Error('Observed from must not be after observed to.');

  const fCntFrom = parseOptionalInteger(draft.fCntFrom, 'Start FCnt', 0, 4_294_967_295);
  const fCntTo = parseOptionalInteger(draft.fCntTo, 'End FCnt', 0, 4_294_967_295);
  if (fCntFrom !== undefined && fCntTo !== undefined && fCntFrom > fCntTo) {
    throw new Error('Start FCnt must not exceed End FCnt.');
  }
  if (draft.filterType === 'per') {
    const devAddrs = draft.devAddr ? splitIdentifiers(draft.devAddr) : [];
    if (devAddrs.length !== 1) throw new Error('A PER dataset filter requires exactly one Device Address.');
    const devAddr = devAddrs[0].replace(/[:\s-]/g, '').toUpperCase();
    if (!/^[0-9A-F]{8}$/.test(devAddr)) {
      throw new Error('Device Address must contain exactly 8 hexadecimal digits.');
    }
    draft.devAddr = devAddr;
    const filters: UplinkFilters = {
      packet: compactObject({
        from: from?.toISOString(),
        to: to?.toISOString(),
        devAddrs: [devAddr],
        fCnt: fCntFrom === undefined && fCntTo === undefined
          ? undefined
          : compactObject({ minimum: fCntFrom, maximum: fCntTo }),
      }),
    };
    return { draft, filters };
  }

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

export function filterDraftFromSavedDefinition(definition: SavedFilterDefinition): FilterDraft {
  const filters = savedFilterDefinitionToFilters(definition);
  const packet = filters?.packet;
  const reception = filters?.reception;
  const from = splitTimestampForDraft(packet?.from);
  const to = splitTimestampForDraft(packet?.to);
  return {
    ...EMPTY_FILTERS,
    filterType: definition.type,
    text: packet?.text ?? '',
    fromDate: from.date,
    fromTime: from.time,
    toDate: to.date,
    toTime: to.time,
    devEui: packet?.devEuis?.join(', ') ?? '',
    devAddr: packet?.devAddrs?.join(', ') ?? '',
    fCntFrom: formatOptionalNumber(packet?.fCnt?.minimum),
    fCntTo: formatOptionalNumber(packet?.fCnt?.maximum),
    gatewayId: reception?.gatewayIds?.join(', ') ?? '',
    fPort: packet?.fPorts?.join(', ') ?? '',
    modulation: packet?.modulations?.[0] ?? '',
    dataRate: packet?.dataRates?.join(', ') ?? '',
    spreadingFactor: reception?.spreadingFactors?.join(', ') ?? '',
    rssiMinimum: formatOptionalNumber(reception?.rssiDbm?.minimum),
    snrMinimum: formatOptionalNumber(reception?.snrDb?.minimum),
  };
}

function hasFilterCriteria(filters: FilterDraft): boolean {
  const timeRangeSet = Boolean(
    filters.fromDate.trim() ||
    filters.fromTime.trim() ||
    filters.toDate.trim() ||
    filters.toTime.trim(),
  );
  if (filters.filterType === 'per') {
    return Boolean(
      timeRangeSet ||
      filters.devAddr.trim() ||
      filters.fCntFrom.trim() ||
      filters.fCntTo.trim(),
    );
  }
  return Boolean(
    timeRangeSet ||
    filters.text.trim() ||
    filters.devEui.trim() ||
    filters.devAddr.trim() ||
    filters.gatewayId.trim() ||
    filters.fPort.trim() ||
    filters.modulation.trim() ||
    filters.dataRate.trim() ||
    filters.spreadingFactor.trim() ||
    filters.rssiMinimum.trim() ||
    filters.snrMinimum.trim(),
  );
}

function parseLocalDateAndTime(
  date: string,
  time: string,
  label: string,
  endOfDay: boolean,
): Date | undefined {
  if (!date && !time) return undefined;
  if (!date) throw new Error(`${label} requires a date.`);
  if (time && !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) {
    throw new Error(`${label} time must use HH:MM or HH:MM:SS.`);
  }
  return parseLocalTimestamp(`${date}${time ? ` ${time}` : ''}`, endOfDay);
}

function parseTimeFilterValue(value: string): TimeValue | null {
  if (!value) return null;
  try {
    return parseTime(value);
  } catch {
    return null;
  }
}

function formatTimeFilterValue(value: TimeValue | null): string {
  if (!value) return '';
  return [value.hour, value.minute, value.second]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
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

function parseOptionalInteger(value: string, label: string, minimum: number, maximum: number): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function splitTimestampForDraft(value?: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('A saved filter contains an invalid timestamp.');
  const date = [timestamp.getFullYear(), timestamp.getMonth() + 1, timestamp.getDate()]
    .map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'))
    .join('-');
  const time = [timestamp.getHours(), timestamp.getMinutes(), timestamp.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return { date, time };
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? '' : String(value);
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
