import { mockUplinks, toUplinkSummary } from '../mocks/uplinks.ts';
import type {
  DataSourceOptions,
  GatewayReception,
  NumericRange,
  PacketErrorRateResult,
  PacketFilters,
  ReceptionFilters,
  UplinkDataSource,
  UplinkDetails,
  UplinkFilters,
  UplinkPage,
  UplinkSearchRequest,
  UplinkSort,
  UplinkSortField,
  UplinkSummary,
} from './types.ts';
import { UplinkDataSourceError } from './types.ts';
import { calculatePacketErrorRate } from './packetErrorRate.ts';

const MAX_PAGE_SIZE = 250;
const DEFAULT_SORTING: readonly UplinkSort[] = [{ field: 'observedAt', direction: 'desc' }];

interface MockCursor {
  version: 1;
  index: number;
  requestKey: string;
}

export class MockUplinkDataSource implements UplinkDataSource {
  readonly #records: readonly UplinkDetails[];

  constructor(records: readonly UplinkDetails[] = mockUplinks) {
    this.#records = records;
  }

  async search(request: UplinkSearchRequest, options: DataSourceOptions = {}): Promise<UplinkPage> {
    throwIfAborted(options.signal);
    validateRequest(request);

    const sorting = request.sorting?.length ? request.sorting : DEFAULT_SORTING;
    const requestKey = stableStringify({ sorting, filters: request.filters ?? {} });
    const filtered = this.#records.filter((record) => matchesFilters(record, request.filters));
    const summaries = filtered.map(toUplinkSummary).sort(createComparator(sorting));
    let start = 0;
    let end = summaries.length;

    if (request.page.after) {
      start = decodeCursor(request.page.after, requestKey).index + 1;
      end = Math.min(start + request.page.limit, summaries.length);
    } else if (request.page.before) {
      end = Math.min(decodeCursor(request.page.before, requestKey).index, summaries.length);
      start = Math.max(0, end - request.page.limit);
    } else {
      end = Math.min(request.page.limit, summaries.length);
    }

    if (start > summaries.length) {
      throw new UplinkDataSourceError('invalid_cursor', 'The cursor is outside this result set.');
    }

    const items = summaries.slice(start, end);
    throwIfAborted(options.signal);

    return {
      items,
      pageInfo: {
        startCursor: items.length ? encodeCursor(start, requestKey) : null,
        endCursor: items.length ? encodeCursor(end - 1, requestKey) : null,
        hasPreviousPage: start > 0,
        hasNextPage: end < summaries.length,
      },
    };
  }

  async calculatePacketErrorRate(
    filters: UplinkFilters,
    options: DataSourceOptions = {},
  ): Promise<PacketErrorRateResult | null> {
    throwIfAborted(options.signal);
    validateRequest({ page: { limit: 1 }, filters });
    const frameCounters = this.#records
      .filter((record) => matchesFilters(record, filters))
      .flatMap((record) => record.fCnt === null ? [] : [record.fCnt]);
    throwIfAborted(options.signal);
    return calculatePacketErrorRate(frameCounters, filters.packet?.fCnt);
  }

  async getById(id: string, options: DataSourceOptions = {}): Promise<UplinkDetails> {
    throwIfAborted(options.signal);
    const record = this.#records.find((candidate) => candidate.id === id);
    if (!record) {
      throw new UplinkDataSourceError('not_found', `Uplink ${id} was not found.`);
    }
    return record;
  }
}

export const mockUplinkDataSource = new MockUplinkDataSource();

