import { ArrowDownIcon, ArrowUpIcon, EyeIcon, RefreshButton } from './Icons.jsx';
import { formatDate } from '../lib.js';
import ReceptionFilters from './ReceptionFilters.jsx';

const columns = [
  ['ingested_at', (reception) => formatDate(reception.gateway?.ingested_at)],
  ['gateway_id', (reception) => reception.gateway?.gateway_id],
  ['mtype', (reception) => reception.lorawan?.mtype],
  ['dev_addr', (reception) => reception.lorawan?.dev_addr],
  ['fport', (reception) => reception.lorawan?.fport],
  ['fcnt', (reception) => reception.lorawan?.fcnt],
  ['modu', (reception) => reception.rxpk?.modu],
  ['datr', (reception) => reception.rxpk?.datr],
  ['freq', (reception) => reception.rxpk?.freq],
];

export default function ReceptionTable({
  receptions,
  refreshing,
  page,
  pageSize,
  hasNextPage,
  filters,
  onRefresh,
  onPageChange,
  onPageSizeChange,
  onFiltersChange,
  onSelect,
}) {
  const noun = receptions.length === 1 ? 'reception' : 'receptions';

  return (
    <section className="card receptions-card" id="receptions-card">
      <div className="section-heading">
        <div>
          <p className="section-label">gateway_rxpk</p>
          <h2>Latest receptions</h2>
        </div>
        <span className="number">02</span>
      </div>

      <ReceptionFilters filters={filters} busy={refreshing} onApply={onFiltersChange} />

      <nav className="pagination" aria-label="Reception pages">
        <label className="pagination-size" htmlFor="reception-page-size">
          Rows per page
          <select
            id="reception-page-size"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            disabled={refreshing}
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <div className="pagination-controls">
          <button
            className="secondary-button pagination-direction-button"
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={refreshing || page === 0}
            aria-label="Later"
            title="Later"
          >
            <ArrowUpIcon />
          </button>
          <span aria-live="polite">Page {page + 1}</span>
          <button
            className="secondary-button pagination-direction-button"
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={refreshing || !hasNextPage}
            aria-label="Earlier"
            title="Earlier"
          >
            <ArrowDownIcon />
          </button>
        </div>
        <RefreshButton busy={refreshing} label="receptions" onClick={onRefresh} />
      </nav>

      <div className="reception-summary">
        <span>{`Page ${page + 1} · ${receptions.length} ${noun}`}</span>
      </div>

      <div className="reception-table-wrap" hidden={receptions.length === 0}>
        <table>
          <thead>
            <tr>
              {columns.map(([label]) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody aria-live="polite">
            {receptions.map((reception, index) => (
              <ReceptionRow
                key={reception.id?.toString() || index}
                reception={reception}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="empty-state" hidden={receptions.length > 0}>
        <span>⌁</span>
        <p>No gateway receptions are available.</p>
      </div>
    </section>
  );
}

function ReceptionRow({ reception, onSelect }) {
  const gatewayId = reception.gateway?.gateway_id ?? 'unknown gateway';

  return (
    <tr>
      {columns.map(([label, readValue]) => (
        <td key={label}>{String(readValue(reception) ?? '—')}</td>
      ))}
      <td className="reception-action">
        <button
          type="button"
          className="details-button"
          onClick={() => onSelect(reception)}
          title="View JSON"
          aria-label={`View complete JSON for reception from ${gatewayId}`}
        >
          <EyeIcon />
        </button>
      </td>
    </tr>
  );
}
