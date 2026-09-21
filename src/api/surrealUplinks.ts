import { RecordId, type Surreal } from 'surrealdb';
import type {
  DatabaseDecodedLoRaWAN,
  DatabasePhyPayload,
  DatabaseRadioMetadata,
  DatabaseSignal,
} from './databaseTypes.ts';
import type {
  DataSourceOptions,
  GatewayReception,
  Modulation,
  NumericRange,
  PacketErrorRateResult,
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
import { MAX_UPLINK_PAGE_SIZE } from './types.ts';
import { calculatePacketErrorRate } from './packetErrorRate.ts';
import type {
  DecodedLoRaWANFrame,
  LoRaWANMajor,
  LoRaWANMessageType,
} from '../lorawan/types.ts';

const DEFAULT_SORTING: readonly UplinkSort[] = [{ field: 'observedAt', direction: 'desc' }];
const PER_PACKET_LIMIT = 1_000;
const TEXT_SEARCH_CANDIDATE_LIMIT = 1_000;
const UPLINK_COMMON_PROJECTION = `
          schema_version,
          observed_at,
          dev_eui,
          dev_addr,
          fcnt16,
          fport,
          mtype,
          modulation,
          data_rate,
          coding_rate,
          hopping_channel_width,
          spreading_factor,
          frequency_hz,
          best_rssi_dbm,
          best_snr_db,
          best_gateway_id,
          reception_count,
          phy.{ payload_hex }`;
const UPLINK_SUMMARY_PROJECTION = `id,
          ${UPLINK_COMMON_PROJECTION},
          lorawan.{ mtype }`;
const UPLINK_DETAIL_PROJECTION = `${UPLINK_COMMON_PROJECTION},
          lorawan`;
const MESSAGE_TYPES: readonly LoRaWANMessageType[] = [
  'JoinRequest',
  'JoinAccept',
  'UnconfirmedDataUp',
  'UnconfirmedDataDown',
  'ConfirmedDataUp',
  'ConfirmedDataDown',
  'RejoinRequest',
  'Proprietary',
];

export type SurrealQueryClient = Pick<Surreal, 'query'>;

interface UplinkSummaryRow {
  schema_version: 1;
  observed_at: string;
  dev_eui?: string;
  dev_addr?: string;
  fcnt16?: number;
  fport?: number;
  mtype?: string;
  modulation?: string;
  data_rate?: string | number;
  coding_rate?: string;
  hopping_channel_width?: number;
  spreading_factor?: number;
  frequency_hz?: number;
  best_rssi_dbm?: number;
  best_snr_db?: number;
  best_gateway_id?: string;
  reception_count?: number;
  phy?: Pick<DatabasePhyPayload, 'payload_hex'>;
  lorawan?: Pick<DatabaseDecodedLoRaWAN, 'mtype'>;
}

interface SearchRow extends UplinkSummaryRow {
  __record_key: string;
  [cursorField: `__sort_${number}`]: string | number;
}

interface DetailsRow extends UplinkSummaryRow {
  __record_key: string;
  lorawan: DatabaseDecodedLoRaWAN;
}

interface ReceptionRow {
  schema_version: 1;
  gateway_id: string;
  observed_at: string;
  ingested_at: string;
  timestamp_source: 'gateway' | 'ingested';
  radio: DatabaseRadioMetadata;
  __record_key: string;
}

interface BulkReceptionRow extends ReceptionRow {
  __uplink_key: string;
}

interface CursorPayload {
  version: 1;
  requestKey: string;
  values: Array<string | number>;
  recordKey: string;
}

interface SortDefinition {
  expression: string;
  valueType: 'datetime' | 'number' | 'string';
  nullable: boolean;
}

interface BuiltSearchQuery {
  text: string;
  variables: Record<string, unknown>;
  sorting: readonly UplinkSort[];
  requestKey: string;
  backwards: boolean;
}

const SORT_DEFINITIONS: Record<UplinkSortField, SortDefinition> = {
  observedAt: { expression: 'observed_at', valueType: 'datetime', nullable: false },
  devEui: { expression: 'dev_eui', valueType: 'string', nullable: true },
  devAddr: { expression: 'dev_addr', valueType: 'string', nullable: true },
  fCnt: { expression: 'fcnt16', valueType: 'number', nullable: true },
  fPort: { expression: 'fport', valueType: 'number', nullable: true },
  mType: { expression: 'mtype', valueType: 'string', nullable: true },
  modulation: { expression: 'modulation', valueType: 'string', nullable: true },
  dataRate: {
    expression: '(IF data_rate IS NONE { NONE } ELSE { <string>data_rate })',
    valueType: 'string',
    nullable: true,
  },
  spreadingFactor: { expression: 'spreading_factor', valueType: 'number', nullable: true },
  frequencyMHz: { expression: 'frequency_hz', valueType: 'number', nullable: true },
  bestRssiDbm: { expression: 'best_rssi_dbm', valueType: 'number', nullable: true },
  bestSnrDb: { expression: 'best_snr_db', valueType: 'number', nullable: true },
  bestGatewayId: { expression: 'best_gateway_id', valueType: 'string', nullable: true },
  phyPayloadHex: { expression: 'phy.payload_hex', valueType: 'string', nullable: false },
};

/**
 * Read-only data source for an already connected and authenticated SurrealDB
 * browser client. Authentication remains owned by App; this class never signs
 * in, changes permissions, or writes data.
 */
export class SurrealUplinkDataSource implements UplinkDataSource {
  readonly #db: SurrealQueryClient;

  constructor(db: SurrealQueryClient) {
    this.#db = db;
  }

  async search(request: UplinkSearchRequest, options: DataSourceOptions = {}): Promise<UplinkPage> {
    throwIfAborted(options.signal);
    const built = buildSearchQuery(request);
    const [rows] = await abortable(
      this.#db
        .query(built.text, built.variables)
        .json()
        .collect<[SearchRow[]]>(),
      options.signal,
    );
    throwIfAborted(options.signal);

    if (!Array.isArray(rows)) invalidResponse('The uplink search did not return a row array.');
    const hasExtra = rows.length > request.page.limit;
    const pageRows = rows.slice(0, request.page.limit);
    if (built.backwards) pageRows.reverse();
    const items = pageRows.map(toUplinkSummary);
    const startCursor = pageRows.length
      ? encodeCursor(pageRows[0], built.sorting, built.requestKey)
      : null;
    const endCursor = pageRows.length
      ? encodeCursor(pageRows[pageRows.length - 1], built.sorting, built.requestKey)
      : null;

    return {
      items,
      pageInfo: {
        startCursor,
        endCursor,
        hasPreviousPage: built.backwards ? hasExtra : Boolean(request.page.after),
        hasNextPage: built.backwards ? Boolean(request.page.before) : hasExtra,
      },
    };
  }

  async calculatePacketErrorRate(
    filters: UplinkFilters,
    options: DataSourceOptions = {},
  ): Promise<PacketErrorRateResult | null> {
    throwIfAborted(options.signal);
    validateRequest({ page: { limit: 1 }, filters });
    const predicates = ['fcnt16 IS NOT NONE'];
    const variables: Record<string, unknown> = { per_limit: PER_PACKET_LIMIT };
    appendFilters(predicates, variables, filters);
    const [values] = await abortable(
      this.#db
        .query(
          `SELECT VALUE fcnt16
           FROM lorawan_uplink
           WHERE ${predicates.join(' AND ')}
           ORDER BY observed_at DESC
           LIMIT $per_limit;`,
          variables,
        )
        .json()
        .collect<[unknown[]]>(),
      options.signal,
    );
    throwIfAborted(options.signal);

    if (!Array.isArray(values)) invalidResponse('The PER query did not return a counter array.');
    const frameCounters = values.map((value) => {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        invalidResponse('The PER query returned an invalid frame counter.');
      }
      return value;
    });
    return calculatePacketErrorRate(frameCounters, filters.packet?.fCnt);
  }

  async getById(id: string, options: DataSourceOptions = {}): Promise<UplinkDetails> {
    throwIfAborted(options.signal);
    if (!id || id.length > 512) {
      throw new UplinkDataSourceError('invalid_request', 'The uplink ID is invalid.');
    }

    const details = await this.getByIds([id], options);
    return details[0];
  }

  async getByIds(
    ids: readonly string[],
    options: DataSourceOptions = {},
  ): Promise<UplinkDetails[]> {
    throwIfAborted(options.signal);
    if (
      ids.length < 1 ||
      ids.length > MAX_UPLINK_PAGE_SIZE ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !id || id.length > 512)
    ) {
      throw new UplinkDataSourceError(
        'invalid_request',
        `Request between 1 and ${MAX_UPLINK_PAGE_SIZE} unique uplink IDs.`,
      );
    }

    const uplinkIds = ids.map((id) => new RecordId('lorawan_uplink', id));

    const query = `
      SELECT ${UPLINK_DETAIL_PROJECTION},
        record::id(id) AS __record_key
      FROM $uplink_ids;
      SELECT
        schema_version,
        gateway_id,
        observed_at,
        ingested_at,
        timestamp_source,
        radio,
        <string>id AS __record_key,
        <string> record::id(uplink) AS __uplink_key
      FROM gateway_reception WITH INDEX reception_uplink
      WHERE uplink IN $uplink_ids;
    `;
    const results = await abortable(
      this.#db
        .query(query, { uplink_ids: uplinkIds })
        .json()
        .collect<[DetailsRow[], BulkReceptionRow[]]>(),
      options.signal,
    );
    throwIfAborted(options.signal);
    const uplinks = results[0];
    const receptions = results[1];
    if (!Array.isArray(uplinks)) invalidResponse('The uplink detail query did not return a row array.');
    if (!Array.isArray(receptions)) invalidResponse('The reception query did not return a row array.');

    const uplinksByKey = new Map(uplinks.map((uplink) => [uplink.__record_key, uplink]));
    const receptionsByUplink = new Map<string, GatewayReception[]>();
    for (const reception of receptions) {
      if (typeof reception.__uplink_key !== 'string') {
        invalidResponse('A gateway reception is missing its uplink key.');
      }
      const grouped = receptionsByUplink.get(reception.__uplink_key) ?? [];
      grouped.push(toGatewayReception(reception));
      receptionsByUplink.set(reception.__uplink_key, grouped);
    }

    return ids.map((id) => {
      const uplink = uplinksByKey.get(id);
      if (!uplink) throw new UplinkDataSourceError('not_found', `Uplink ${id} was not found.`);
      return {
        ...toUplinkSummary(uplink),
        frame: toDecodedFrame(uplink.lorawan, uplink.phy?.payload_hex),
        receptions: (receptionsByUplink.get(id) ?? []).sort(compareGatewayReceptions),
      };
    });
  }
}

