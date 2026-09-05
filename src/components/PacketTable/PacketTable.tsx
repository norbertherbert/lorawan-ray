import {
  columnVisibilityFeature,
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { Spinner, Tooltip } from 'flowbite-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { UplinkSummary } from '../../api/types.ts';
import { PACKET_COLUMN_OPTIONS } from '../../api/packetColumns.ts';
import {
  ArrowDownToBracketFlippedIcon,
  ArrowUpFromBracketIcon,
  FunnelIcon,
} from '../Icons.jsx';
import { formatDate } from '../../lib.js';

const features = tableFeatures({ rowSelectionFeature, columnVisibilityFeature });
const columnHelper = createColumnHelper<typeof features, UplinkSummary>();

export { PACKET_COLUMN_OPTIONS };

function createColumns(
  showFilterActions: boolean,
  onFilterByDevAddr: (value: string) => void,
  onFilterByGatewayId: (value: string) => void,
  onFilterStartTime: (value: string) => void,
  onFilterEndTime: (value: string) => void,
) {
  return columnHelper.columns([
  columnHelper.accessor('observedAt', {
    header: 'Timestamp',
    cell: ({ getValue }) => (
      <TimestampCell
        value={getValue()}
        showActions={showFilterActions}
        onFilterStart={onFilterStartTime}
        onFilterEnd={onFilterEndTime}
      />
    ),
  }),
  columnHelper.accessor('devEui', { header: 'DevEUI', cell: nullableCell }),
  columnHelper.accessor('devAddr', {
    header: 'DevAddr',
    cell: ({ getValue }) => (
      <FilterableValueCell
        value={getValue()}
        label="DevAddr"
        showAction={showFilterActions}
        onFilter={onFilterByDevAddr}
      />
    ),
  }),
  columnHelper.accessor('fCnt', { header: 'FCnt', cell: nullableCell }),
  columnHelper.accessor('fPort', { header: 'FPort', cell: nullableCell }),
  columnHelper.accessor('mType', { header: 'MType' }),
  columnHelper.accessor('bestRssiDbm', { header: 'RSSI', cell: unitCell(' dBm') }),
  columnHelper.accessor('bestSnrDb', { header: 'SNR', cell: unitCell(' dB') }),
  columnHelper.accessor('modulation', {
    header: 'Modulation',
    cell: ({ getValue }) => <span className={`modulation-badge modulation-${String(getValue() ?? 'unknown').toLowerCase()}`}>{getValue() ?? '—'}</span>,
  }),
  columnHelper.accessor('dataRate', { header: 'Data rate', cell: nullableCell }),
  columnHelper.accessor('frequencyMHz', { header: 'Frequency', cell: ({ getValue }) => getValue() === null ? '—' : `${getValue()?.toFixed(3)} MHz` }),
  columnHelper.accessor('bestGatewayId', {
    header: 'Best gateway',
    cell: ({ getValue }) => (
      <FilterableValueCell
        value={getValue()}
        label="gateway ID"
        showAction={showFilterActions}
        onFilter={onFilterByGatewayId}
      />
    ),
  }),
  ]);
}

interface PacketTableProps {
  data: UplinkSummary[];
  columnVisibility: ColumnVisibilityState;
  rowSelection: RowSelectionState;
  loading: boolean;
  loadingMore: boolean;
  loadingNewer: boolean;
  hasMore: boolean;
  scrollResetVersion: number;
  showFilterActions: boolean;
  onFilterByDevAddr: (value: string) => void;
  onFilterByGatewayId: (value: string) => void;
  onFilterStartTime: (value: string) => void;
  onFilterEndTime: (value: string) => void;
  onColumnVisibilityChange: (
    updater: ColumnVisibilityState | ((current: ColumnVisibilityState) => ColumnVisibilityState)
  ) => void;
  onRowSelectionChange: (updater: RowSelectionState | ((current: RowSelectionState) => RowSelectionState)) => void;
  onRowDoubleClick: (row: UplinkSummary) => void;
  onLoadMore: () => void;
  onLoadNewer: () => void;
}

export default function PacketTable({
  data,
  columnVisibility,
  rowSelection,
  loading,
  loadingMore,
  loadingNewer,
  hasMore,
  scrollResetVersion,
  showFilterActions,
  onFilterByDevAddr,
  onFilterByGatewayId,
  onFilterStartTime,
  onFilterEndTime,
  onColumnVisibilityChange,
  onRowSelectionChange,
  onRowDoubleClick,
  onLoadMore,
  onLoadNewer,
}: PacketTableProps) {
  const scrollElement = useRef<HTMLDivElement>(null);
  const lastNewerRequest = useRef(0);
  const previousScrollTop = useRef(0);
  const touchY = useRef<number | null>(null);
  const prependAnchor = useRef<{ id: string; offset: number } | null>(null);
  const columns = useMemo(
    () => createColumns(
      showFilterActions,
      onFilterByDevAddr,
      onFilterByGatewayId,
      onFilterStartTime,
      onFilterEndTime,
    ),
    [showFilterActions, onFilterByDevAddr, onFilterByGatewayId, onFilterStartTime, onFilterEndTime],
  );
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) => row.id,
    enableMultiRowSelection: false,
    enableRowRangeSelection: false,
    state: { columnVisibility, rowSelection },
    onColumnVisibilityChange,
    onRowSelectionChange,
  });
  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => 25,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  function requestNewerPackets() {
    if (loadingNewer || loadingMore || loading || Date.now() - lastNewerRequest.current < 1500) return;
    lastNewerRequest.current = Date.now();
    const top = scrollElement.current?.scrollTop ?? 0;
    const anchor = virtualRows.find((row) => row.end > top);
    prependAnchor.current = anchor && rows[anchor.index]
      ? { id: rows[anchor.index].id, offset: top - anchor.start }
      : null;
    onLoadNewer();
  }

  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    if (!anchor || loadingNewer) return;
    const index = rows.findIndex((row) => row.id === anchor.id);
    if (index >= 0) {
      const offset = rowVirtualizer.getOffsetForIndex(index, 'start');
      if (offset) rowVirtualizer.scrollToOffset(offset[0] + anchor.offset);
    }
    prependAnchor.current = null;
  }, [data, loadingNewer, rowVirtualizer, rows]);

  useEffect(() => {
    prependAnchor.current = null;
    previousScrollTop.current = 0;
    scrollElement.current?.scrollTo({ top: 0 });
  }, [scrollResetVersion]);

  function requestOlderPackets() {
    const element = scrollElement.current;
    if (element && hasMore && !loading && !loadingMore && !loadingNewer &&
      element.scrollHeight - element.scrollTop - element.clientHeight <= 125) {
      onLoadMore();
    }
  }

  return (
    <div className={`packet-grid${loading ? ' is-loading' : ''}`}>
      <div
        ref={scrollElement}
        className="packet-grid-scroll"
        tabIndex={0}
        aria-label="Scrollable packet table"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          if (top < previousScrollTop.current && top <= 40) requestNewerPackets();
          if (top > previousScrollTop.current) requestOlderPackets();
          previousScrollTop.current = top;
        }}
        onWheel={(event) => {
          if (event.deltaY < 0 && event.currentTarget.scrollTop <= 40) requestNewerPackets();
          if (event.deltaY > 0) requestOlderPackets();
        }}
        onTouchStart={(event) => { touchY.current = event.touches[0]?.clientY ?? null; }}
        onTouchMove={(event) => {
          const y = event.touches[0]?.clientY;
          if (y !== undefined && touchY.current !== null && y > touchY.current && event.currentTarget.scrollTop <= 40) {
            requestNewerPackets();
          }
          if (y !== undefined && touchY.current !== null && y < touchY.current) requestOlderPackets();
          touchY.current = y ?? null;
        }}
      >
        <div className="packet-load-more">
          <button type="button" onClick={requestNewerPackets} disabled={loadingNewer || loadingMore || loading}>
            {loadingNewer ? <><Spinner size="xs" aria-hidden="true" /> Loading newer packets…</> : 'Load newer packets'}
          </button>
        </div>
        <table aria-label="LoRaWAN uplink packets">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={header.column.id === 'observedAt' ? 'descending' : undefined}
                  >
                    <span className="packet-column-heading"><table.FlexRender header={header} /></span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 ? (
              <tr className="packet-virtual-spacer" aria-hidden="true">
                <td colSpan={visibleColumnCount} style={{ height: paddingTop }} />
              </tr>
            ) : null}
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
              <tr
                key={row.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                data-selected={row.getIsSelected() || undefined}
                tabIndex={0}
                onClick={() => row.toggleSelected(true)}
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  row.toggleSelected(true);
                  onRowDoubleClick(row.original);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    row.toggleSelected(true);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}><table.FlexRender cell={cell} /></td>
                ))}
              </tr>
              );
            })}
            {paddingBottom > 0 ? (
              <tr className="packet-virtual-spacer" aria-hidden="true">
                <td colSpan={visibleColumnCount} style={{ height: paddingBottom }} />
              </tr>
            ) : null}
          </tbody>
        </table>
        {!data.length && !loading ? <div className="packet-grid-empty">No packets match the current filter.</div> : null}
        {data.length && (hasMore || loadingMore) ? (
          <div className="packet-load-more">
            <button type="button" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? <><Spinner size="xs" aria-hidden="true" /> Loading older packets…</> : 'Load older packets'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimestampCell({
  value,
  showActions,
  onFilterStart,
  onFilterEnd,
}: {
  value: string;
  showActions: boolean;
  onFilterStart: (value: string) => void;
  onFilterEnd: (value: string) => void;
}) {
  const displayValue = formatDate(value);
  return (
    <span className="table-filter-cell">
      <span>{displayValue}</span>
      {showActions ? (
        <span className="table-filter-actions">
          <TableFilterButton
            label={`Copy ${displayValue} to filter as From`}
            hint="Copy to filter as From"
            onClick={() => onFilterStart(value)}
          >
            <ArrowUpFromBracketIcon />
          </TableFilterButton>
          <TableFilterButton
            label={`Copy ${displayValue} to filter as To`}
            hint="Copy to filter as To"
            onClick={() => onFilterEnd(value)}
          >
            <ArrowDownToBracketFlippedIcon />
          </TableFilterButton>
        </span>
      ) : null}
    </span>
  );
}

function FilterableValueCell({
  value,
  label,
  showAction,
  onFilter,
}: {
  value: string | null;
  label: string;
  showAction: boolean;
  onFilter: (value: string) => void;
}) {
  if (!value) return '—';
  return (
    <span className="table-filter-cell">
      <span>{value}</span>
      {showAction ? (
        <TableFilterButton
          label={`Copy ${label} ${value} to filter`}
          onClick={() => onFilter(value)}
        >
          <FunnelIcon />
        </TableFilterButton>
      ) : null}
    </span>
  );
}

function TableFilterButton({
  label,
  hint = 'Copy to filter',
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip className="compact-icon-tooltip" content={hint} theme={{ target: 'table-filter-tooltip-target' }}>
      <button
        className="table-filter-button"
        type="button"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function nullableCell({ getValue }: { getValue: () => unknown }) {
  const value = getValue();
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function unitCell(unit: string) {
  return ({ getValue }: { getValue: () => unknown }) => {
    const value = getValue();
    return typeof value === 'number' ? `${value}${unit}` : '—';
  };
}

export type { RowSelectionState };
