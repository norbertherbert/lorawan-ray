import type { Surreal } from 'surrealdb';
import type { Modulation, NumericRange, UplinkFilters } from './types.ts';

export type SavedFilterType = 'sniffer' | 'per';
export type SavedFilterVisibility = 'private' | 'shared';

export interface SnifferSavedFilterDefinition {
  type: 'sniffer';
  version: 1;
  filters: UplinkFilters;
}

export interface PerSavedFilterDefinition {
  type: 'per';
  version: 1;
  devAddr: string;
  observedFrom?: string;
  observedTo?: string;
  fCntFrom?: number;
  fCntTo?: number;
}

export type SavedFilterDefinition = SnifferSavedFilterDefinition | PerSavedFilterDefinition;

export interface SavedFilter {
  id: string;
  name: string;
  description: string | null;
  visibility: SavedFilterVisibility;
  ownerId: string;
  ownerName: string;
  definition: SavedFilterDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedFilterInput {
  name: string;
  description?: string;
  visibility: SavedFilterVisibility;
  definition: SavedFilterDefinition;
}

export interface UpdateSavedFilterInput {
  definition: SavedFilterDefinition;
}

type SavedFilterQueryClient = Pick<Surreal, 'query'>;

interface SavedFilterRow {
  __record_key: unknown;
  __owner_id: unknown;
  name: unknown;
  description?: unknown;
  visibility: unknown;
  owner_name: unknown;
  definition: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export class SurrealSavedFilterDataSource {
  readonly #db: SavedFilterQueryClient;

  constructor(db: SavedFilterQueryClient) {
    this.#db = db;
  }

  async list(): Promise<SavedFilter[]> {
    const [rows] = await this.#db.query(`
      SELECT *, record::id(id) AS __record_key, <string>owner AS __owner_id
      FROM saved_filter
      ORDER BY updated_at DESC, name ASC;
    `).json().collect<[SavedFilterRow[]]>();
    if (!Array.isArray(rows)) throw new Error('The saved-filter query did not return a row array.');
    return rows.map(parseSavedFilterRow);
  }

  async get(id: string): Promise<SavedFilter> {
    const recordKey = validateRecordKey(id);
    const [row] = await this.#db.query(`
      SELECT *, record::id(id) AS __record_key, <string>owner AS __owner_id
      FROM ONLY type::record("saved_filter", $record_key);
    `, { record_key: recordKey }).json().collect<[SavedFilterRow | null]>();
    if (!row) throw new Error('The saved filter does not exist or is not accessible.');
    return parseSavedFilterRow(row);
  }

  async create(input: CreateSavedFilterInput): Promise<SavedFilter> {
    const recordKey = crypto.randomUUID();
    const normalized = normalizeSavedFilterInput(input);
    await this.#db.query(`
      CREATE ONLY type::record("saved_filter", $record_key) SET
        name = $name,
        description = IF $description = "" { NONE } ELSE { $description },
        visibility = $visibility,
        owner = $auth.id,
        definition = $definition;
    `, { record_key: recordKey, ...normalized });
    return this.get(recordKey);
  }

  async update(id: string, input: UpdateSavedFilterInput): Promise<SavedFilter> {
    const recordKey = validateRecordKey(id);
    const definition = parseSavedFilterDefinition(input.definition);
    await this.#db.query(`
      UPDATE ONLY type::record("saved_filter", $record_key) SET
        definition = $definition;
    `, { record_key: recordKey, definition });
    return this.get(recordKey);
  }

  async delete(id: string): Promise<void> {
    const recordKey = validateRecordKey(id);
    await this.#db.query(
      'DELETE ONLY type::record("saved_filter", $record_key);',
      { record_key: recordKey },
    );
  }
}

export function createSavedFilterDefinition(
  type: SavedFilterType,
  filters: UplinkFilters | undefined,
): SavedFilterDefinition {
  if (type === 'sniffer') {
    return { type, version: 1, filters: cloneFilters(filters ?? {}) };
  }

  const packet = filters?.packet;
  const devAddrs = packet?.devAddrs ?? [];
  if (devAddrs.length !== 1) throw new Error('A PER dataset filter requires exactly one Device Address.');
  const devAddr = normalizeDevAddr(devAddrs[0]);
  return compactObject({
    type,
    version: 1 as const,
    devAddr,
    observedFrom: packet?.from,
    observedTo: packet?.to,
    fCntFrom: packet?.fCnt?.minimum,
    fCntTo: packet?.fCnt?.maximum,
  });
}

export function savedFilterDefinitionToFilters(definition: SavedFilterDefinition): UplinkFilters | undefined {
  const parsed = parseSavedFilterDefinition(definition);
  if (parsed.type === 'sniffer') {
    return Object.keys(parsed.filters).length ? cloneFilters(parsed.filters) : undefined;
  }
  return {
    packet: compactObject({
      devAddrs: [parsed.devAddr],
      from: parsed.observedFrom,
      to: parsed.observedTo,
      fCnt: parsed.fCntFrom === undefined && parsed.fCntTo === undefined
        ? undefined
        : compactObject({ minimum: parsed.fCntFrom, maximum: parsed.fCntTo }),
    }),
  };
}

export function savedFilterDefinitionSignature(definition: SavedFilterDefinition): string {
  return stableStringify(parseSavedFilterDefinition(definition));
}

export function savedFilterUrl(id: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('filter', validateRecordKey(id));
  return url.toString();
}

export function savedFilterIdFromLocation(): string | null {
  const value = new URL(window.location.href).searchParams.get('filter');
  if (!value) return null;
  return validateRecordKey(value);
}

export function setSavedFilterLocation(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('filter', validateRecordKey(id));
  else url.searchParams.delete('filter');
  window.history.replaceState(null, '', url);
}

function normalizeSavedFilterInput(input: CreateSavedFilterInput) {
  const name = input.name.trim();
  const description = input.description?.trim() || '';
  if (!name) throw new Error('Filter name is required.');
  if (name.length > 80) throw new Error('Filter name must not exceed 80 characters.');
  if (description && description.length > 500) throw new Error('Description must not exceed 500 characters.');
  if (input.visibility !== 'private' && input.visibility !== 'shared') {
    throw new Error('The saved-filter visibility is invalid.');
  }
  return {
    name,
    description,
    visibility: input.visibility,
    definition: parseSavedFilterDefinition(input.definition),
  };
}

function parseSavedFilterRow(row: SavedFilterRow): SavedFilter {
  const name = requiredString(row.name, 'name');
  const visibility = row.visibility;
  if (visibility !== 'private' && visibility !== 'shared') {
    throw new Error(`Saved filter ${name} has an invalid visibility.`);
  }
  return {
    id: validateRecordKey(requiredString(row.__record_key, 'record key')),
    name,
    description: row.description == null ? null : requiredString(row.description, 'description'),
    visibility,
    ownerId: requiredString(row.__owner_id, 'owner'),
    ownerName: requiredString(row.owner_name, 'owner name'),
    definition: parseSavedFilterDefinition(row.definition),
    createdAt: isoTimestamp(row.created_at, 'created_at'),
    updatedAt: isoTimestamp(row.updated_at, 'updated_at'),
  };
}

function parseSavedFilterDefinition(value: unknown): SavedFilterDefinition {
  if (!isObject(value) || value.version !== 1) throw new Error('Unsupported saved-filter definition.');
  if (value.type === 'sniffer') {
    return { type: 'sniffer', version: 1, filters: parseUplinkFilters(value.filters) };
  }
  if (value.type === 'per') {
    const devAddr = normalizeDevAddr(requiredString(value.devAddr, 'PER Device Address'));
    const observedFrom = optionalTimestamp(value.observedFrom, 'PER start time');
    const observedTo = optionalTimestamp(value.observedTo, 'PER end time');
    const fCntFrom = optionalFcnt(value.fCntFrom, 'PER start FCnt');
    const fCntTo = optionalFcnt(value.fCntTo, 'PER end FCnt');
    if (observedFrom && observedTo && Date.parse(observedFrom) > Date.parse(observedTo)) {
      throw new Error('The PER start time must not be after its end time.');
    }
    if (fCntFrom !== undefined && fCntTo !== undefined && fCntFrom > fCntTo) {
      throw new Error('The PER start FCnt must not exceed its end FCnt.');
    }
    return compactObject({ type: 'per' as const, version: 1 as const, devAddr, observedFrom, observedTo, fCntFrom, fCntTo });
  }
  throw new Error('Unsupported saved-filter type.');
}

function parseUplinkFilters(value: unknown): UplinkFilters {
  if (!isObject(value)) throw new Error('The Sniffer filter definition is invalid.');
  const packet = value.packet === undefined ? undefined : parsePacketFilters(value.packet);
  const reception = value.reception === undefined ? undefined : parseReceptionFilters(value.reception);
  return compactObject({ packet, reception });
}

function parsePacketFilters(value: unknown): NonNullable<UplinkFilters['packet']> {
  if (!isObject(value)) throw new Error('The packet filter definition is invalid.');
  return compactObject({
    from: optionalTimestamp(value.from, 'filter start time'),
    to: optionalTimestamp(value.to, 'filter end time'),
    devEuis: optionalStringArray(value.devEuis, 'DevEUI'),
    devAddrs: optionalStringArray(value.devAddrs, 'Device Address'),
    fCnt: optionalRange(value.fCnt, 'FCnt'),
    fPorts: optionalNumberArray(value.fPorts, 'FPort'),
    mTypes: optionalStringArray(value.mTypes, 'MType') as NonNullable<UplinkFilters['packet']>['mTypes'],
    modulations: optionalStringArray(value.modulations, 'modulation') as Modulation[] | undefined,
    dataRates: optionalStringOrNumberArray(value.dataRates, 'data rate'),
    text: optionalString(value.text, 'search text'),
  });
}

function parseReceptionFilters(value: unknown): NonNullable<UplinkFilters['reception']> {
  if (!isObject(value)) throw new Error('The reception filter definition is invalid.');
  return compactObject({
    gatewayIds: optionalStringArray(value.gatewayIds, 'gateway'),
    spreadingFactors: optionalNumberArray(value.spreadingFactors, 'spreading factor'),
    frequencyMHz: optionalRange(value.frequencyMHz, 'frequency'),
    rssiDbm: optionalRange(value.rssiDbm, 'RSSI'),
    snrDb: optionalRange(value.snrDb, 'SNR'),
  });
}

function optionalRange(value: unknown, label: string): NumericRange | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`The ${label} range is invalid.`);
  const minimum = optionalNumber(value.minimum, `${label} minimum`);
  const maximum = optionalNumber(value.maximum, `${label} maximum`);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new Error(`The ${label} minimum must not exceed its maximum.`);
  }
  return compactObject({ minimum, maximum });
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`The saved ${label} filter is invalid.`);
  }
  return value as string[];
}

function optionalNumberArray(value: unknown, label: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`The saved ${label} filter is invalid.`);
  }
  return value as number[];
}

function optionalStringOrNumberArray(value: unknown, label: string): Array<string | number> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' && (typeof item !== 'number' || !Number.isFinite(item)))) {
    throw new Error(`The saved ${label} filter is invalid.`);
  }
  return value as Array<string | number>;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const timestamp = requiredString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`The saved ${label} is invalid.`);
  return timestamp;
}

function optionalFcnt(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  const number = optionalNumber(value, label);
  if (number === undefined || !Number.isInteger(number) || number < 0 || number > 4_294_967_295) {
    throw new Error(`${label} must be an integer from 0 to 4294967295.`);
  }
  return number;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The saved ${label} is invalid.`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`The saved-filter ${label} is invalid.`);
  return value;
}

function normalizeDevAddr(value: string): string {
  const normalized = value.replace(/[:\s-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(normalized)) throw new Error('Device Address must contain exactly 8 hexadecimal digits.');
  return normalized;
}

function validateRecordKey(value: string): string {
  const key = value.startsWith('saved_filter:') ? value.slice('saved_filter:'.length) : value;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error('The saved-filter ID is invalid.');
  return key;
}

function isoTimestamp(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`The saved-filter ${label} is invalid.`);
  return date.toISOString();
}

function cloneFilters(filters: UplinkFilters): UplinkFilters {
  return JSON.parse(JSON.stringify(filters)) as UplinkFilters;
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
