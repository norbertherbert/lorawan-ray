import { formatDate } from '../lib.js';
import { PACKET_COLUMN_OPTIONS, type PacketColumnId } from './packetColumns.ts';
import type { UplinkDataSource, UplinkDetails, UplinkFilters } from './types.ts';

const CSV_PAGE_SIZE = 250;
const DETAIL_REQUEST_CONCURRENCY = 6;
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
  const lines = [CSV_COLUMNS.map(({ label }) => csvCell(label)).join(',')];
  let after: string | undefined;
  let exportedRows = 0;

  do {
    const result = await dataSource.search(
      {
        page: { limit: CSV_PAGE_SIZE, ...(after ? { after } : {}) },
        sorting: [...NEWEST_FIRST_SORTING],
        filters,
      },
      { signal },
    );

    const details = await mapWithConcurrency(
      result.items,
      DETAIL_REQUEST_CONCURRENCY,
      async (packet) => {
        const detail = await dataSource.getById(packet.id, { signal });
        exportedRows += 1;
        onProgress?.(exportedRows);
        return detail;
      },
    );

    for (const packet of details) {
      lines.push(CSV_COLUMNS.map(({ id }) => csvCell(packetColumnValue(packet, id))).join(','));
    }

    if (!result.pageInfo.hasNextPage) break;
    if (!result.pageInfo.endCursor || result.items.length === 0) {
      throw new Error('The packet export could not advance to the next page.');
    }
    after = result.pageInfo.endCursor;
  } while (!signal?.aborted);

  if (signal?.aborted) throw new DOMException('The packet export was cancelled.', 'AbortError');
  return `${lines.join('\r\n')}\r\n`;
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

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await transform(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  return `"${value.replaceAll('"', '""')}"`;
}
