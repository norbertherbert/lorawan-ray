import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  functionalUpdate,
  type ColumnVisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { Alert, Badge, Card, Dropdown, DropdownDivider, DropdownItem, Label, Select, Spinner, Tooltip } from 'flowbite-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UplinkDataSource, UplinkFilters, UplinkSort } from '../api/types.ts';
import { exportPacketsToCsv } from '../api/packetCsv.ts';
import { PACKET_COLUMN_OPTIONS, type PacketColumnId } from '../api/packetColumns.ts';
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
import { DownloadIcon, RefreshIcon } from '../components/Icons.jsx';
import { isSessionAuthenticationError } from '../lib.js';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const NEWEST_FIRST_SORTING: UplinkSort[] = [{ field: 'observedAt', direction: 'desc' }];
const COLUMN_PREFERENCES_VERSION = 1;

function columnPreferencesKey(userId: string) {
  return `lora-manta.sniffer-columns.v${COLUMN_PREFERENCES_VERSION}:${userId}`;
}

function loadColumnVisibility(userId: string): ColumnVisibilityState {
  try {
    const value = JSON.parse(window.localStorage.getItem(columnPreferencesKey(userId)) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const visibility: ColumnVisibilityState = {};
    for (const { id } of PACKET_COLUMN_OPTIONS) {
      if ((value as Record<string, unknown>)[id] === false) visibility[id] = false;
    }
    return PACKET_COLUMN_OPTIONS.some(({ id }) => visibility[id] !== false) ? visibility : {};
  } catch {
    return {};
  }
}

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
  const queryClient = useQueryClient();
  const [batchSize, setBatchSize] = useState(25);
  const [tableResetVersion, setTableResetVersion] = useState(0);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(
    () => loadColumnVisibility(currentUserId),
  );
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
  const [packetDetailsExpanded, setPacketDetailsExpanded] = useState(false);
  const [filterPrefill, setFilterPrefill] = useState<FilterPrefill | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportedPacketCount, setExportedPacketCount] = useState(0);
  const [csvExportError, setCsvExportError] = useState('');
  const csvExportController = useRef<AbortController | null>(null);
  const initialSavedFilterLoaded = useRef(false);
  const reportedSearchError = useRef<unknown>(null);
  const reportedDetailsError = useRef<unknown>(null);
  const visibleColumnCount = PACKET_COLUMN_OPTIONS.filter(
    ({ id }) => columnVisibility[id] !== false,
  ).length;
  const packets = useInfiniteQuery({
    queryKey: ['uplinks', sourceKey, { batchSize, sorting: NEWEST_FIRST_SORTING, filters }],
    initialPageParam: {} as { after?: string; before?: string },
    queryFn: ({ signal, pageParam, direction }) => dataSource.search(
      {
        // Refetch starts at the newest packets even after prepending a page.
        page: { limit: batchSize, ...(direction === 'forward' && pageParam.before ? {} : pageParam) },
        sorting: NEWEST_FIRST_SORTING,
        filters,
      },
      { signal },
    ),
    getNextPageParam: (lastPage): { after?: string; before?: string } | undefined => (
      lastPage.pageInfo.hasNextPage && lastPage.pageInfo.endCursor
        ? { after: lastPage.pageInfo.endCursor } : undefined
    ),
    // New packets can arrive even when the initial page had no previous page.
    getPreviousPageParam: (_firstPage, pages): { after?: string; before?: string } | undefined => {
      const cursor = pages.find((page) => page.items.length)?.pageInfo.startCursor;
      return cursor ? { before: cursor } : undefined;
    },
  });
  const packetRows = useMemo(
    () => packets.data?.pages.flatMap(({ items }) => items) ?? [],
    [packets.data],
  );
  const appliedPerFilters = filterDraft.filterType !== 'sniffer' ? filters : undefined;
  const packetErrorRates = useQuery({
    queryKey: ['packet-error-rates', sourceKey, filterDraft.filterType, appliedPerFilters],
    queryFn: async ({ signal }) => {
      const devAddrs = appliedPerFilters?.packet?.devAddrs ?? [];
      return Promise.all(devAddrs.map(async (devAddr) => {
        const result = await dataSource.calculatePacketErrorRate(
          filtersForDeviceAddress(appliedPerFilters!, devAddr),
          { signal },
        );
        return { devAddr, percentage: result?.percentage ?? null };
      }));
    },
    enabled: Boolean(appliedPerFilters),
  });
  const selectedId = Object.keys(rowSelection)[0];
  const details = useQuery({
    queryKey: ['uplink', sourceKey, selectedId],
    queryFn: ({ signal }) => dataSource.getById(selectedId, { signal }),
    enabled: Boolean(selectedId && packetDetailsExpanded),
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
    return () => csvExportController.current?.abort();
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(columnPreferencesKey(currentUserId), JSON.stringify(columnVisibility));
    } catch {
      // Column choices still apply for this browser session when storage is unavailable.
    }
  }, [columnVisibility, currentUserId]);
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

  function resetPacketList(nextBatchSize = batchSize) {
    setBatchSize(nextBatchSize);
    setTableResetVersion((current) => current + 1);
  }

  function setPacketColumnVisible(columnId: PacketColumnId, visible: boolean) {
    if (!visible && visibleColumnCount === 1) return;

    const nextVisibility = { ...columnVisibility };
    if (visible) delete nextVisibility[columnId];
    else nextVisibility[columnId] = false;
    setColumnVisibility(nextVisibility);
  }

  function showAllPacketColumns() {
    setColumnVisibility({});
  }

  function applyFilters(draft: FilterDraft, nextFilters: UplinkFilters | undefined) {
    setFilterDraft(draft);
    setFilters(nextFilters);
    setRowSelection({});
    resetPacketList();
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
      resetPacketList();
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

  function refreshPackets() {
    if (requireActiveSession?.() === false) return;
    setRowSelection({});
    resetPacketList();
    // Reset removes every retained page/cursor and cancels an in-flight page
    // request before fetching a fresh first batch with the current filter.
    void queryClient.resetQueries({
      queryKey: ['uplinks', sourceKey, { batchSize, sorting: NEWEST_FIRST_SORTING, filters }],
      exact: true,
    });
  }

  const loadOlderPackets = useCallback(() => {
    if (!packets.hasNextPage || packets.isFetching) return;
    void packets.fetchNextPage({ cancelRefetch: false });
  }, [packets.hasNextPage, packets.isFetching, packets.fetchNextPage]);

  const loadNewerPackets = useCallback(() => {
    if (packets.isFetching) return;
    if (packets.hasPreviousPage) void packets.fetchPreviousPage({ cancelRefetch: false });
    else void packets.refetch();
  }, [packets.isFetching, packets.hasPreviousPage, packets.fetchPreviousPage, packets.refetch]);

  function toggleCsvExport() {
    if (csvExportController.current) {
      csvExportController.current.abort();
      return;
    }
    if (requireActiveSession?.() === false) return;

    const controller = new AbortController();
    csvExportController.current = controller;
    setExportingCsv(true);
    setExportedPacketCount(0);
    setCsvExportError('');

    void exportPacketsToCsv({
      dataSource,
      filters,
      signal: controller.signal,
      onProgress: setExportedPacketCount,
    })
      .then((csv) => {
        if (!controller.signal.aborted) downloadCsv(csv, csvExportFilename());
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setCsvExportError(errorText(cause, 'Could not export packets.'));
        reportSessionError(cause, 'Could not export packets.');
      })
      .finally(() => {
        if (csvExportController.current === controller) csvExportController.current = null;
        setExportingCsv(false);
      });
  }

  const csvExportStatus = exportedPacketCount > 0
    ? `Exporting CSV… ${exportedPacketCount.toLocaleString()} packets processed — click to cancel`
    : 'Exporting CSV… click to cancel';

  return (
    <Card className="analyzer-card" id="analyzer-card">
      <div className="analyzer-heading">
        <h2 className="text-base font-bold tracking-tight text-gray-900">Packet sniffer</h2>
        {sourceLabel ? <Badge className="compact-heading-badge" color="warning" size="xs">{sourceLabel}</Badge> : null}
        <FilterBuilder
          value={filterDraft}
          expanded={filterExpanded}
          busy={packets.isLoading || savingFilter}
          activeFilterName={activeSavedFilter?.name}
          activeFilterModified={activeFilterModified}
          canSave={Boolean(activeSavedFilter && ownsActiveFilter)}
          packetErrorRates={packetErrorRates.data}
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
          <div className="analyzer-column-picker">
            <Dropdown
              color="light"
              size="xs"
              type="button"
              label="Columns"
              placement="bottom-start"
              dismissOnClick={false}
            >
              {PACKET_COLUMN_OPTIONS.map(({ id, label }) => {
                const visible = columnVisibility[id] !== false;
                return (
                  <DropdownItem
                    key={id}
                    className="packet-column-option"
                    role="menuitemcheckbox"
                    aria-checked={visible}
                    disabled={visible && visibleColumnCount === 1}
                    onClick={() => setPacketColumnVisible(id, !visible)}
                  >
                    <span className={`packet-column-check${visible ? ' is-checked' : ''}`} aria-hidden="true">
                      {visible ? '✓' : ''}
                    </span>
                    <span>{label}</span>
                  </DropdownItem>
                );
              })}
              <DropdownDivider />
              <DropdownItem
                className="packet-column-reset"
                disabled={visibleColumnCount === PACKET_COLUMN_OPTIONS.length}
                onClick={showAllPacketColumns}
              >
                Show all columns
              </DropdownItem>
            </Dropdown>
          </div>
          <Tooltip className="rows-tooltip" content="Number of packets loaded at a time while scrolling.">
            <Label htmlFor="packet-page-size">Rows</Label>
          </Tooltip>
          <Select
            className="analyzer-row-count-select"
            sizing="sm"
            id="packet-page-size"
            value={batchSize}
            onChange={(event) => {
              setRowSelection({});
              resetPacketList(Number(event.target.value));
            }}
            disabled={packets.isFetching}
          >
            {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </Select>
          <span className="analyzer-result-count">{packetRows.length} packets loaded</span>
        </div>
        <div className="analyzer-refresh">
          {exportingCsv ? <span className="sr-only" role="status" aria-live="polite">{csvExportStatus}</span> : null}
          <Tooltip content={exportingCsv ? csvExportStatus : 'Export filtered packets as CSV'}>
            <button
              className="icon-action"
              type="button"
              onClick={toggleCsvExport}
              aria-label={exportingCsv ? 'Cancel CSV export' : 'Export filtered packets as CSV'}
            >
              {exportingCsv ? <Spinner size="sm" aria-hidden="true" /> : <DownloadIcon />}
            </button>
          </Tooltip>
          <Tooltip content="Refresh packets">
            <button className="icon-action" type="button" onClick={refreshPackets} disabled={packets.isRefetching} aria-label="Refresh packets">
              <span className={packets.isRefetching ? 'animate-spin' : ''}><RefreshIcon /></span>
            </button>
          </Tooltip>
        </div>
      </nav>

      {csvExportError ? <Alert color="failure">{csvExportError}</Alert> : null}
      {packets.error ? <Alert color="failure">Could not load packets: {packets.error.message}</Alert> : null}
      <div className={`analyzer-workspace${packetDetailsExpanded ? '' : ' details-collapsed'}`}>
        <PacketTable
          data={packetRows}
          columnVisibility={columnVisibility}
          rowSelection={rowSelection}
          loading={packets.isLoading}
          loadingMore={packets.isFetchingNextPage}
          loadingNewer={packets.isFetchingPreviousPage}
          hasMore={Boolean(packets.hasNextPage)}
          scrollResetVersion={tableResetVersion}
          showFilterActions={filterExpanded}
          onFilterByDevAddr={prefillDevAddr}
          onFilterByGatewayId={prefillGatewayId}
          onFilterStartTime={prefillStartTime}
          onFilterEndTime={prefillEndTime}
          onColumnVisibilityChange={setColumnVisibility}
          onRowSelectionChange={(updater) => setRowSelection((current) => functionalUpdate(updater, current))}
          onRowDoubleClick={() => setPacketDetailsExpanded(true)}
          onLoadMore={loadOlderPackets}
          onLoadNewer={loadNewerPackets}
        />
        <PacketDetails
          packet={details.data}
          loading={details.isFetching}
          error={details.error}
          expanded={packetDetailsExpanded}
          onExpandedChange={setPacketDetailsExpanded}
        />
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

function filtersForDeviceAddress(filters: UplinkFilters, devAddr: string): UplinkFilters {
  return {
    ...filters,
    packet: {
      ...filters.packet,
      devAddrs: [devAddr],
    },
  };
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvExportFilename(now = new Date()) {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');
  const time = [now.getHours(), now.getMinutes()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');
  return `lora-manta-packets-${date}-${time}.csv`;
}
