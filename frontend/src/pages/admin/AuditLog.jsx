// Audit Log (FR2) — who did what to whom, and when. Read-only, Admin only.
// Opened from the "Audit log" button on User Management, or from a user's
// "View activity" menu item (?userId=...).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import Pagination from '../../components/Pagination';
import Select from '../../components/Select';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import useFetch from '../../hooks/useFetch';
import { formatDateTime, timeAgo } from '../../utils/format';
import PageHeader from '../PageHeader';
import { ACTION_INFO, describeDetails } from './auditLabels';
import './admin.css';

const PAGE_SIZE = 25;
const NO_FILTERS = { action: '', from: '', to: '' };

const ACTION_OPTIONS = Object.entries(ACTION_INFO).map(([value, { label }]) => ({ value, label }));

function Person({ person }) {
  if (!person) return <span className="audit-person">—</span>;
  return (
    <span className="audit-person">
      <span>{person.fullName}</span>
      <small>{person.email}</small>
    </span>
  );
}

export default function AuditLog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = searchParams.get('userId');

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebouncedValue(search.trim());
  const params = { page, pageSize: PAGE_SIZE };
  if (userId) params.userId = userId;
  if (debouncedSearch) params.search = debouncedSearch;
  const rangeError = filters.from && filters.to && filters.from > filters.to
    ? 'The start date must be on or before the end date.'
    : null;
  if (filters.action) params.action = filters.action;
  // Hold back an impossible date range instead of sending it to the server.
  if (!rangeError) {
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
  }

  const log = useFetch('/audit-logs', params);
  // Name for the "Activity for ..." chip
  const person = useFetch(userId ? `/users/${userId}` : null);

  const changeFilter = (key) => (event) => {
    setFilters((f) => ({ ...f, [key]: event.target.value }));
    setPage(1);
  };
  const isFiltered = Boolean(debouncedSearch || userId || Object.values(filters).some(Boolean));
  const clearAll = () => {
    setSearch('');
    setFilters(NO_FILTERS);
    setPage(1);
    setSearchParams({});
  };

  const data = log.data;
  const entries = data?.entries || [];

  return (
    <>
      <Link to="/admin/users" className="back-link">
        <Icon name="chevronLeft" size={14} /> User Management
      </Link>
      <PageHeader
        eyebrow="System Administration"
        title="Audit Log"
        subtitle="Every invitation, edit, deactivation and sign-in, newest first. Entries cannot be edited or deleted."
      />

      <section className="card panel">
        <div className="toolbar">
          <h2 className="panel__title toolbar__title">
            Activity
            {data && <span className="toolbar__meta">{data.pagination.total} entries</span>}
          </h2>
        </div>

        <div className="filters filters--audit">
          <Input label="Search" icon="search" type="search" placeholder="Name or email…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} maxLength={100} />
          <Select label="Action" value={filters.action} onChange={changeFilter('action')}
            placeholder="All actions" options={ACTION_OPTIONS} />
          <Input label="From" type="date" value={filters.from} onChange={changeFilter('from')} max={filters.to || undefined} />
          <Input label="To" type="date" value={filters.to} onChange={changeFilter('to')} min={filters.from || undefined}
            error={rangeError} />
          <Button variant="ghost" size="sm" onClick={clearAll} disabled={!isFiltered}>Clear</Button>
        </div>

        {userId && (
          <span className="filter-chip">
            Activity for {person.data?.user?.fullName || 'selected user'}
            <button type="button" onClick={() => { setSearchParams({}); setPage(1); }} aria-label="Show all users">
              <Icon name="close" size={12} />
            </button>
          </span>
        )}

        <div className="panel__body">
          {log.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{log.error}</span>
              <Button variant="secondary" size="sm" onClick={log.reload}>Try again</Button>
            </div>
          )}

          {!data && !log.error && <p className="loading-text">Loading activity…</p>}

          {data && entries.length === 0 && (
            <div className="empty-state">
              <strong>{isFiltered ? 'No activity matches these filters' : 'No activity recorded yet'}</strong>
              {isFiltered && <Button variant="secondary" size="sm" onClick={clearAll}>Clear filters</Button>}
            </div>
          )}

          {entries.length > 0 && (
            <div className={`table-wrap ${log.loading ? 'is-loading' : ''}`} aria-busy={log.loading}>
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>By</th>
                    <th className="hide-sm">User affected</th>
                    <th className="hide-sm">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const info = ACTION_INFO[e.action] || { label: e.action, tone: 'neutral' };
                    // Sign-ins act on yourself; repeating the name adds nothing.
                    const sameUser = e.actor && e.target && e.actor.id === e.target.id;
                    return (
                      <tr key={e.id}>
                        <td>
                          <span className="audit-when">
                            <span>{formatDateTime(e.createdAt)}</span>
                            <small>{timeAgo(e.createdAt)}</small>
                          </span>
                        </td>
                        <td><Badge tone={info.tone}>{info.label}</Badge></td>
                        <td><Person person={e.actor} /></td>
                        <td className="hide-sm">{sameUser ? '—' : <Person person={e.target} />}</td>
                        <td className="hide-sm audit-details">{describeDetails(e.action, e.details) || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && <Pagination pagination={data.pagination} onPageChange={setPage} itemLabel="entries" disabled={log.loading} />}
        </div>
      </section>
    </>
  );
}
