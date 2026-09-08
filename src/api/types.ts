import type { DecodedLoRaWANFrame, LoRaWANMessageType } from '../lorawan/types';

export const MAX_UPLINK_PAGE_SIZE = 500;

// These are UI-domain types, not direct SurrealDB row shapes. A data-source
// adapter validates database rows from databaseTypes.ts and maps snake_case,
// hertz, and missing fields into this stable browser-facing contract.

export type Modulation = 'LORA' | 'LR-FHSS' | 'FSK';

export interface RadioSignal {
  antenna: number | null;
  channel: number | null;
  rssiChannelDbm: number | null;
  rssiSignalDbm: number | null;
  snrDb: number | null;
  rssiStandardDeviationDb: number | null;
  fineTimestampNs: number | null;
  frequencyOffsetHz: number | null;
  frequencyDriftHz: number | null;
  fineTimestampStatus: number | null;
}

export interface GatewayReception {
  id: string;
  gatewayId: string;
  receivedAt: string | null;
  ingestedAt: string;
  frequencyMHz: number | null;
  modulation: Modulation | null;
  dataRate: string | number | null;
  spreadingFactor: number | null;
  bandwidthKHz: number | null;
  codingRate: string | null;
  hoppingChannelWidth: number | null;
  crcStatus: -1 | 0 | 1 | null;
  bestRssiDbm: number | null;
  bestSnrDb: number | null;
  signals: RadioSignal[];
}

export interface UplinkAnalysisFlags {
  duplicate: boolean;
  possibleRetransmission: boolean;
  missingFrameCountBefore: number | null;
}

export interface UplinkSummary {
  id: string;
  observedAt: string;
  devEui: string | null;
  devAddr: string | null;
  /** Session-aware 32-bit reconstruction may replace the raw 16-bit value later. */
  fCnt: number | null;
  fCntWidth: 16 | 32 | null;
  fPort: number | null;
  mType: LoRaWANMessageType;
  modulation: Modulation | null;
  dataRate: string | number | null;
  codingRate: string | null;
  hoppingChannelWidth: number | null;
  spreadingFactor: number | null;
  frequencyMHz: number | null;
  bestRssiDbm: number | null;
  bestSnrDb: number | null;
  bestGatewayId: string | null;
  receptionCount: number;
  phyPayloadHex: string;
  analysis: UplinkAnalysisFlags;
}

export interface UplinkDetails extends UplinkSummary {
  frame: DecodedLoRaWANFrame;
  receptions: GatewayReception[];
}

export interface NumericRange {
  minimum?: number;
  maximum?: number;
}

export interface PacketFilters {
  from?: string;
  to?: string;
  devEuis?: string[];
  devAddrs?: string[];
  fCnt?: NumericRange;
  fPorts?: number[];
  mTypes?: LoRaWANMessageType[];
  modulations?: Modulation[];
  dataRates?: Array<string | number>;
  text?: string;
}

export interface ReceptionFilters {
  gatewayIds?: string[];
  spreadingFactors?: number[];
  frequencyMHz?: NumericRange;
  rssiDbm?: NumericRange;
  snrDb?: NumericRange;
}

export interface UplinkFilters {
  packet?: PacketFilters;
  /** All active reception predicates must match the same gateway reception. */
  reception?: ReceptionFilters;
}

export type UplinkSortField =
  | 'observedAt'
  | 'devEui'
  | 'devAddr'
  | 'fCnt'
  | 'fPort'
  | 'mType'
  | 'modulation'
  | 'dataRate'
  | 'spreadingFactor'
  | 'frequencyMHz'
  | 'bestRssiDbm'
  | 'bestSnrDb'
  | 'bestGatewayId'
  | 'phyPayloadHex';

export interface UplinkSort {
  field: UplinkSortField;
  direction: 'asc' | 'desc';
}

export interface UplinkPageRequest {
  limit: number;
  after?: string;
  before?: string;
  edge?: 'oldest';
}

export interface UplinkSearchRequest {
  page: UplinkPageRequest;
  sorting?: UplinkSort[];
  filters?: UplinkFilters;
}

export interface UplinkPageInfo {
  startCursor: string | null;
  endCursor: string | null;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface UplinkPage {
  items: UplinkSummary[];
  pageInfo: UplinkPageInfo;
}

export interface DataSourceOptions {
  signal?: AbortSignal;
}

export interface PacketErrorRateResult {
  percentage: number;
  received: number;
  expected: number;
  missing: number;
  firstFCnt: number;
  lastFCnt: number;
}

export interface UplinkDataSource {
  search(request: UplinkSearchRequest, options?: DataSourceOptions): Promise<UplinkPage>;
  getById(id: string, options?: DataSourceOptions): Promise<UplinkDetails>;
  calculatePacketErrorRate(
    filters: UplinkFilters,
    options?: DataSourceOptions,
  ): Promise<PacketErrorRateResult | null>;
}

export type UplinkDataSourceErrorCode =
  | 'invalid_request'
  | 'invalid_cursor'
  | 'not_found'
  | 'invalid_response'
  | 'request_aborted';

export class UplinkDataSourceError extends Error {
  readonly code: UplinkDataSourceErrorCode;

  constructor(code: UplinkDataSourceErrorCode, message: string) {
    super(message);
    this.name = 'UplinkDataSourceError';
    this.code = code;
  }
}
