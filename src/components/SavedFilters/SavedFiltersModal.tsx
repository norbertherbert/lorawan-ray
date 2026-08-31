import {
  Alert,
  Badge,
  Button,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  Textarea,
  TextInput,
  Tooltip,
} from 'flowbite-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  SavedFilter,
  SavedFilterType,
  SavedFilterVisibility,
} from '../../api/savedFilters.ts';
import { FolderOpenIcon, LinkIcon, RefreshButton, TrashIcon } from '../Icons.jsx';
import { formatDate } from '../../lib.js';

interface SavedFiltersModalProps {
  open: boolean;
  mode: 'open' | 'edit';
  filters: SavedFilter[];
  loading: boolean;
  busyId?: string;
  error?: string;
  notice?: string;
  currentUserId: string;
  onClose: () => void;
  onRefresh: () => void;
  onOpen: (filter: SavedFilter) => void;
  onCopyLink: (filter: SavedFilter) => void;
  onDelete: (filter: SavedFilter) => void;
}

export function SavedFiltersModal({
  open,
  mode,
  filters,
  loading,
  busyId,
  error,
  notice,
  currentUserId,
  onClose,
  onRefresh,
  onOpen,
  onCopyLink,
  onDelete,
}: SavedFiltersModalProps) {
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | SavedFilterType>('all');
  const [selectedScope, setSelectedScope] = useState<'mine' | 'shared'>('mine');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedType('all');
    setSelectedScope('mine');
    setPage(1);
  }, [open]);

  const visibleFilters = useMemo(
    () => {
      const term = search.trim().toLocaleLowerCase();
      return filters.filter((filter) => {
        const owned = filter.ownerId === currentUserId;
        if (selectedScope === 'mine' ? !owned : owned || filter.visibility !== 'shared') return false;
        if (selectedType !== 'all' && filter.definition.type !== selectedType) return false;
        if (!term) return true;
        return [
          filter.name,
          filter.description ?? '',
          filter.ownerName,
        ].some((value) => value.toLocaleLowerCase().includes(term));
      });
    },
    [currentUserId, filters, search, selectedScope, selectedType],
  );
  const totalPages = Math.max(1, Math.ceil(visibleFilters.length / SAVED_FILTERS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pagedFilters = visibleFilters.slice(
    (currentPage - 1) * SAVED_FILTERS_PER_PAGE,
    currentPage * SAVED_FILTERS_PER_PAGE,
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function changeType(value: 'all' | SavedFilterType) {
    setSelectedType(value);
    setPage(1);
  }

  function changeScope(value: 'mine' | 'shared') {
    setSelectedScope(value);
    setPage(1);
  }

  return (
    <Modal dismissible show={open} size="5xl" onClose={onClose}>
      <div className="saved-filters-modal-layout">
        <ModalHeader>Saved filters</ModalHeader>
        <ModalBody className="saved-filters-modal-body">
        <div className="saved-filter-toolbar">
          <label className="saved-filter-toolbar-field saved-filter-search">
            <span>Search</span>
            <TextInput
              sizing="sm"
              type="search"
              placeholder="Name, description, owner…"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
            />
          </label>
          <label className="saved-filter-toolbar-field saved-filter-type">
            <span>Type</span>
            <Select
              sizing="sm"
              value={selectedType}
              onChange={(event) => changeType(event.target.value as 'all' | SavedFilterType)}
            >
              <option value="all">All</option>
              <option value="sniffer">Normal</option>
              <option value="per">PER</option>
            </Select>
          </label>
          <div className="saved-filter-scope" role="group" aria-label="Filter ownership">
            <Button color={selectedScope === 'mine' ? 'blue' : 'light'} size="xs" type="button" onClick={() => changeScope('mine')}>
              My filters
            </Button>
            <Button color={selectedScope === 'shared' ? 'blue' : 'light'} size="xs" type="button" onClick={() => changeScope('shared')}>
              Shared with me
            </Button>
          </div>
          <RefreshButton
            busy={loading}
            label="saved filters"
            tooltipClassName="compact-icon-tooltip"
            tooltipLabel="Refresh"
            onClick={onRefresh}
          />
        </div>

        {error ? <Alert color="failure">{error}</Alert> : null}
        {notice ? <Alert color="success">{notice}</Alert> : null}
        {loading && !filters.length ? <p className="saved-filter-empty">Loading saved filters…</p> : null}
        {!loading && !visibleFilters.length ? <p className="saved-filter-empty">No matching filters are available.</p> : null}

        {visibleFilters.length ? (
          <div className="saved-filter-table-wrap">
            <Table className="saved-filter-table">
              <TableHead>
                <TableRow>
                  <TableHeadCell>Name</TableHeadCell>
                  <TableHeadCell>Type</TableHeadCell>
                  <TableHeadCell>{selectedScope === 'mine' ? 'Visibility' : 'Owner'}</TableHeadCell>
                  <TableHeadCell>Updated</TableHeadCell>
                  <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody className="divide-y">
                {pagedFilters.map((filter) => {
                  const owned = filter.ownerId === currentUserId;
                  const busy = busyId === filter.id;
                  return (
                    <TableRow key={filter.id}>
                      <TableCell className="saved-filter-name-cell">
                        <strong>{filter.name}</strong>
                        {filter.description ? <small title={filter.description}>{filter.description}</small> : null}
                      </TableCell>
                      <TableCell>
                        <Badge className="saved-filter-table-badge" color={filter.definition.type === 'per' ? 'purple' : 'info'} size="xs">
                          {filter.definition.type === 'per' ? 'PER' : 'Normal'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {selectedScope === 'mine' ? (
                          <Badge className="saved-filter-table-badge" color={filter.visibility === 'shared' ? 'success' : 'gray'} size="xs">
                            {filter.visibility === 'shared' ? 'Shared' : 'Private'}
                          </Badge>
                        ) : filter.ownerName}
                      </TableCell>
                      <TableCell className="saved-filter-updated-cell">{formatDate(filter.updatedAt).slice(0, 16)}</TableCell>
                      <TableCell>
                        <div className="saved-filter-actions">
                          {mode === 'open' ? (
                            <SavedFilterAction label="Open" onClick={() => onOpen(filter)} disabled={busy}>
                              <FolderOpenIcon />
                            </SavedFilterAction>
                          ) : (
                            <>
                              {filter.visibility === 'shared' ? (
                                <SavedFilterAction label="Copy link" onClick={() => onCopyLink(filter)} disabled={busy}>
                                  <LinkIcon />
                                </SavedFilterAction>
                              ) : null}
                              {owned ? (
                                <SavedFilterAction
                                  danger
                                  label="Delete"
                                  onClick={() => onDelete(filter)}
                                  disabled={busy}
                                >
                                  <TrashIcon />
                                </SavedFilterAction>
                              ) : null}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {visibleFilters.length ? (
          <div className="saved-filter-pagination">
            <span>
              {(currentPage - 1) * SAVED_FILTERS_PER_PAGE + 1}–{Math.min(currentPage * SAVED_FILTERS_PER_PAGE, visibleFilters.length)} of {visibleFilters.length} filters
            </span>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
              showIcons
              previousLabel="Previous"
              nextLabel="Next"
            />
          </div>
        ) : null}
        </ModalBody>
        <ModalFooter className="saved-filters-modal-footer">
          <Button color="light" size="xs" type="button" onClick={onClose}>Close</Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

const SAVED_FILTERS_PER_PAGE = 10;

interface SavedFilterActionProps {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}

function SavedFilterAction({ label, disabled, danger, children, onClick }: SavedFilterActionProps) {
  return (
    <Tooltip className="compact-icon-tooltip" content={label}>
      <button
        className={`icon-action${danger ? ' saved-filter-delete-action' : ''}`}
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

interface SaveFilterModalProps {
  open: boolean;
  filterType: SavedFilterType;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSave: (details: { name: string; description: string; visibility: SavedFilterVisibility }) => void;
}

export function SaveFilterModal({ open, filterType, busy, error, onClose, onSave }: SaveFilterModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<SavedFilterVisibility>('private');

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setVisibility('private');
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ name, description, visibility });
  }

  return (
    <Modal dismissible={!busy} show={open} size="lg" onClose={busy ? undefined : onClose}>
      <ModalHeader>Save as a new {filterType === 'per' ? 'PER' : 'Sniffer'} filter</ModalHeader>
      <form onSubmit={submit}>
        <ModalBody>
          <div className="save-filter-form">
            {error ? <Alert color="failure">{error}</Alert> : null}
            <div>
              <div className="mb-1 block"><Label htmlFor="saved-filter-name">Name *</Label></div>
              <TextInput
                id="saved-filter-name"
                sizing="sm"
                maxLength={80}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <div className="mb-1 block"><Label htmlFor="saved-filter-description">Description</Label></div>
              <Textarea
                id="saved-filter-description"
                rows={3}
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div>
              <div className="mb-1 block"><Label htmlFor="saved-filter-visibility">Visibility</Label></div>
              <Select
                id="saved-filter-visibility"
                sizing="sm"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as SavedFilterVisibility)}
              >
                <option value="private">Private</option>
                <option value="shared">Shared with authenticated users</option>
              </Select>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button color="blue" size="sm" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save filter'}
          </Button>
          <Button color="light" size="sm" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
