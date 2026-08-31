import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, type RowSelectionState, type SortingState } from '@tanstack/react-table';
import { Alert, Badge, Card, Label, Select, Tooltip } from 'flowbite-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UplinkDataSource, UplinkFilters, UplinkPageRequest, UplinkSort } from '../api/types.ts';
import {
  createSavedFilterDefinition,
  savedFilterDefinitionSignature,
  savedFilterDefinitionToFilters,
  savedFilterIdFromLocation,
  savedFilterUrl,
  setSavedFilterLocation,
  type SavedFilter,
  type SavedFilterVisibility,
  type SurrealSavedFilterDataSource,
} from '../api/savedFilters.ts';
import FilterBuilder, {
  emptyFilterDraft,
  filterDraftFromSavedDefinition,
  type FilterPrefill,
  type FilterDraft,
} from '../components/FilterBuilder/FilterBuilder.tsx';
import PacketDetails from '../components/PacketDetails/PacketDetails.tsx';
import PacketTable from '../components/PacketTable/PacketTable.tsx';
import { SaveFilterModal, SavedFiltersModal } from '../components/SavedFilters/SavedFiltersModal.tsx';
import { DownArrowIcon, RefreshIcon, UpArrowIcon } from '../components/Icons.jsx';
import { isSessionAuthenticationError } from '../lib.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

interface AnalyzerProps {
  dataSource: UplinkDataSource;
  sourceKey: string;
  sourceLabel?: string;
  savedFilterDataSource: SurrealSavedFilterDataSource;
  currentUserId: string;
  requireActiveSession?: () => boolean;
  onDatabaseError?: (cause: unknown, fallback: string) => void;
}

