import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, type RowSelectionState, type SortingState } from '@tanstack/react-table';
import { Alert, Badge, Card, Label, Select, Tooltip } from 'flowbite-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { UplinkDataSource, UplinkFilters, UplinkPageRequest, UplinkSort } from '../api/types.ts';
import FilterBuilder, { emptyFilterDraft, type FilterDraft } from '../components/FilterBuilder/FilterBuilder.tsx';
import PacketDetails from '../components/PacketDetails/PacketDetails.tsx';
import PacketTable from '../components/PacketTable/PacketTable.tsx';
import { DownArrowIcon, RefreshIcon, UpArrowIcon } from '../components/Icons.jsx';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

interface AnalyzerProps {
  dataSource: UplinkDataSource;
  sourceKey: string;
  sourceLabel?: string;
  requireActiveSession?: () => boolean;
  onDatabaseError?: (cause: unknown, fallback: string) => void;
}

export default function Analyzer({ dataSource, sourceKey, sourceLabel, requireActiveSession, onDatabaseError }: AnalyzerProps) {
  const [page, setPage] = useState(0);
  const [pageRequest, setPageRequest] = useState<UplinkPageRequest>({ limit: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'observedAt', desc: true }]);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(emptyFilterDraft);
  const [filters, setFilters] = useState<UplinkFilters | undefined>();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const reportedSearchError = useRef<unknown>(null);
  const reportedDetailsError = useRef<unknown>(null);
  const serverSorting = useMemo<UplinkSort[]>(
    () => sorting.map(({ id, desc }) => ({ field: id as UplinkSort['field'], direction: desc ? 'desc' : 'asc' })),
    [sorting],
  );
  const searchRequest = useMemo(
    () => ({ page: pageRequest, sorting: serverSorting, filters }),
    [pageRequest, serverSorting, filters],
  );
  const packets = useQuery({
    queryKey: ['uplinks', sourceKey, searchRequest],
    queryFn: ({ signal }) => dataSource.search(searchRequest, { signal }),
    placeholderData: keepPreviousData,
  });
  const selectedId = Object.keys(rowSelection)[0];
  const details = useQuery({
    queryKey: ['uplink', sourceKey, selectedId],
    queryFn: ({ signal }) => dataSource.getById(selectedId, { signal }),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (packets.error && packets.error !== reportedSearchError.current) {
      reportedSearchError.current = packets.error;
      onDatabaseError?.(packets.error, 'Could not load normalized uplinks.');
    }
  }, [packets.error, onDatabaseError]);
  useEffect(() => {
    if (details.error && details.error !== reportedDetailsError.current) {
      reportedDetailsError.current = details.error;
      onDatabaseError?.(details.error, 'Could not load uplink details.');
    }
  }, [details.error, onDatabaseError]);

  function resetPage(nextLimit = pageRequest.limit) {
    setPage(0);
    setPageRequest({ limit: nextLimit });
  }

  function changeSorting(updater: SortingState | ((current: SortingState) => SortingState)) {
    setSorting((current) => functionalUpdate(updater, current));
    resetPage();
  }

  function applyFilters(draft: FilterDraft, nextFilters: UplinkFilters | undefined) {
    setFilterDraft(draft);
    setFilters(nextFilters);
    setRowSelection({});
    resetPage();
  }

  function goEarlier() {
    const cursor = packets.data?.pageInfo.endCursor;
    if (!cursor) return;
    setPage((current) => current + 1);
    setPageRequest({ limit: pageRequest.limit, after: cursor });
  }

  function goLater() {
    const cursor = packets.data?.pageInfo.startCursor;
    if (!cursor) return;
    setPage((current) => Math.max(0, current - 1));
    setPageRequest({ limit: pageRequest.limit, before: cursor });
  }

  function refreshPackets() {
    if (requireActiveSession?.() === false) return;
    void packets.refetch();
  }

  return (
    <Card className="analyzer-card" id="analyzer-card">
      <div className="analyzer-heading">
        <h2 className="text-base font-bold tracking-tight text-gray-900">Packet analyzer</h2>
        {sourceLabel ? <Badge className="compact-heading-badge" color="warning" size="xs">{sourceLabel}</Badge> : null}
        <FilterBuilder value={filterDraft} busy={packets.isFetching} onApply={applyFilters} />
      </div>

      <nav className="analyzer-pagination" aria-label="Packet pages">
        <div className="analyzer-page-size">
          <Label htmlFor="packet-page-size">Rows</Label>
          <Select
            sizing="sm"
            id="packet-page-size"
            value={pageRequest.limit}
            onChange={(event) => resetPage(Number(event.target.value))}
            disabled={packets.isFetching}
          >
            {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </Select>
          <span className="analyzer-result-count">{packets.data?.items.length ?? 0} packets</span>
        </div>
        <div className="analyzer-page-navigation">
          <Tooltip content="Later">
            <button
              className="icon-action"
              type="button"
              onClick={goLater}
              disabled={packets.isFetching || !packets.data?.pageInfo.hasPreviousPage}
              aria-label="Later"
            >
              <UpArrowIcon />
            </button>
          </Tooltip>
          <span>Page {-page}</span>
          <Tooltip content="Earlier">
            <button
              className="icon-action"
              type="button"
              onClick={goEarlier}
              disabled={packets.isFetching || !packets.data?.pageInfo.hasNextPage}
              aria-label="Earlier"
            >
              <DownArrowIcon />
            </button>
          </Tooltip>
        </div>
        <div className="analyzer-refresh">
          <Tooltip content="Refresh packets">
            <button className="icon-action" type="button" onClick={refreshPackets} disabled={packets.isFetching} aria-label="Refresh packets">
              <span className={packets.isFetching ? 'animate-spin' : ''}><RefreshIcon /></span>
            </button>
          </Tooltip>
        </div>
      </nav>

      {packets.error ? <Alert color="failure">Could not load packets: {packets.error.message}</Alert> : null}
      <div className="analyzer-workspace">
        <PacketTable
          data={packets.data?.items ?? []}
          sorting={sorting}
          rowSelection={rowSelection}
          loading={packets.isFetching}
          onSortingChange={changeSorting}
          onRowSelectionChange={(updater) => setRowSelection((current) => functionalUpdate(updater, current))}
        />
        <PacketDetails packet={details.data} loading={details.isFetching} error={details.error} />
      </div>
    </Card>
  );
}
