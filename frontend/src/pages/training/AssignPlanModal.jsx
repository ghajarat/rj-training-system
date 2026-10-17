// Assign a plan to trainees, or to a whole department (FR8).
// Departments are the "groups" of FR8. Already-assigned trainees are shown
// ticked and cannot be picked again; the backend also skips duplicates.
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { assignPlan } from '../../api/training';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import useFetch from '../../hooks/useFetch';
import { plural } from '../../utils/format';

export default function AssignPlanModal({ plan, onClose, onAssigned }) {
  const [tab, setTab] = useState('trainees');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [departmentId, setDepartmentId] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const debouncedSearch = useDebouncedValue(search.trim());
  const params = { planId: plan.id, pageSize: 100 };
  if (debouncedSearch) params.search = debouncedSearch;
  const trainees = useFetch(tab === 'trainees' ? '/trainees' : null, params);
  const departments = useFetch('/departments');

  const list = trainees.data?.trainees || [];
  const more = trainees.data ? trainees.data.pagination.total - list.length : 0;

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setError(null);
  };

  const canSubmit = !plan.pastDue && (tab === 'trainees' ? selected.size > 0 : Boolean(departmentId));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) {
      setError(tab === 'trainees' ? 'Tick at least one trainee.' : 'Choose a department.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = tab === 'trainees' ? { traineeIds: [...selected] } : { departmentId };
      onAssigned(await assignPlan(plan.id, body));
    } catch (err) {
      setError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`Assign “${plan.name}”`}
      description="Pick individual trainees, or a department to assign all of its active trainees."
      onClose={onClose}
      busy={saving}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="assign-form" icon="users" loading={saving} disabled={plan.pastDue}>
            {tab === 'trainees' && selected.size > 0 ? `Assign ${plural(selected.size, 'trainee')}` : 'Assign'}
          </Button>
        </>
      )}
    >
      <form id="assign-form" className="modal-form" onSubmit={handleSubmit} noValidate>
        {plan.pastDue && (
          <p className="inline-error" role="alert">
            This plan’s due date has passed. Edit the plan and move the due date before assigning anyone.
          </p>
        )}
        {!plan.pastDue && plan.courseCount === 0 && (
          <p className="field__hint">This plan has no courses yet. Trainees will see it once you add some.</p>
        )}

        <div className="segmented" role="tablist" aria-label="Assign to">
          {[['trainees', 'Trainees'], ['department', 'Department']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value}
              className={`segmented__item ${tab === value ? 'is-on' : ''}`}
              onClick={() => { setTab(value); setError(null); }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'trainees' ? (
          <>
            <Input icon="search" type="search" placeholder="Search name or email…" aria-label="Search trainees"
              value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />

            {trainees.error && <p className="inline-error" role="alert">{trainees.error}</p>}
            {!trainees.data && !trainees.error && <p className="loading-text">Loading trainees…</p>}
            {trainees.data && list.length === 0 && (
              <div className="empty-state">
                <strong>{debouncedSearch ? 'No trainees match your search' : 'No active trainees yet'}</strong>
                {!debouncedSearch && <span>An administrator can invite trainees from User Management.</span>}
              </div>
            )}

            {list.length > 0 && (
              <ul className={`pick-list ${trainees.loading ? 'is-loading' : ''}`}>
                {list.map((t) => (
                  <li key={t.id}>
                    <label className={`pick-list__item ${t.assignedToPlan ? 'is-disabled' : ''}`}>
                      <input type="checkbox" checked={t.assignedToPlan || selected.has(t.id)}
                        disabled={t.assignedToPlan || saving} onChange={() => toggle(t.id)} />
                      <span className="pick-list__text">
                        <strong>{t.fullName}</strong>
                        <small>{t.department || 'No department'} · {t.email}</small>
                      </span>
                      {t.assignedToPlan && <Badge tone="success">Assigned</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {more > 0 && <p className="field__hint">{plural(more, 'more trainee')} not shown. Search to narrow the list.</p>}
          </>
        ) : (
          <Select label="Department" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setError(null); }}
            placeholder={departments.data ? 'Choose a department' : 'Loading…'}
            options={(departments.data?.departments || []).map((d) => ({ value: d.id, label: d.name }))}
            error={departments.error}
            hint="Everyone in it who is an active trainee right now. People who join the department later are not added automatically." />
        )}

        {error && <p className="inline-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
