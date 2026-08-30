import {
  Alert,
  Badge,
  Button,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  Textarea,
  TextInput,
} from 'flowbite-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  SavedFilter,
  SavedFilterType,
  SavedFilterVisibility,
} from '../../api/savedFilters.ts';

interface SavedFiltersModalProps {
  open: boolean;
  filters: SavedFilter[];
  loading: boolean;
  busyId?: string;
  error?: string;
  notice?: string;
  initialType: SavedFilterType;
  currentUserId: string;
  onClose: () => void;
  onRefresh: () => void;
  onOpen: (filter: SavedFilter) => void;
  onCopyLink: (filter: SavedFilter) => void;
  onDelete: (filter: SavedFilter) => void;
}

export function SavedFiltersModal({
  open,
  filters,
  loading,
  busyId,
  error,
  notice,
  initialType,
  currentUserId,
  onClose,
  onRefresh,
  onOpen,
  onCopyLink,
  onDelete,
}: SavedFiltersModalProps) {
  const [selectedType, setSelectedType] = useState<SavedFilterType>('sniffer');
  useEffect(() => {
    if (open) setSelectedType(initialType);
  }, [open, initialType]);
  const visibleFilters = useMemo(
    () => filters.filter((filter) => filter.definition.type === selectedType),
    [filters, selectedType],
  );

  return (
    <Modal dismissible show={open} size="5xl" onClose={onClose}>
      <ModalHeader>Saved filters</ModalHeader>
      <ModalBody>
        <div className="saved-filter-toolbar">
          <div className="saved-filter-tabs" role="tablist" aria-label="Saved filter type">
            <Button color={selectedType === 'sniffer' ? 'blue' : 'light'} size="xs" type="button" onClick={() => setSelectedType('sniffer')}>
              Sniffer filters
            </Button>
            <Button color={selectedType === 'per' ? 'blue' : 'light'} size="xs" type="button" onClick={() => setSelectedType('per')}>
              PER filters
            </Button>
          </div>
          <Button color="light" size="xs" type="button" onClick={onRefresh} disabled={loading}>Refresh</Button>
        </div>

        {error ? <Alert color="failure">{error}</Alert> : null}
        {notice ? <Alert color="success">{notice}</Alert> : null}
        {loading && !filters.length ? <p className="saved-filter-empty">Loading saved filters…</p> : null}
        {!loading && !visibleFilters.length ? (
          <p className="saved-filter-empty">No {selectedType === 'per' ? 'PER' : 'Sniffer'} filters are available.</p>
        ) : null}

        <div className="saved-filter-list">
          {visibleFilters.map((filter) => {
            const owned = filter.ownerId === currentUserId;
            const busy = busyId === filter.id;
            return (
              <article className="saved-filter-row" key={filter.id}>
                <div className="saved-filter-summary">
                  <div className="saved-filter-title-row">
                    <strong>{filter.name}</strong>
                    <Badge color={filter.definition.type === 'per' ? 'purple' : 'info'} size="xs">
                      {filter.definition.type === 'per' ? 'PER' : 'Sniffer'}
                    </Badge>
                    <Badge color={filter.visibility === 'shared' ? 'success' : 'gray'} size="xs">
                      {filter.visibility === 'shared' ? 'Shared' : 'Private'}
                    </Badge>
                  </div>
                  <span>{filterSummary(filter)}</span>
                  <small>
                    {owned ? 'You' : filter.ownerName} · updated {formatDateTime(filter.updatedAt)}
                  </small>
                  {filter.description ? <p>{filter.description}</p> : null}
                </div>
                <div className="saved-filter-actions">
                  <Button color="blue" size="xs" type="button" onClick={() => onOpen(filter)} disabled={busy}>Open</Button>
                  <Button color="light" size="xs" type="button" onClick={() => onCopyLink(filter)} disabled={busy}>Copy link</Button>
                  {owned ? (
                    <Button color="failure" size="xs" type="button" onClick={() => onDelete(filter)} disabled={busy}>
                      {busy ? 'Deleting…' : 'Delete'}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button color="light" size="sm" type="button" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
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

function filterSummary(filter: SavedFilter): string {
  const definition = filter.definition;
  if (definition.type === 'per') {
    const parts = [`Device ${definition.devAddr}`];
    if (definition.fCntFrom !== undefined || definition.fCntTo !== undefined) {
      parts.push(`FCnt ${definition.fCntFrom ?? '…'}–${definition.fCntTo ?? '…'}`);
    }
    if (definition.observedFrom || definition.observedTo) parts.push('time range set');
    return parts.join(' · ');
  }
  const packetCount = Object.keys(definition.filters.packet ?? {}).length;
  const receptionCount = Object.keys(definition.filters.reception ?? {}).length;
  const count = packetCount + receptionCount;
  return count ? `${count} active filter ${count === 1 ? 'group' : 'groups'}` : 'No filtering criteria';
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