/** Builds parameterized SurrealQL. Only whitelisted sort/filter fields become query text. */
export function buildSearchQuery(request: UplinkSearchRequest): BuiltSearchQuery {
  validateRequest(request);
  const sorting = effectiveSorting(request.sorting);
  const requestKey = stableStringify({ sorting, filters: request.filters ?? {} });
  const cursorValue = request.page.after ?? request.page.before;
  const cursor = cursorValue ? decodeCursor(cursorValue, requestKey, sorting.length) : null;
  const backwards = Boolean(request.page.before || request.page.edge === 'oldest');
  const structuredPredicates: string[] = [];
  const textPredicates: string[] = [];
  const variables: Record<string, unknown> = { limit: request.page.limit + 1 };

  appendFilters(structuredPredicates, variables, request.filters, textPredicates);
  const hasTextSearch = textPredicates.length > 0;
  const predicates = hasTextSearch ? textPredicates : structuredPredicates;
  let source = 'lorawan_uplink';
  if (hasTextSearch) {
    variables.text_candidate_limit = TEXT_SEARCH_CANDIDATE_LIMIT;
    const candidateWhere = structuredPredicates.length
      ? `WHERE ${structuredPredicates.join('\n          AND ')}`
      : '';
    source = `(
        SELECT
          ${UPLINK_SUMMARY_PROJECTION},
          gateway_ids
        FROM lorawan_uplink
        ${candidateWhere}
        ORDER BY observed_at DESC, id DESC
        LIMIT $text_candidate_limit
      )`;
  }

  if (sorting.length === 1 && sorting[0].field === 'observedAt') {
    if (cursor) {
      const comparison = comparisonOperator(sorting[0].direction, backwards);
      predicates.push(`(
        observed_at ${comparison} <datetime>$cursor_0
        OR (
          observed_at = <datetime>$cursor_0
          AND id ${comparison} type::record("lorawan_uplink", $cursor_record_key)
        )
      )`);
      variables.cursor_0 = cursorTimestamp(cursor.values[0]);
      variables.cursor_record_key = cursor.recordKey;
    }

    const direction = queryDirection(sorting[0].direction, backwards);
    const where = predicates.length ? `WHERE ${predicates.join('\n        AND ')}` : '';
    return {
      text: `
        SELECT ${UPLINK_SUMMARY_PROJECTION},
          record::id(id) AS __record_key,
          observed_at AS __sort_0
        FROM ${source}
        ${where}
        ORDER BY observed_at ${direction}, id ${direction}
        LIMIT $limit;
      `,
      variables,
      sorting,
      requestKey,
      backwards,
    };
  }

  const sortExpressions = sorting.map((sort, index) => {
    const definition = SORT_DEFINITIONS[sort.field];
    if (!definition.nullable) return definition.expression;
    variables[`sort_null_${index}`] = nullSentinel(definition.valueType, sort.direction);
    return `(${definition.expression} ?? $sort_null_${index})`;
  });

  if (cursor) {
    const cursorPredicates: string[] = [];
    for (let index = 0; index < sorting.length; index += 1) {
      const cursorOperand = cursorQueryOperand(sorting[index].field, index);
      const equals = sortExpressions
        .slice(0, index)
        .map((expression, previous) => (
          `${expression} = ${cursorQueryOperand(sorting[previous].field, previous)}`
        ));
      const comparison = comparisonOperator(sorting[index].direction, backwards);
      cursorPredicates.push(
        [...equals, `${sortExpressions[index]} ${comparison} ${cursorOperand}`].join(' AND '),
      );
      variables[`cursor_${index}`] = cursorQueryValue(sorting[index].field, cursor.values[index]);
    }
    const idEquals = sortExpressions.map(
      (expression, index) => (
        `${expression} = ${cursorQueryOperand(sorting[index].field, index)}`
      ),
    );
    const idDirection = sorting[sorting.length - 1].direction;
    idEquals.push(`record::id(id) ${comparisonOperator(idDirection, backwards)} $cursor_record_key`);
    cursorPredicates.push(idEquals.join(' AND '));
    predicates.push(`(${cursorPredicates.map((value) => `(${value})`).join(' OR ')})`);
    variables.cursor_record_key = cursor.recordKey;
  }

  const selectSortFields = sortExpressions
    .map((expression, index) => `${expression} AS __sort_${index}`)
    .join(',\n        ');
  const orderBy = sorting
    .map((sort, index) => `__sort_${index} ${queryDirection(sort.direction, backwards)}`)
    .concat(`__record_key ${queryDirection(sorting[sorting.length - 1].direction, backwards)}`)
    .join(', ');
  const where = predicates.length ? `WHERE ${predicates.join('\n        AND ')}` : '';

  return {
    text: `
      SELECT ${UPLINK_SUMMARY_PROJECTION},
        record::id(id) AS __record_key,
        ${selectSortFields}
      FROM ${source}
      ${where}
      ORDER BY ${orderBy}
      LIMIT $limit;
    `,
    variables,
    sorting,
    requestKey,
    backwards,
  };
}

