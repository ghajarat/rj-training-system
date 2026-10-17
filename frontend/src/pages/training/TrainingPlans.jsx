// Training Plans — list of plans with their progress totals (FR8, FR9).
// A plan is an ordered list of courses with a due date. Opening a plan shows
// its courses (the plan builder), assignments and per-trainee progress.
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import Pagination from '../../components/Pagination';
import ProgressBar from '../../components/ProgressBar';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import useFetch from '../../hooks/useFetch';
import { formatDay, formatMinutes, plural } from '../../utils/format';
import PageHeader from '../PageHeader';
import PlanFormModal from './PlanFormModal';
import './training.css';

export default function TrainingPlans() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  // e.g. "Plan deleted", passed from the plan page
  const [notice, setNotice] = useState(location.state?.notice || null);

  const debouncedSearch = useDebouncedValue(search.trim());
  const params = { page };
  if (debouncedSearch) params.search = debouncedSearch;
  const plans = useFetch('/plans', params);

  const data = plans.data;
  const rows = data?.plans || [];

  return (
    <>
      <PageHeader
        eyebrow="Training Management"
        title="Training Plans"
        subtitle="Build ordered course plans with a due date, assign them, and follow progress."
        actions={<Button icon="plus" onClick={() => setCreating(true)}>New plan</Button>}
      />

      {notice && (
        <div className="inline-success" role="status">
          <Icon name="check" size={16} />
          <span>{notice}</span>
          <button type="button" className="inline-success__close" onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <section className="card panel">
        <div className="toolbar">
          <h2 className="panel__title toolbar__title">
            Plans
            {data && <span className="toolbar__meta">{plural(data.pagination.total, 'plan')}</span>}
          </h2>
          <div className="toolbar__controls">
            <Input className="toolbar__search" icon="search" type="search" placeholder="Search plans…"
              aria-label="Search plans" value={search} maxLength={100}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        <div className="panel__body">
          {plans.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{plans.error}</span>
              <Button variant="secondary" size="sm" onClick={plans.reload}>Try again</Button>
            </div>
          )}
          {!data && !plans.error && <p className="loading-text">Loading plans…</p>}

          {data && rows.length === 0 && (
            debouncedSearch ? (
              <div className="empty-state">
                <strong>No plans match “{debouncedSearch}”</strong>
                <Button variant="secondary" size="sm" onClick={() => setSearch('')}>Clear search</Button>
              </div>
            ) : (
              <div className="empty-state">
                <strong>No training plans yet</strong>
                <span>Create a plan, add its courses, then assign it to trainees or a department.</span>
                <Button size="sm" icon="plus" onClick={() => setCreating(true)}>New plan</Button>
              </div>
            )
          )}

          {rows.length > 0 && (
            <div className={`table-wrap ${plans.loading ? 'is-loading' : ''}`} aria-busy={plans.loading}>
              <table className="table table--plans">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Due</th>
                    <th className="hide-sm">Courses</th>
                    <th className="hide-sm">Assigned</th>
                    <th>Avg. completion</th>
                    <th className="hide-sm">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/plans/${p.id}`} className="table__link">{p.name}</Link>
                        {p.createdBy && <small className="table__sub">by {p.createdBy.fullName}</small>}
                      </td>
                      <td>
                        {formatDay(p.dueDate)}
                        {p.pastDue && <small className="table__sub">Due date passed</small>}
                      </td>
                      <td className="hide-sm">
                        {p.courseCount}
                        {p.totalMinutes > 0 && <small className="table__sub">{formatMinutes(p.totalMinutes)}</small>}
                      </td>
                      <td className="hide-sm">{p.assignedCount}</td>
                      <td><ProgressBar value={p.avgCompletion} /></td>
                      <td className="hide-sm">
                        {p.overdueCount > 0
                          ? <Badge tone="danger" dot>{p.overdueCount}</Badge>
                          : <span className="text-muted">0</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && <Pagination pagination={data.pagination} onPageChange={setPage} itemLabel="plans" disabled={plans.loading} />}
        </div>
      </section>

      {creating && (
        <PlanFormModal
          onClose={() => setCreating(false)}
          onSaved={(plan) => navigate(`/plans/${plan.id}`, { state: { notice: `“${plan.name}” was created. Add its courses next.` } })}
        />
      )}
    </>
  );
}
