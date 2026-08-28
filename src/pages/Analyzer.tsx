import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, type RowSelectionState, type SortingState } from '@tanstack/react-table';
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
  const [pageRequest, setPageRequest] = useState<UplinkPageRequest>({ limit: 10 });
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
    <section className="card analyzer-card" id="analyzer-card">
      <div className="analyzer-heading">
        <div>
          <h2>Packet analyzer</h2>
        </div>
        {sourceLabel ? <span className="analyzer-source is-mock">{sourceLabel}</span> : null}
      </div>

      <FilterBuilder value={filterDraft} busy={packets.isFetching} onApply={applyFilters} />

      <nav className="analyzer-pagination" aria-label="Packet pages">
        <label>
          Rows
          <select
            value={pageRequest.limit}
            onChange={(event) => resetPage(Number(event.target.value))}
            disabled={packets.isFetching}
          >
            {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <span className="analyzer-result-count">{packets.data?.items.length ?? 0} packets</span>
        </label>
        <div>
          <button
            className="pagination-icon-button"
            type="button"
            onClick={goLater}
            disabled={packets.isFetching || !packets.data?.pageInfo.hasPreviousPage}
            title="Later"
            aria-label="Later"
          >
            <UpArrowIcon />
          </button>
          <span>Page {-page}</span>
          <button
            className="pagination-icon-button"
            type="button"
            onClick={goEarlier}
            disabled={packets.isFetching || !packets.data?.pageInfo.hasNextPage}
            title="Earlier"
            aria-label="Earlier"
          >
            <DownArrowIcon />
          </button>
        </div>
        <button className={`refresh-icon-button${packets.isFetching ? ' is-busy' : ''}`} type="button" onClick={refreshPackets} disabled={packets.isFetching} title="Refresh packets" aria-label="Refresh packets">
          <RefreshIcon />
        </button>
      </nav>

      {packets.error ? <p className="analyzer-query-error" role="alert">Could not load packets: {packets.error.message}</p> : null}
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
    </section>
  );
}