export default function Analyzer({
  dataSource,
  sourceKey,
  sourceLabel,
  savedFilterDataSource,
  currentUserId,
  requireActiveSession,
  onDatabaseError,
}: AnalyzerProps) {
  const [page, setPage] = useState(0);
  const [pageRequest, setPageRequest] = useState<UplinkPageRequest>({ limit: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'observedAt', desc: true }]);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(emptyFilterDraft);
  const [filters, setFilters] = useState<UplinkFilters | undefined>();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [savedFiltersOpen, setSavedFiltersOpen] = useState(false);
  const [savedFiltersMode, setSavedFiltersMode] = useState<'open' | 'edit'>('open');
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [savedFilterError, setSavedFilterError] = useState('');
  const [savedFilterNotice, setSavedFilterNotice] = useState('');
  const [saveAsError, setSaveAsError] = useState('');
  const [savedFilterBusyId, setSavedFilterBusyId] = useState('');
  const [savingFilter, setSavingFilter] = useState(false);
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null);
  const [hasUnappliedDraft, setHasUnappliedDraft] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [filterPrefill, setFilterPrefill] = useState<FilterPrefill | null>(null);
  const initialSavedFilterLoaded = useRef(false);
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
  const appliedPerFilters = filterDraft.filterType === 'per' ? filters : undefined;
  const packetErrorRate = useQuery({
    queryKey: ['packet-error-rate', sourceKey, appliedPerFilters],
    queryFn: ({ signal }) => dataSource.calculatePacketErrorRate(appliedPerFilters!, { signal }),
    enabled: Boolean(appliedPerFilters),
  });
  const selectedId = Object.keys(rowSelection)[0];
  const details = useQuery({
    queryKey: ['uplink', sourceKey, selectedId],
    queryFn: ({ signal }) => dataSource.getById(selectedId, { signal }),
    enabled: Boolean(selectedId),
  });
  const savedFilters = useQuery({
    queryKey: ['saved-filters', sourceKey, currentUserId],
    queryFn: () => savedFilterDataSource.list(),
  });
  const appliedDefinition = useMemo(() => {
    try {
      return createSavedFilterDefinition(filterDraft.filterType, filters);
    } catch {
      return null;
    }
  }, [filterDraft.filterType, filters]);
  const activeFilterModified = Boolean(
    activeSavedFilter &&
    (!appliedDefinition ||
      savedFilterDefinitionSignature(activeSavedFilter.definition) !== savedFilterDefinitionSignature(appliedDefinition)),
  );
  const ownsActiveFilter = activeSavedFilter?.ownerId === currentUserId;
  const prefillFilterField = useCallback((field: 'devAddr' | 'gatewayId', value: string) => {
    setFilterPrefill((current) => ({
      kind: 'field',
      field,
      value,
      revision: (current?.revision ?? 0) + 1,
    }));
  }, []);
  const prefillDevAddr = useCallback(
    (value: string) => prefillFilterField('devAddr', value),
    [prefillFilterField],
  );
  const prefillGatewayId = useCallback(
    (value: string) => prefillFilterField('gatewayId', value),
    [prefillFilterField],
  );
  const prefillTimestamp = useCallback((target: 'start' | 'end', value: string) => {
    setFilterPrefill((current) => ({
      kind: 'timestamp',
      target,
      value,
      revision: (current?.revision ?? 0) + 1,
    }));
  }, []);
  const prefillStartTime = useCallback(
    (value: string) => prefillTimestamp('start', value),
    [prefillTimestamp],
  );
  const prefillEndTime = useCallback(
    (value: string) => prefillTimestamp('end', value),
    [prefillTimestamp],
  );

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
  useEffect(() => {
    if (!savedFilters.error) return;
    reportSavedFilterError(savedFilters.error, 'Could not load saved filters.');
  }, [savedFilters.error]);
  useEffect(() => {
    if (initialSavedFilterLoaded.current) return;
    initialSavedFilterLoaded.current = true;
    let filterId: string | null = null;
    try {
      filterId = savedFilterIdFromLocation();
    } catch (cause) {
      reportSavedFilterError(cause, 'The shared filter link is invalid.');
      return;
    }
    if (!filterId) return;
    void savedFilterDataSource.get(filterId)
      .then((filter) => activateSavedFilter(filter, false))
      .catch((cause) => reportSavedFilterError(cause, 'Could not open the shared filter.'));
  }, [savedFilterDataSource]);

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

  function activateSavedFilter(filter: SavedFilter, confirmDiscard = true) {
    if (
      confirmDiscard &&
      (hasUnappliedDraft || activeFilterModified || (!activeSavedFilter && filters !== undefined)) &&
      !window.confirm('Discard the changes to the current filter and open this saved filter?')
    ) return;
    try {
      const draft = filterDraftFromSavedDefinition(filter.definition);
      const nextFilters = savedFilterDefinitionToFilters(filter.definition);
      setFilterDraft(draft);
      setFilters(nextFilters);
      setActiveSavedFilter(filter);
      setHasUnappliedDraft(false);
      setFilterExpanded(true);
      setRowSelection({});
      resetPage();
      setSavedFiltersOpen(false);
      setSavedFilterError('');
      setSavedFilterNotice('');
      setSavedFilterLocation(filter.id);
    } catch (cause) {
      reportSavedFilterError(cause, 'The saved filter definition is invalid.');
    }
  }

  async function createSavedFilter(details: {
    name: string;
    description: string;
    visibility: SavedFilterVisibility;
  }) {
    if (requireActiveSession?.() === false) return;
    setSavingFilter(true);
    setSaveAsError('');
    setSavedFilterNotice('');
    try {
      if (!appliedDefinition) throw new Error('Apply a valid filter before saving it.');
      const created = await savedFilterDataSource.create({
        ...details,
        definition: appliedDefinition,
      });
      setActiveSavedFilter(created);
      setSaveAsOpen(false);
      setSavedFilterLocation(created.id);
      await savedFilters.refetch();
    } catch (cause) {
      setSaveAsError(errorText(cause, 'Could not save the filter.'));
      reportSessionError(cause, 'Could not save the filter.');
    } finally {
      setSavingFilter(false);
    }
  }

  async function updateSavedFilter(definition = appliedDefinition) {
    if (!activeSavedFilter || !ownsActiveFilter || !definition || requireActiveSession?.() === false) return;
    setSavingFilter(true);
    setSavedFilterError('');
    setSavedFilterNotice('');
    try {
      const updated = await savedFilterDataSource.update(activeSavedFilter.id, {
        definition,
      });
      setActiveSavedFilter(updated);
      await savedFilters.refetch();
    } catch (cause) {
      reportSavedFilterError(cause, 'Could not update the saved filter.');
    } finally {
      setSavingFilter(false);
    }
  }

  async function deleteSavedFilter(filter: SavedFilter) {
    if (!window.confirm(`Delete the saved filter “${filter.name}”?`)) return;
    if (requireActiveSession?.() === false) return;
    setSavedFilterBusyId(filter.id);
    setSavedFilterError('');
    setSavedFilterNotice('');
    try {
      await savedFilterDataSource.delete(filter.id);
      if (activeSavedFilter?.id === filter.id) {
        setActiveSavedFilter(null);
        setSavedFilterLocation(null);
      }
      await savedFilters.refetch();
    } catch (cause) {
      reportSavedFilterError(cause, 'Could not delete the saved filter.');
    } finally {
      setSavedFilterBusyId('');
    }
  }

  async function copySavedFilterLink(filter: SavedFilter) {
    try {
      await navigator.clipboard.writeText(savedFilterUrl(filter.id));
      setSavedFilterError('');
      setSavedFilterNotice(
        filter.visibility === 'shared'
          ? 'Shareable link copied.'
          : 'Private link copied. Only you can open this filter.',
      );
    } catch (cause) {
      setSavedFilterError(errorText(cause, 'Could not copy the saved-filter link.'));
      setSavedFilterNotice('');
    }
  }

  function reportSavedFilterError(cause: unknown, fallback: string) {
    setSavedFilterError(errorText(cause, fallback));
    setSavedFilterNotice('');
    reportSessionError(cause, fallback);
  }

  function reportSessionError(cause: unknown, fallback: string) {
    if (isSessionAuthenticationError(cause)) onDatabaseError?.(cause, fallback);
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
        <h2 className="text-base font-bold tracking-tight text-gray-900">Packet sniffer</h2>
        {sourceLabel ? <Badge className="compact-heading-badge" color="warning" size="xs">{sourceLabel}</Badge> : null}
        <FilterBuilder
          value={filterDraft}
          expanded={filterExpanded}
          busy={packets.isFetching || savingFilter}
          activeFilterName={activeSavedFilter?.name}
          activeFilterModified={activeFilterModified}
          canSave={Boolean(activeSavedFilter && ownsActiveFilter)}
          packetErrorRate={packetErrorRate.data?.percentage ?? (packetErrorRate.data === null ? null : undefined)}
          filterPrefill={filterPrefill}
          onApply={applyFilters}
          onOpenSavedFilters={() => {
            setSavedFilterNotice('');
            setSavedFiltersMode('open');
            setSavedFiltersOpen(true);
          }}
          onEditSavedFilters={() => {
            setSavedFilterNotice('');
            setSavedFiltersMode('edit');
            setSavedFiltersOpen(true);
          }}
          onSaveAs={() => {
            setSaveAsError('');
            setSaveAsOpen(true);
          }}
          onSave={(draft, nextFilters) => {
            const definition = createSavedFilterDefinition(draft.filterType, nextFilters);
            void updateSavedFilter(definition);
          }}
          onCloseSavedFilter={() => {
            const cleared = { ...emptyFilterDraft(), filterType: filterDraft.filterType };
            applyFilters(cleared, undefined);
            setActiveSavedFilter(null);
            setHasUnappliedDraft(false);
            setSavedFilterLocation(null);
          }}
          onDraftDirtyChange={setHasUnappliedDraft}
          onExpandedChange={setFilterExpanded}
        />
      </div>

      {savedFilterError && !savedFiltersOpen ? <Alert color="failure">{savedFilterError}</Alert> : null}

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
          showFilterActions={filterExpanded}
          onFilterByDevAddr={prefillDevAddr}
          onFilterByGatewayId={prefillGatewayId}
          onFilterStartTime={prefillStartTime}
          onFilterEndTime={prefillEndTime}
          onSortingChange={changeSorting}
          onRowSelectionChange={(updater) => setRowSelection((current) => functionalUpdate(updater, current))}
        />
        <PacketDetails packet={details.data} loading={details.isFetching} error={details.error} />
      </div>

      <SavedFiltersModal
        open={savedFiltersOpen}
        mode={savedFiltersMode}
        filters={savedFilters.data ?? []}
        loading={savedFilters.isFetching}
        busyId={savedFilterBusyId}
        error={savedFilterError}
        notice={savedFilterNotice}
        currentUserId={currentUserId}
        onClose={() => setSavedFiltersOpen(false)}
        onRefresh={() => void savedFilters.refetch()}
        onOpen={activateSavedFilter}
        onCopyLink={(filter) => void copySavedFilterLink(filter)}
        onDelete={(filter) => void deleteSavedFilter(filter)}
      />
      <SaveFilterModal
        open={saveAsOpen}
        filterType={filterDraft.filterType}
        busy={savingFilter}
        error={saveAsError}
        onClose={() => setSaveAsOpen(false)}
        onSave={(details) => void createSavedFilter(details)}
      />
    </Card>
  );
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