function validateRequest(request: UplinkSearchRequest): void {
  const { page, sorting = [], filters } = request;
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_SIZE) {
    throw new UplinkDataSourceError(
      'invalid_request',
      `Page size must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }
  if (page.after && page.before) {
    throw new UplinkDataSourceError(
      'invalid_request',
      'A page request cannot contain both after and before cursors.',
    );
  }
  if (sorting.length > 3 || new Set(sorting.map(({ field }) => field)).size !== sorting.length) {
    throw new UplinkDataSourceError(
      'invalid_request',
      'Use at most three unique sorting fields.',
    );
  }

  validateFilters(filters);
}

function validateFilters(filters?: UplinkFilters): void {
  const from = parseOptionalDate(filters?.packet?.from, 'from');
  const to = parseOptionalDate(filters?.packet?.to, 'to');
  if (from !== null && to !== null && from > to) {
    throw new UplinkDataSourceError('invalid_request', 'The from time must not be after to.');
  }

  validateRange(filters?.reception?.frequencyMHz, 'frequency');
  validateRange(filters?.reception?.rssiDbm, 'RSSI');
  validateRange(filters?.reception?.snrDb, 'SNR');
  validateRange(filters?.packet?.fCnt, 'FCnt');

  if (filters?.packet?.fPorts?.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new UplinkDataSourceError('invalid_request', 'FPort values must be integers from 0 to 255.');
  }
  if (
    filters?.reception?.spreadingFactors?.some(
      (value) => !Number.isInteger(value) || value < 5 || value > 12,
    )
  ) {
    throw new UplinkDataSourceError('invalid_request', 'Spreading factors must be integers from 5 to 12.');
  }
}

function validateRange(range: NumericRange | undefined, name: string): void {
  if (range?.minimum !== undefined && !Number.isFinite(range.minimum)) {
    throw new UplinkDataSourceError('invalid_request', `${name} minimum must be a number.`);
  }
  if (range?.maximum !== undefined && !Number.isFinite(range.maximum)) {
    throw new UplinkDataSourceError('invalid_request', `${name} maximum must be a number.`);
  }
  if (
    range?.minimum !== undefined &&
    range.maximum !== undefined &&
    range.minimum > range.maximum
  ) {
    throw new UplinkDataSourceError(
      'invalid_request',
      `${name} minimum must not be greater than its maximum.`,
    );
  }
}

function parseOptionalDate(value: string | undefined, name: string): number | null {
  if (value === undefined) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new UplinkDataSourceError('invalid_request', `${name} must be a valid timestamp.`);
  }
  return parsed;
}

function matchesFilters(record: UplinkDetails, filters?: UplinkFilters): boolean {
  return matchesPacketFilters(record, filters?.packet) && matchesReceptionFilters(record, filters?.reception);
}

function matchesPacketFilters(record: UplinkDetails, filters?: PacketFilters): boolean {
  if (!filters) return true;
  const observedAt = Date.parse(record.observedAt);
  if (filters.from && observedAt < Date.parse(filters.from)) return false;
  if (filters.to && observedAt > Date.parse(filters.to)) return false;
  if (filters.devEuis?.length && !matchesHex(filters.devEuis, record.devEui)) return false;
  if (filters.devAddrs?.length && !matchesHex(filters.devAddrs, record.devAddr)) return false;
  if (!matchesRange(record.fCnt, filters.fCnt)) return false;
  if (filters.fPorts?.length && (record.fPort === null || !filters.fPorts.includes(record.fPort))) {
    return false;
  }
  if (filters.mTypes?.length && !filters.mTypes.includes(record.mType)) return false;
  if (
    filters.modulations?.length &&
    (record.modulation === null || !filters.modulations.includes(record.modulation))
  ) return false;
  if (
    filters.dataRates?.length &&
    (record.dataRate === null || !filters.dataRates.some((value) => String(value) === String(record.dataRate)))
  ) return false;

  const text = filters.text?.trim().toLocaleUpperCase();
  if (text) {
    const searchable = [
      record.id,
      record.devEui,
      record.devAddr,
      record.mType,
      record.modulation,
      record.dataRate === null ? null : String(record.dataRate),
      record.phyPayloadHex,
      ...record.receptions.map(({ gatewayId }) => gatewayId),
    ];
    if (!searchable.some((value) => value?.toLocaleUpperCase().includes(text))) return false;
  }
  return true;
}

function matchesReceptionFilters(record: UplinkDetails, filters?: ReceptionFilters): boolean {
  if (!filters || !hasReceptionFilter(filters)) return true;
  return record.receptions.some((reception) => {
    if (filters.gatewayIds?.length && !matchesHex(filters.gatewayIds, reception.gatewayId)) return false;
    if (
      filters.spreadingFactors?.length &&
      (reception.spreadingFactor === null || !filters.spreadingFactors.includes(reception.spreadingFactor))
    ) {
      return false;
    }
    return (
      matchesRange(reception.frequencyMHz, filters.frequencyMHz) &&
      matchesRange(reception.bestRssiDbm, filters.rssiDbm) &&
      matchesRange(reception.bestSnrDb, filters.snrDb)
    );
  });
}

function hasReceptionFilter(filters: ReceptionFilters): boolean {
  return Boolean(
    filters.gatewayIds?.length ||
      filters.spreadingFactors?.length ||
      filters.frequencyMHz ||
      filters.rssiDbm ||
      filters.snrDb,
  );
}

function matchesHex(expected: string[], actual: string | null): boolean {
  if (actual === null) return false;
  const normalizedActual = normalizeHex(actual);
  return expected.some((value) => normalizeHex(value) === normalizedActual);
}

function normalizeHex(value: string): string {
  return value.replace(/[:\s-]/g, '').toUpperCase();
}

function matchesRange(value: number | null, range?: NumericRange): boolean {
  if (!range) return true;
  if (value === null) return false;
  return (range.minimum === undefined || value >= range.minimum) &&
    (range.maximum === undefined || value <= range.maximum);
}

function createComparator(sorting: readonly UplinkSort[]) {
  return (left: UplinkSummary, right: UplinkSummary): number => {
    for (const sort of sorting) {
      const leftValue = left[sort.field];
      const rightValue = right[sort.field];
      if (leftValue === rightValue) continue;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;

      const result = compareValues(leftValue, rightValue);
      if (result !== 0) return sort.direction === 'desc' ? -result : result;
    }
    if (!sorting.some(({ field }) => field === 'observedAt')) {
      const timestampResult = right.observedAt.localeCompare(left.observedAt);
      if (timestampResult !== 0) return timestampResult;
    }
    return right.id.localeCompare(left.id);
  };
}

function compareValues(
  left: Exclude<UplinkSummary[UplinkSortField], null>,
  right: Exclude<UplinkSummary[UplinkSortField], null>,
): number {
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right));
}

function encodeCursor(index: number, requestKey: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, index, requestKey }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeCursor(value: string, requestKey: string): MockCursor {
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MockCursor>;
    if (
      parsed.version !== 1 ||
      !Number.isInteger(parsed.index) ||
      Number(parsed.index) < 0 ||
      parsed.requestKey !== requestKey
    ) {
      throw new Error('Invalid cursor contents.');
    }
    return parsed as MockCursor;
  } catch (cause) {
    if (cause instanceof UplinkDataSourceError) throw cause;
    throw new UplinkDataSourceError('invalid_cursor', 'The page cursor is invalid or stale.');
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new UplinkDataSourceError('request_aborted', 'The uplink request was cancelled.');
  }
}