function appendFilters(
  predicates: string[],
  variables: Record<string, unknown>,
  filters?: UplinkFilters,
  textPredicates: string[] = predicates,
): void {
  const packet = filters?.packet;
  if (packet?.from) {
    predicates.push('observed_at >= $from');
    variables.from = new Date(packet.from);
  }
  if (packet?.to) {
    predicates.push('observed_at <= $to');
    variables.to = new Date(packet.to);
  }
  if (packet?.devEuis?.length) {
    predicates.push('dev_eui IN $dev_euis');
    variables.dev_euis = packet.devEuis.map(normalizeHex);
  }
  if (packet?.devAddrs?.length) {
    predicates.push('dev_addr IN $dev_addrs');
    variables.dev_addrs = packet.devAddrs.map(normalizeHex);
  }
  appendRange(predicates, variables, 'fcnt16', 'fcnt', packet?.fCnt);
  if (packet?.fPorts?.length) {
    predicates.push('fport IN $fports');
    variables.fports = packet.fPorts;
  }
  if (packet?.mTypes?.length) {
    predicates.push('mtype IN $mtypes');
    variables.mtypes = packet.mTypes;
  }
  if (packet?.modulations?.length) {
    predicates.push('modulation IN $modulations');
    variables.modulations = packet.modulations;
  }
  if (packet?.dataRates?.length) {
    predicates.push('data_rate IN $data_rates');
    variables.data_rates = packet.dataRates;
  }
  const text = packet?.text?.trim();
  if (text) {
    textPredicates.push(`(
      string::contains(string::uppercase(phy.payload_hex), $text)
      OR string::contains(string::uppercase(dev_eui ?? ""), $text)
      OR string::contains(string::uppercase(dev_addr ?? ""), $text)
      OR string::contains(string::uppercase(mtype ?? ""), $text)
      OR string::contains(string::uppercase(modulation ?? ""), $text)
      OR string::contains(string::uppercase(<string>(data_rate ?? "")), $text)
      OR array::any(gateway_ids, |$gateway| string::contains($gateway, $text))
    )`);
    variables.text = text.toUpperCase();
  }

  const reception = filters?.reception;
  if (!reception || !hasReceptionFilter(reception)) return;

  if (reception.gatewayIds?.length) {
    predicates.push('gateway_ids CONTAINSANY $gateway_ids');
    variables.gateway_ids = reception.gatewayIds.map(normalizeHex);
  }

  if (!hasRadioReceptionFilter(reception)) return;

  const receptionPredicates = ['uplink = $parent.id'];
  if (reception.gatewayIds?.length) {
    receptionPredicates.push('gateway_id IN $gateway_ids');
  }
  if (reception.spreadingFactors?.length) {
    receptionPredicates.push('radio.spreading_factor IN $spreading_factors');
    variables.spreading_factors = reception.spreadingFactors;
  }
  appendRange(receptionPredicates, variables, 'radio.frequency_hz', 'frequency_hz', reception.frequencyMHz, 1_000_000);
  appendRange(receptionPredicates, variables, 'radio.best_rssi_dbm', 'rssi_dbm', reception.rssiDbm);
  appendRange(receptionPredicates, variables, 'radio.best_snr_db', 'snr_db', reception.snrDb);
  predicates.push(`array::len((
    SELECT VALUE id
    FROM gateway_reception WITH INDEX reception_uplink
    WHERE ${receptionPredicates.join(' AND ')}
    LIMIT 1
  )) > 0`);
}

