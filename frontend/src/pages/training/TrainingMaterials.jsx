// Training Materials — Trainer and Admin side (FR7).
// Design: docs/designs/Training_material.png. That design is the trainee's
// view (progress, Resume); here the same card grid is used for managing:
// upload, edit, replace and delete materials. The trainee view is Phase 4c.
//
// Every course belongs to one training plan (GP1), so cards show their plan
// and its due date, and the plan filter replaces the design's categories.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import { deleteCourse, downloadMaterial } from '../../api/training';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import Menu from '../../components/Menu';
import Pagination from '../../components/Pagination';
import Select from '../../components/Select';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import useFetch from '../../hooks/useFetch';
import { formatDay, formatMinutes, plural } from '../../utils/format';
import PageHeader from '../PageHeader';
import CourseFormModal from './CourseFormModal';
import { MATERIAL_INFO, MATERIAL_TYPE_OPTIONS, materialType } from './trainingOptions';
import './training.css';

const PAGE_SIZE = 24;

export default function TrainingMaterials() {
  const [search, setSearch] = useState('');
  const [planId, setPlanId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  // null | { type: 'add' } | { type: 'edit' | 'delete', course }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const debouncedSearch = useDebouncedValue(search.trim());
  const params = { page, pageSize: PAGE_SIZE };
  if (debouncedSearch) params.search = debouncedSearch;
  if (planId) params.planId = planId;
  if (type) params.type = type;

  const courses = useFetch('/courses', params);
  const plans = useFetch('/plans', { pageSize: 100 });
  const planList = plans.data?.plans || [];

  const isFiltered = Boolean(debouncedSearch || planId || type);
  const clearFilters = () => { setSearch(''); setPlanId(''); setType(''); setPage(1); };
  const onFilter = (setter) => (event) => { setter(event.target.value); setPage(1); };

  const closeDialog = () => { setDialog(null); setActionError(null); };

  const download = async (course) => {
    setActionError(null);
    try {
      await downloadMaterial(course);
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteCourse(dialog.course.id);
      setNotice(`“${dialog.course.name}” was deleted.`);
      closeDialog();
      courses.reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const data = courses.data;
  const rows = data?.courses || [];

  return (
    <>
      <PageHeader
        eyebrow="Training Management"
        title="Training Materials"
        subtitle="Upload, update and remove the courses your trainees study."
        actions={(
          <>
            <Link to="/plans" className="btn btn--secondary"><Icon name="layers" size={16} /><span>Training plans</span></Link>
            <Button icon="plus" onClick={() => { setNotice(null); setDialog({ type: 'add' }); }}
              disabled={plans.data && planList.length === 0}>
              Add course
            </Button>
          </>
        )}
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
      {actionError && !dialog && <p className="inline-error page-alert" role="alert">{actionError}</p>}

      <section className="card panel">
        <div className="toolbar">
          <h2 className="panel__title toolbar__title">
            Courses
            {data && <span className="toolbar__meta">{plural(data.total, 'course')} in {plural(planList.length, 'plan')}</span>}
          </h2>
          <div className="toolbar__controls">
            <Input className="toolbar__search" icon="search" type="search" placeholder="Search course or plan…"
              aria-label="Search courses" value={search} onChange={onFilter(setSearch)} maxLength={100} />
          </div>
        </div>

        <div className="filters filters--materials">
          <Select label="Plan" value={planId} onChange={onFilter(setPlanId)} placeholder="All plans"
            options={planList.map((p) => ({ value: p.id, label: p.name }))} />
          <Select label="Material" value={type} onChange={onFilter(setType)} placeholder="All types"
            options={MATERIAL_TYPE_OPTIONS} />
          <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!isFiltered}>Clear filters</Button>
        </div>

        <div className="panel__body">
          {courses.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{courses.error}</span>
              <Button variant="secondary" size="sm" onClick={courses.reload}>Try again</Button>
            </div>
          )}
          {!data && !courses.error && <p className="loading-text">Loading courses…</p>}

          {data && rows.length === 0 && (
            isFiltered ? (
              <div className="empty-state">
                <strong>No courses match your filters</strong>
                <span>Try another plan or type, or clear the filters.</span>
                <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
              </div>
            ) : planList.length === 0 ? (
              <div className="empty-state">
                <strong>No training plans yet</strong>
                <span>Every course belongs to a plan. Create a plan first, then add its courses.</span>
                <Link to="/plans" className="btn btn--primary btn--sm"><span>Go to training plans</span></Link>
              </div>
            ) : (
              <div className="empty-state">
                <strong>No courses yet</strong>
                <span>Add the first course and upload its material.</span>
                <Button size="sm" icon="plus" onClick={() => setDialog({ type: 'add' })}>Add course</Button>
              </div>
            )
          )}

          {rows.length > 0 && (
            <div className={`material-grid ${courses.loading ? 'is-loading' : ''}`} aria-busy={courses.loading}>
              {rows.map((course) => (
                <MaterialCard
                  key={course.id}
                  course={course}
                  onDownload={() => download(course)}
                  onEdit={() => { setNotice(null); setDialog({ type: 'edit', course }); }}
                  onDelete={() => { setNotice(null); setDialog({ type: 'delete', course }); }}
                />
              ))}
            </div>
          )}

          {data && <Pagination pagination={data.pagination} onPageChange={setPage} itemLabel="courses" disabled={courses.loading} />}
        </div>
      </section>

      {(dialog?.type === 'add' || dialog?.type === 'edit') && (
        <CourseFormModal
          course={dialog.course}
          plans={planList}
          onClose={closeDialog}
          onSaved={(saved, isNew) => {
            setNotice(isNew ? `“${saved.name}” was added to ${saved.planName}.` : `“${saved.name}” was updated.`);
            closeDialog();
            courses.reload();
          }}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title={`Delete “${dialog?.course?.name}”?`}
        confirmLabel="Delete course"
        tone="danger"
        busy={busy}
        error={dialog?.type === 'delete' ? actionError : null}
        onConfirm={confirmDelete}
        onCancel={closeDialog}
      >
        The course is removed from {dialog?.course?.planName}
        {dialog?.course?.material?.type && dialog.course.material.type !== 'link' ? ' and its file is deleted' : ''}.
        Courses that trainees have already started cannot be deleted.
      </ConfirmDialog>
    </>
  );
}

function MaterialCard({ course, onDownload, onEdit, onDelete }) {
  const type = materialType(course);
  const info = MATERIAL_INFO[type];

  const menuItems = [
    { label: 'Edit course', icon: 'edit', onSelect: onEdit },
    { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: onDelete },
  ];

  let primary;
  if (type === 'link') {
    primary = (
      <a className="btn btn--ghost btn--sm" href={course.material.url} target="_blank" rel="noopener noreferrer">
        <span>Open link</span><Icon name="external" size={14} />
      </a>
    );
  } else if (type === 'none') {
    primary = <Button variant="ghost" size="sm" icon="upload" onClick={onEdit}>Add material</Button>;
  } else {
    primary = <Button variant="ghost" size="sm" icon="download" onClick={onDownload}>Download</Button>;
  }

  return (
    <article className="card material-card">
      <div className={`material-card__cover material-card__cover--${type}`}>
        <span className="material-card__plan">{course.planName}</span>
        <Icon name={info.icon} size={30} className="material-card__icon" />
        <span className="material-card__type">{info.label}</span>
      </div>
      <div className="material-card__body">
        <h3 className="material-card__title">{course.name}</h3>
        <p className="material-card__meta">
          <Icon name="clock" size={13} /> {formatMinutes(course.durationMinutes)}
          <span aria-hidden="true">·</span>
          Due {formatDay(course.planDueDate)}
        </p>
        <p className="material-card__meta">
          Course {course.position} of the plan · {course.assignedCount > 0
            ? `${plural(course.assignedCount, 'trainee')} assigned, ${course.startedCount} started`
            : 'not assigned yet'}
        </p>
      </div>
      <footer className="material-card__foot">
        {primary}
        <Menu label={`Actions for ${course.name}`} items={menuItems} />
      </footer>
    </article>
  );
}
