import { formatDate } from '../lib.js';
import { PACKET_COLUMN_OPTIONS, type PacketColumnId } from './packetColumns.ts';
import type { UplinkDataSource, UplinkDetails, UplinkFilters } from './types.ts';

const CSV_PAGE_SIZE = 250;
const EXPORT_INSPECTION_PAGE_SIZE = 500;
export const CSV_EXPORT_WARNING_THRESHOLD = 10_000;
const NEWEST_FIRST_SORTING = [{ field: 'observedAt', direction: 'desc' }] as const;

const DETAIL_COLUMNS = [
  { id: 'codingRate', label: 'Coding rate' },
  { id: 'spreadingFactor', label: 'Spreading factor' },
  { id: 'hoppingChannelWidth', label: 'LR-FHSS hopping channel width' },
  { id: 'receptionCount', label: 'Gateway reception count' },
  { id: 'phyPayloadHex', label: 'PHY payload' },
  { id: 'decodedFrame', label: 'Decoded frame (JSON)' },
  { id: 'gatewayReceptions', label: 'Gateway receptions (JSON)' },
] as const;

type DetailColumnId = (typeof DETAIL_COLUMNS)[number]['id'];
const CSV_COLUMNS = [
  ...PACKET_COLUMN_OPTIONS.map(({ id, csvLabel }) => ({ id, label: csvLabel })),
  ...DETAIL_COLUMNS,
];

export interface PacketExportInspection {
  matchingPackets: number;
  exceedsWarningThreshold: boolean;
}

export async function inspectPacketExport({
  dataSource,
  filters,
  signal,
  warningThreshold = CSV_EXPORT_WARNING_THRESHOLD,
}: {
  dataSource: UplinkDataSource;
  filters?: UplinkFilters;
  signal?: AbortSignal;
  warningThreshold?: number;
}): Promise<PacketExportInspection> {
  if (!Number.isInteger(warningThreshold) || warningThreshold < 1) {
    throw new Error('The CSV export warning threshold must be a positive integer.');
  }

  let after: string | undefined;
  let matchingPackets = 0;

  while (matchingPackets <= warningThreshold) {
    throwIfAborted(signal);
    const remaining = warningThreshold + 1 - matchingPackets;
    const result = await dataSource.search(
      {
        page: {
          limit: Math.min(EXPORT_INSPECTION_PAGE_SIZE, remaining),
          ...(after ? { after } : {}),
        },
        sorting: [...NEWEST_FIRST_SORTING],
        filters,
      },
      { signal },
    );
    matchingPackets += result.items.length;

    if (matchingPackets > warningThreshold || !result.pageInfo.hasNextPage) break;
    if (!result.pageInfo.endCursor || result.items.length === 0) {
      throw new Error('The packet export inspection could not advance to the next page.');
    }
    after = result.pageInfo.endCursor;
  }

  return {
    matchingPackets,
    exceedsWarningThreshold: matchingPackets > warningThreshold,
  };
}

export async function writePacketsToCsv({
  dataSource,
  filters,
  signal,
  onProgress,
  write,
}: {
  dataSource: UplinkDataSource;
  filters?: UplinkFilters;
  signal?: AbortSignal;
  onProgress?: (exportedRows: number) => void;
  write: (chunk: string) => void | Promise<void>;
}): Promise<number> {
  await write(`${CSV_COLUMNS.map(({ label }) => csvCell(label)).join(',')}\r\n`);
  let after: string | undefined;
  let exportedRows = 0;

  do {
    throwIfAborted(signal);
    const result = await dataSource.search(
      {
        page: { limit: CSV_PAGE_SIZE, ...(after ? { after } : {}) },
        sorting: [...NEWEST_FIRST_SORTING],
        filters,
      },
      { signal },
    );

    const details = result.items.length
      ? await dataSource.getByIds(result.items.map(({ id }) => id), { signal })
      : [];
    const lines = details.map((packet) => {
      exportedRows += 1;
      onProgress?.(exportedRows);
      return CSV_COLUMNS.map(({ id }) => csvCell(packetColumnValue(packet, id))).join(',');
    });
    if (lines.length) await write(`${lines.join('\r\n')}\r\n`);

    if (!result.pageInfo.hasNextPage) break;
    if (!result.pageInfo.endCursor || result.items.length === 0) {
      throw new Error('The packet export could not advance to the next page.');
    }
    after = result.pageInfo.endCursor;
  } while (!signal?.aborted);

  throwIfAborted(signal);
  return exportedRows;
}

export async function exportPacketsToCsv({
  dataSource,
  filters,
  signal,
  onProgress,
}: {
  dataSource: UplinkDataSource;
  filters?: UplinkFilters;
  signal?: AbortSignal;
  onProgress?: (exportedRows: number) => void;
}): Promise<string> {
  const chunks: string[] = [];
  await writePacketsToCsv({
    dataSource,
    filters,
    signal,
    onProgress,
    write: (chunk) => {
      chunks.push(chunk);
    },
  });
  return chunks.join('');
}

function packetColumnValue(
  packet: UplinkDetails,
  columnId: PacketColumnId | DetailColumnId,
): string | number | null {
  switch (columnId) {
    case 'observedAt': return formatDate(packet.observedAt);
    case 'devEui': return packet.devEui;
    case 'devAddr': return packet.devAddr;
    case 'fCnt': return packet.fCnt;
    case 'fPort': return packet.fPort;
    case 'mType': return packet.mType;
    case 'bestRssiDbm': return packet.bestRssiDbm;
    case 'bestSnrDb': return packet.bestSnrDb;
    case 'modulation': return packet.modulation;
    case 'dataRate': return packet.dataRate;
    case 'frequencyMHz': return packet.frequencyMHz;
    case 'bestGatewayId': return packet.bestGatewayId;
    case 'codingRate': return packet.codingRate;
    case 'spreadingFactor': return packet.spreadingFactor;
    case 'hoppingChannelWidth': return packet.hoppingChannelWidth;
    case 'receptionCount': return packet.receptionCount;
    case 'phyPayloadHex': return packet.phyPayloadHex;
    case 'decodedFrame': return JSON.stringify(packet.frame);
    case 'gatewayReceptions': return JSON.stringify(packet.receptions);
  }
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  return `"${value.replaceAll('"', '""')}"`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The packet export was cancelled.', 'AbortError');
}