function appendRange(
  predicates: string[],
  variables: Record<string, unknown>,
  field: string,
  variable: string,
  range?: NumericRange,
  multiplier = 1,
): void {
  if (range?.minimum !== undefined) {
    predicates.push(`${field} >= $${variable}_minimum`);
    variables[`${variable}_minimum`] = range.minimum * multiplier;
  }
  if (range?.maximum !== undefined) {
    predicates.push(`${field} <= $${variable}_maximum`);
    variables[`${variable}_maximum`] = range.maximum * multiplier;
  }
}

function hasReceptionFilter(filters: NonNullable<UplinkFilters['reception']>): boolean {
  return Boolean(
    filters.gatewayIds?.length ||
      filters.spreadingFactors?.length ||
      filters.frequencyMHz ||
      filters.rssiDbm ||
      filters.snrDb,
  );
}

function hasRadioReceptionFilter(filters: NonNullable<UplinkFilters['reception']>): boolean {
  return Boolean(
    filters.spreadingFactors?.length ||
      filters.frequencyMHz ||
      filters.rssiDbm ||
      filters.snrDb,
  );
}

function validateRequest(request: UplinkSearchRequest): void {
  if (!Number.isInteger(request.page.limit) || request.page.limit < 1 || request.page.limit > MAX_UPLINK_PAGE_SIZE) {
    throw new UplinkDataSourceError('invalid_request', `Page size must be an integer between 1 and ${MAX_UPLINK_PAGE_SIZE}.`);
  }
  if ((request.page.after && request.page.before) || (request.page.edge && (request.page.after || request.page.before))) {
    throw new UplinkDataSourceError('invalid_request', 'A page request must use only one cursor or result edge.');
  }
  const sorting = request.sorting ?? [];
  if (sorting.length > 3 || new Set(sorting.map(({ field }) => field)).size !== sorting.length) {
    throw new UplinkDataSourceError('invalid_request', 'Use at most three unique sorting fields.');
  }
  const from = parseDate(request.filters?.packet?.from, 'from');
  const to = parseDate(request.filters?.packet?.to, 'to');
  if (from !== null && to !== null && from > to) {
    throw new UplinkDataSourceError('invalid_request', 'The from time must not be after to.');
  }
  validateRange(request.filters?.reception?.frequencyMHz, 'frequency');
  validateRange(request.filters?.reception?.rssiDbm, 'RSSI');
  validateRange(request.filters?.reception?.snrDb, 'SNR');
  validateRange(request.filters?.packet?.fCnt, 'FCnt');
  if (
    request.filters?.packet?.fCnt &&
    [request.filters.packet.fCnt.minimum, request.filters.packet.fCnt.maximum]
      .some((value) => value !== undefined && (!Number.isInteger(value) || value < 0 || value > 4_294_967_295))
  ) {
    throw new UplinkDataSourceError('invalid_request', 'FCnt bounds must be integers from 0 to 4294967295.');
  }
  if (request.filters?.packet?.fPorts?.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new UplinkDataSourceError('invalid_request', 'FPort values must be integers from 0 to 255.');
  }
  if (request.filters?.reception?.spreadingFactors?.some((value) => !Number.isInteger(value) || value < 5 || value > 12)) {
    throw new UplinkDataSourceError('invalid_request', 'Spreading factors must be integers from 5 to 12.');
  }
}

