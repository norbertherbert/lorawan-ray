import {
  createColumnHelper,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { Tooltip } from 'flowbite-react';
import { useMemo, type ReactNode } from 'react';
import type { UplinkSummary } from '../../api/types.ts';
import {
  ArrowRightEndOnRectangleIcon,
  ArrowRightStartOnRectangleIcon,
  FunnelIcon,
} from '../Icons.jsx';
import { formatDate } from '../../lib.js';

const features = tableFeatures({ rowSortingFeature, rowSelectionFeature });
const columnHelper = createColumnHelper<typeof features, UplinkSummary>();

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
    sortDescFirst: true,
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
  columnHelper.accessor('fCnt', { header: 'FCnt', cell: nullableCell, sortDescFirst: true }),
  columnHelper.accessor('fPort', { header: 'FPort', cell: nullableCell }),
  columnHelper.accessor('mType', { header: 'MType' }),
  columnHelper.accessor('bestRssiDbm', { header: 'RSSI', cell: unitCell(' dBm'), sortDescFirst: true }),
  columnHelper.accessor('bestSnrDb', { header: 'SNR', cell: unitCell(' dB'), sortDescFirst: true }),
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
  sorting: SortingState;
  rowSelection: RowSelectionState;
  loading: boolean;
  showFilterActions: boolean;
  onFilterByDevAddr: (value: string) => void;
  onFilterByGatewayId: (value: string) => void;
  onFilterStartTime: (value: string) => void;
  onFilterEndTime: (value: string) => void;
  onSortingChange: (updater: SortingState | ((current: SortingState) => SortingState)) => void;
  onRowSelectionChange: (updater: RowSelectionState | ((current: RowSelectionState) => RowSelectionState)) => void;
}

export default function PacketTable({
  data,
  sorting,
  rowSelection,
  loading,
  showFilterActions,
  onFilterByDevAddr,
  onFilterByGatewayId,
  onFilterStartTime,
  onFilterEndTime,
  onSortingChange,
  onRowSelectionChange,
}: PacketTableProps) {
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
    manualSorting: true,
    enableSortingRemoval: false,
    enableMultiSort: true,
    maxMultiSortColCount: 3,
    enableMultiRowSelection: false,
    enableRowRangeSelection: false,
    state: { sorting, rowSelection },
    onSortingChange,
    onRowSelectionChange,
  });

  return (
    <div className={`packet-grid${loading ? ' is-loading' : ''}`}>
      <div
        className="packet-grid-scroll"
        tabIndex={0}
        aria-label="Scrollable packet table"
      >
        <table aria-label="LoRaWAN uplink packets">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const direction = header.column.getIsSorted();
                  const sortIndex = header.column.getSortIndex();
                  return (
                    <th key={header.id} scope="col" aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
                      <button type="button" onClick={header.column.getToggleSortingHandler()} disabled={!header.column.getCanSort()}>
                        <table.FlexRender header={header} />
                        <span className="sort-indicator" aria-hidden="true">
                          {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '◇'}
                          {direction && sorting.length > 1 ? sortIndex + 1 : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                data-selected={row.getIsSelected() || undefined}
                tabIndex={0}
                onClick={() => row.toggleSelected(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    row.toggleSelected(true);
                  }
                }}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}><table.FlexRender cell={cell} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && !loading ? <div className="packet-grid-empty">No packets match the current filter.</div> : null}
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
            label={`Copy ${displayValue} to End time`}
            hint="Copy to filter as End time"
            onClick={() => onFilterEnd(value)}
          >
            <ArrowRightEndOnRectangleIcon />
          </TableFilterButton>
          <TableFilterButton
            label={`Copy ${displayValue} to Start time`}
            hint="Copy to filter as Start time"
            onClick={() => onFilterStart(value)}
          >
            <ArrowRightStartOnRectangleIcon />
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

export type { RowSelectionState, SortingState };
