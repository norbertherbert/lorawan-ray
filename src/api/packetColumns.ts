export const PACKET_COLUMN_OPTIONS = [
  { id: 'observedAt', label: 'Timestamp', csvLabel: 'Timestamp' },
  { id: 'devEui', label: 'DevEUI', csvLabel: 'DevEUI' },
  { id: 'devAddr', label: 'DevAddr', csvLabel: 'DevAddr' },
  { id: 'fCnt', label: 'FCnt', csvLabel: 'FCnt' },
  { id: 'fPort', label: 'FPort', csvLabel: 'FPort' },
  { id: 'mType', label: 'MType', csvLabel: 'MType' },
  { id: 'bestRssiDbm', label: 'RSSI', csvLabel: 'RSSI (dBm)' },
  { id: 'bestSnrDb', label: 'SNR', csvLabel: 'SNR (dB)' },
  { id: 'modulation', label: 'Modulation', csvLabel: 'Modulation' },
  { id: 'dataRate', label: 'Data rate', csvLabel: 'Data rate' },
  { id: 'frequencyMHz', label: 'Frequency', csvLabel: 'Frequency (MHz)' },
  { id: 'bestGatewayId', label: 'Best gateway', csvLabel: 'Best gateway' },
] as const;

export type PacketColumnId = (typeof PACKET_COLUMN_OPTIONS)[number]['id'];