function parseDate(value: string | undefined, name: string): number | null {
  if (value === undefined) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new UplinkDataSourceError('invalid_request', `${name} must be a valid timestamp.`);
  return parsed;
}

function validateRange(range: NumericRange | undefined, name: string): void {
  if (range?.minimum !== undefined && !Number.isFinite(range.minimum)) {
    throw new UplinkDataSourceError('invalid_request', `${name} minimum must be a number.`);
  }
  if (range?.maximum !== undefined && !Number.isFinite(range.maximum)) {
    throw new UplinkDataSourceError('invalid_request', `${name} maximum must be a number.`);
  }
  if (range?.minimum !== undefined && range.maximum !== undefined && range.minimum > range.maximum) {
    throw new UplinkDataSourceError('invalid_request', `${name} minimum must not exceed its maximum.`);
  }
}

function effectiveSorting(sorting?: UplinkSort[]): readonly UplinkSort[] {
  const result = sorting?.length ? [...sorting] : [...DEFAULT_SORTING];
  if (!result.some(({ field }) => field === 'observedAt')) {
    result.push({ field: 'observedAt', direction: 'desc' });
  }
  return result;
}

function comparisonOperator(direction: UplinkSort['direction'], backwards: boolean): '<' | '>' {
  const forward = direction === 'asc' ? '>' : '<';
  return backwards ? (forward === '>' ? '<' : '>') : forward;
}

