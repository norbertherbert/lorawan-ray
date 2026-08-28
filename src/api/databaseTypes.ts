/**
 * SurrealDB schema-version-1 DTOs.
 *
 * These types describe rows returned directly to the authenticated browser,
 * before the data-source adapter maps them to the UI-oriented camelCase types
 * in api/types.ts. They intentionally mirror ../lorawan-sniffer/init_db.surql
 * rather than the former schemaless gateway_rxpk documents.
 */

export type SurrealRecordId = string;
export type TimestampSource = 'gateway' | 'ingested';
export type DecodeStatus = 'decoded' | 'error' | 'unsupported';

export interface DatabaseSignal {
  antenna?: number;
  channel?: number;
  rssi_channel_dbm?: number;
  rssi_signal_dbm?: number;
  snr_db?: number;
  rssi_standard_deviation_db?: number;
  fine_timestamp_ns?: number;
  frequency_offset_hz?: number;
  frequency_drift_hz?: number;
  fine_timestamp_status?: number;
  [vendorField: string]: unknown;
}

export interface DatabaseRadioMetadata {
  frequency_hz?: number;
  modulation?: string;
  data_rate?: string | number;
  spreading_factor?: number;
  bandwidth_hz?: number;
  coding_rate?: string;
  hopping_channel_width?: number;
  crc_status?: -1 | 0 | 1;
  best_rssi_dbm?: number;
  best_snr_db?: number;
  signals: DatabaseSignal[];
}

export interface DatabasePhyPayload {
  payload_base64?: string;
  payload_hex?: string;
  payload_size?: number;
  payload_hash?: string;
}

export interface DatabaseDecodedLoRaWAN {
  decode_status: DecodeStatus;
  decode_error?: string;
  mhdr_hex?: string;
  major?: string;
  mtype?: string;
  dev_addr?: string;
  fcnt16?: number;
  fport?: number;
  fctrl_hex?: string;
  adr?: boolean;
  adr_ack_request?: boolean;
  ack?: boolean;
  class_b?: boolean;
  fopts_hex?: string;
  frm_payload_hex?: string;
  mic_hex?: string;
  join_eui?: string;
  dev_eui?: string;
  dev_nonce?: number;
  mac_payload_hex?: string;
  [decoderField: string]: unknown;
}

export interface DatabaseGatewayReception {
  id: SurrealRecordId;
  schema_version: 1;
  gateway_id: string;
  observed_at: string;
  ingested_at: string;
  timestamp_source: TimestampSource;
  raw_rxpk: Record<string, unknown>;
  radio: DatabaseRadioMetadata;
  phy: DatabasePhyPayload;
  lorawan: DatabaseDecodedLoRaWAN;
  uplink?: SurrealRecordId;
}

export interface DatabaseLogicalUplink {
  id: SurrealRecordId;
  schema_version: 1;
  observed_at: string;
  first_observed_at: string;
  last_observed_at: string;
  correlation: {
    method: 'payload_hash+gateway_time_200ms' | 'single_reception';
    anchor_at?: string;
    window_ms?: number;
  };
  phy: Required<DatabasePhyPayload>;
  lorawan: DatabaseDecodedLoRaWAN;
  mtype?: string;
  dev_eui?: string;
  dev_addr?: string;
  fcnt16?: number;
  fport?: number;
  modulation?: string;
  data_rate?: string | number;
  coding_rate?: string;
  hopping_channel_width?: number;
  receptions: SurrealRecordId[];
  reception_count: number;
  gateway_ids: string[];
  best_reception?: SurrealRecordId;
  best_gateway_id?: string;
  best_rssi_dbm?: number;
  best_snr_db?: number;
  frequency_hz?: number;
  spreading_factor?: number;
}
