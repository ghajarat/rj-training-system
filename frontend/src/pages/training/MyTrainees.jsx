// My Trainees — progress across all plans, per trainee (FR9).
// Overdue trainees are listed first so they are the first thing a trainer sees.
// Clicking a trainee opens their plans and per-course progress.
import { useState } from 'react';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Pagination from '../../components/Pagination';
import ProgressBar from '../../components/ProgressBar';
import Select from '../../components/Select';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import useFetch from '../../hooks/useFetch';
import { initials, plural, timeAgo } from '../../utils/format';
import PageHeader from '../PageHeader';
import TraineeProgressModal from './TraineeProgressModal';
import './training.css';

export default function MyTrainees() {
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);   // trainee whose detail is shown

  const debouncedSearch = useDebouncedValue(search.trim());
  const params = { page };
  if (debouncedSearch) params.search = debouncedSearch;
  if (departmentId) params.departmentId = departmentId;

  const trainees = useFetch('/trainees', params);
  const departments = useFetch('/departments');

  const data = trainees.data;
  const rows = data?.trainees || [];
  const isFiltered = Boolean(debouncedSearch || departmentId);
  const clearFilters = () => { setSearch(''); setDepartmentId(''); setPage(1); };

  return (
    <>
      <PageHeader
        eyebrow="Training Management"
        title="My Trainees"
        subtitle="Completion, last activity and overdue plans for every active trainee."
      />

      <section className="card panel">
        <div className="toolbar">
          <h2 className="panel__title toolbar__title">
            Trainees
            {data && <span className="toolbar__meta">{plural(data.pagination.total, 'active trainee')}</span>}
          </h2>
          <div className="toolbar__controls">
            <Input className="toolbar__search" icon="search" type="search" placeholder="Search name or email…"
              aria-label="Search trainees" value={search} maxLength={100}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        <div className="filters filters--materials">
          <Select label="Department" value={departmentId} placeholder="All departments"
            onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}
            options={(departments.data?.departments || []).map((d) => ({ value: d.id, label: d.name }))} />
          <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!isFiltered}>Clear filters</Button>
        </div>

        <div className="panel__body">
          {trainees.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{trainees.error}</span>
              <Button variant="secondary" size="sm" onClick={trainees.reload}>Try again</Button>
            </div>
          )}
          {!data && !trainees.error && <p className="loading-text">Loading trainees…</p>}

          {data && rows.length === 0 && (
            <div className="empty-state">
              <strong>{isFiltered ? 'No trainees match your filters' : 'No active trainees yet'}</strong>
              {isFiltered
                ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
                : <span>An administrator can invite trainees from User Management.</span>}
            </div>
          )}

          {rows.length > 0 && (
            <div className={`table-wrap ${trainees.loading ? 'is-loading' : ''}`} aria-busy={trainees.loading}>
              <table className="table table--progress">
                <thead>
                  <tr>
                    <th>Trainee</th>
                    <th className="hide-sm">Department</th>
                    <th className="hide-sm">Plans</th>
                    <th>Avg. completion</th>
                    <th>Overdue</th>
                    <th className="hide-sm">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar">{initials(t.fullName)}</span>
                          <span className="user-cell__text">
                            <button type="button" className="table__link link-button" onClick={() => setOpen(t)}>
                              {t.fullName}
                            </button>
                            <span className="user-cell__email">{t.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="hide-sm">{t.department || '—'}</td>
                      <td className="hide-sm">{t.planCount}</td>
                      <td><ProgressBar value={t.avgCompletion} /></td>
                      <td>
                        {t.overdueCount > 0
                          ? <Badge tone="danger" dot>{plural(t.overdueCount, 'plan')}</Badge>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="hide-sm" title={t.lastActivityAt ? new Date(t.lastActivityAt).toLocaleString() : undefined}>
                        {timeAgo(t.lastActivityAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && <Pagination pagination={data.pagination} onPageChange={setPage} itemLabel="trainees" disabled={trainees.loading} />}
        </div>
      </section>

      {open && <TraineeProgressModal trainee={open} onClose={() => setOpen(null)} />}
    </>
  );
}