function queryDirection(direction: UplinkSort['direction'], backwards: boolean): 'ASC' | 'DESC' {
  if (backwards) return direction === 'asc' ? 'DESC' : 'ASC';
  return direction.toUpperCase() as 'ASC' | 'DESC';
}

function nullSentinel(type: SortDefinition['valueType'], direction: UplinkSort['direction']): string | number {
  if (type === 'datetime') {
    throw new UplinkDataSourceError('invalid_request', 'Nullable datetime sorting is not supported.');
  }
  if (type === 'number') return direction === 'asc' ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
  return direction === 'asc' ? String.fromCodePoint(0x10ffff) : '';
}

function encodeCursor(row: SearchRow, sorting: readonly UplinkSort[], requestKey: string): string {
  const values = sorting.map((sort, index) => {
    const value = row[`__sort_${index}`];
    return sort.field === 'observedAt' ? cursorTimestamp(value) : value;
  });
  if (values.some((value) => typeof value !== 'string' && typeof value !== 'number')) {
    invalidResponse('An uplink row is missing its cursor values.');
  }
  if (typeof row.__record_key !== 'string') invalidResponse('An uplink row is missing its record key.');
  return encodeBase64Url(JSON.stringify({ version: 1, requestKey, values, recordKey: row.__record_key }));
}

function cursorQueryOperand(field: UplinkSortField, index: number): string {
  const variable = `$cursor_${index}`;
  return field === 'observedAt' ? `<datetime>${variable}` : variable;
}

function cursorQueryValue(field: UplinkSortField, value: string | number): string | number {
  return field === 'observedAt' ? cursorTimestamp(value) : value;
}

function cursorTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isFinite(value.getTime())) return value.toISOString();
  } else if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    // Keep SurrealDB's sub-millisecond precision. JavaScript Date would truncate it,
    // causing a boundary record to satisfy its own next/previous-page predicate.
    return value;
  } else if (typeof value === 'number') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  throw new UplinkDataSourceError('invalid_cursor', 'The page cursor contains an invalid timestamp.');
}

function decodeCursor(value: string, requestKey: string, valueCount: number): CursorPayload {
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as Partial<CursorPayload>;
    if (
      parsed.version !== 1 ||
      parsed.requestKey !== requestKey ||
      !Array.isArray(parsed.values) ||
      parsed.values.length !== valueCount ||
      parsed.values.some((entry) => typeof entry !== 'string' && typeof entry !== 'number') ||
      typeof parsed.recordKey !== 'string'
    ) throw new Error('Invalid cursor contents.');
    return parsed as CursorPayload;
  } catch {
    throw new UplinkDataSourceError('invalid_cursor', 'The page cursor is invalid or stale.');
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
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

function normalizeHex(value: string): string {
  return value.replace(/[:\s-]/g, '').toUpperCase();
}

function toUplinkSummary(row: UplinkSummaryRow & { __record_key: string }): UplinkSummary {
  if (!row || row.schema_version !== 1 || typeof row.__record_key !== 'string') {
    invalidResponse('SurrealDB returned an unsupported uplink record.');
  }
  const mType = messageType(row.mtype ?? row.lorawan?.mtype);
  return {
    id: row.__record_key,
    observedAt: isoDate(row.observed_at, 'observed_at'),
    devEui: optionalString(row.dev_eui),
    devAddr: optionalString(row.dev_addr),
    fCnt: optionalNumber(row.fcnt16),
    fCntWidth: row.fcnt16 === undefined ? null : 16,
    fPort: optionalNumber(row.fport),
    mType,
    modulation: modulation(row.modulation),
    dataRate: typeof row.data_rate === 'string' || typeof row.data_rate === 'number' ? row.data_rate : null,
    codingRate: optionalString(row.coding_rate),
    hoppingChannelWidth: optionalNumber(row.hopping_channel_width),
    spreadingFactor: optionalNumber(row.spreading_factor),
    frequencyMHz: typeof row.frequency_hz === 'number' ? row.frequency_hz / 1_000_000 : null,
    bestRssiDbm: optionalNumber(row.best_rssi_dbm),
    bestSnrDb: optionalNumber(row.best_snr_db),
    bestGatewayId: optionalString(row.best_gateway_id),
    receptionCount: typeof row.reception_count === 'number' ? row.reception_count : 0,
    phyPayloadHex: row.phy?.payload_hex ?? '',
    analysis: { duplicate: false, possibleRetransmission: false, missingFrameCountBefore: null },
  };
}

function toGatewayReception(row: ReceptionRow): GatewayReception {
  if (!row || row.schema_version !== 1 || typeof row.__record_key !== 'string') {
    invalidResponse('SurrealDB returned an unsupported gateway reception.');
  }
  const radio = row.radio ?? ({ signals: [] } as DatabaseRadioMetadata);
  return {
    id: row.__record_key,
    gatewayId: row.gateway_id,
    receivedAt: row.timestamp_source === 'gateway' ? isoDate(row.observed_at, 'observed_at') : null,
    ingestedAt: isoDate(row.ingested_at, 'ingested_at'),
    frequencyMHz: typeof radio.frequency_hz === 'number' ? radio.frequency_hz / 1_000_000 : null,
    modulation: modulation(radio.modulation),
    dataRate: typeof radio.data_rate === 'string' || typeof radio.data_rate === 'number' ? radio.data_rate : null,
    spreadingFactor: optionalNumber(radio.spreading_factor),
    bandwidthKHz: typeof radio.bandwidth_hz === 'number' ? radio.bandwidth_hz / 1_000 : null,
    codingRate: optionalString(radio.coding_rate),
    hoppingChannelWidth: optionalNumber(radio.hopping_channel_width),
    crcStatus: radio.crc_status === -1 || radio.crc_status === 0 || radio.crc_status === 1 ? radio.crc_status : null,
    bestRssiDbm: optionalNumber(radio.best_rssi_dbm),
    bestSnrDb: optionalNumber(radio.best_snr_db),
    signals: (radio.signals ?? []).map(toRadioSignal),
  };
}

function compareGatewayReceptions(left: GatewayReception, right: GatewayReception): number {
  const timestamp = (left.receivedAt ?? left.ingestedAt).localeCompare(
    right.receivedAt ?? right.ingestedAt,
  );
  return timestamp || left.gatewayId.localeCompare(right.gatewayId);
}

function toRadioSignal(signal: DatabaseSignal) {
  return {
    antenna: optionalNumber(signal.antenna),
    channel: optionalNumber(signal.channel),
    rssiChannelDbm: optionalNumber(signal.rssi_channel_dbm),
    rssiSignalDbm: optionalNumber(signal.rssi_signal_dbm),
    snrDb: optionalNumber(signal.snr_db),
    rssiStandardDeviationDb: optionalNumber(signal.rssi_standard_deviation_db),
    fineTimestampNs: optionalNumber(signal.fine_timestamp_ns),
    frequencyOffsetHz: optionalNumber(signal.frequency_offset_hz),
    frequencyDriftHz: optionalNumber(signal.frequency_drift_hz),
    fineTimestampStatus: optionalNumber(signal.fine_timestamp_status),
  };
}

function toDecodedFrame(lorawan: DatabaseDecodedLoRaWAN, payloadHex = ''): DecodedLoRaWANFrame {
  const mType = messageType(lorawan?.mtype);
  const major = majorVersion(lorawan?.major);
  const mhdr = { rawHex: lorawan?.mhdr_hex ?? payloadHex.slice(0, 2), mType, major };
  if ((mType === 'UnconfirmedDataUp' || mType === 'ConfirmedDataUp') && lorawan?.dev_addr && typeof lorawan.fcnt16 === 'number') {
    const fctrl = Number.parseInt(lorawan.fctrl_hex ?? '0', 16) || 0;
    const foptsHex = lorawan.fopts_hex ?? '';
    return {
      kind: 'data-uplink',
      mhdr,
      macPayload: {
        fhdr: {
          devAddr: lorawan.dev_addr,
          fCtrl: {
            rawHex: lorawan.fctrl_hex ?? '00',
            adr: lorawan.adr ?? Boolean(fctrl & 0x80),
            adrAckRequest: lorawan.adr_ack_request ?? Boolean(fctrl & 0x40),
            ack: lorawan.ack ?? Boolean(fctrl & 0x20),
            classB: lorawan.class_b ?? Boolean(fctrl & 0x10),
            fOptsLength: foptsHex.length / 2,
          },
          fCnt16: lorawan.fcnt16,
          fOptsHex: foptsHex,
        },
        fPort: optionalNumber(lorawan.fport),
        frmPayloadHex: optionalString(lorawan.frm_payload_hex),
      },
      micHex: lorawan.mic_hex ?? '',
    };
  }
  if (mType === 'JoinRequest' && lorawan?.join_eui && lorawan.dev_eui && typeof lorawan.dev_nonce === 'number') {
    return {
      kind: 'join-request',
      mhdr,
      macPayload: { joinEui: lorawan.join_eui, devEui: lorawan.dev_eui, devNonce: lorawan.dev_nonce },
      micHex: lorawan.mic_hex ?? '',
    };
  }
  return {
    kind: 'unsupported',
    mhdr,
    macPayloadHex: lorawan?.mac_payload_hex ?? '',
    micHex: optionalString(lorawan?.mic_hex),
    reason: lorawan?.decode_error ?? `Detailed decoding for ${mType} is not available.`,
  };
}

function messageType(value: unknown): LoRaWANMessageType {
  return typeof value === 'string' && MESSAGE_TYPES.includes(value as LoRaWANMessageType)
    ? (value as LoRaWANMessageType)
    : 'Proprietary';
}

function majorVersion(value: unknown): LoRaWANMajor {
  return value === 'LoRaWANR1' ? 'LoRaWANR1' : 'RFU';
}

function modulation(value: unknown): Modulation | null {
  return value === 'LORA' || value === 'LR-FHSS' || value === 'FSK' ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoDate(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) invalidResponse(`The ${field} field is not a valid timestamp.`);
  return date.toISOString();
}

function invalidResponse(message: string): never {
  throw new UplinkDataSourceError('invalid_response', message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UplinkDataSourceError('request_aborted', 'The uplink request was cancelled.');
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new UplinkDataSourceError('request_aborted', 'The uplink request was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
