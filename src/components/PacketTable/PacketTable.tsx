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
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { UplinkSummary } from '../../api/types.ts';
import { PACKET_COLUMN_OPTIONS } from '../../api/packetColumns.ts';
import {
  ArrowRightEndOnRectangleIcon,
  ArrowRightStartOnRectangleIcon,
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
}

export default function PacketTable({
  data,
  columnVisibility,
  rowSelection,
  loading,
  loadingMore,
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
}: PacketTableProps) {
  const scrollElement = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    scrollElement.current?.scrollTo({ top: 0 });
  }, [scrollResetVersion]);

  useEffect(() => {
    const lastVirtualRow = virtualRows[virtualRows.length - 1];
    if (
      lastVirtualRow &&
      lastVirtualRow.index >= rows.length - 5 &&
      hasMore &&
      !loadingMore
    ) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore, rows.length, virtualRows]);

  return (
    <div className={`packet-grid${loading ? ' is-loading' : ''}`}>
      <div
        ref={scrollElement}
        className="packet-grid-scroll"
        tabIndex={0}
        aria-label="Scrollable packet table"
      >
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
            <ArrowRightStartOnRectangleIcon />
          </TableFilterButton>
          <TableFilterButton
            label={`Copy ${displayValue} to filter as To`}
            hint="Copy to filter as To"
            onClick={() => onFilterEnd(value)}
          >
            <ArrowRightEndOnRectangleIcon />
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
