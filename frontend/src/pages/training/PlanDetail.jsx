// One training plan: the plan builder and its progress (FR7, FR8, FR9).
//
//   Courses   add, edit, delete and reorder (up / down buttons rather than
//             drag-and-drop, so it works by keyboard and on a phone, NFR10)
//   Assign    trainees or a whole department
//   Progress  per trainee: completion, last activity, overdue (FR9). The same
//             numbers come from GET /api/plans/:id/progress, which Phase 7's
//             Trainer Overview can reuse.
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import {
  deleteCourse, deletePlan, downloadMaterial, reorderCourses, unassignTrainee,
} from '../../api/training';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Icon from '../../components/Icon';
import Menu from '../../components/Menu';
import ProgressBar from '../../components/ProgressBar';
import useFetch from '../../hooks/useFetch';
import { formatDay, formatMinutes, initials, plural, timeAgo } from '../../utils/format';
import PageHeader from '../PageHeader';
import AssignPlanModal from './AssignPlanModal';
import CourseFormModal from './CourseFormModal';
import PlanFormModal from './PlanFormModal';
import {
  MATERIAL_INFO, PROGRESS_STATUS, materialType, toneForStatus,
} from './trainingOptions';
import './training.css';

export default function PlanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const detail = useFetch(`/plans/${id}`);
  const progress = useFetch(`/plans/${id}/progress`);

  // null | { type: 'editPlan' | 'deletePlan' | 'addCourse' | 'assign' }
  //      | { type: 'editCourse' | 'deleteCourse', course } | { type: 'unassign', trainee }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(location.state?.notice || null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  // A reorder shows the new order straight away. The override remembers which
  // response it was based on, so it stops applying as soon as the reloaded
  // plan arrives (no flash of the old order in between).
  const [orderOverride, setOrderOverride] = useState(null);   // { base, courses }
  const [reordering, setReordering] = useState(false);

  const plan = detail.data?.plan;
  const courses = orderOverride && orderOverride.base === detail.data
    ? orderOverride.courses
    : detail.data?.courses || [];

  const reloadAll = () => { detail.reload(); progress.reload(); };
  const closeDialog = () => { setDialog(null); setActionError(null); };
  const done = (message) => { setNotice(message); closeDialog(); reloadAll(); };

  // Runs a dialog's confirm action with busy + error handling.
  const run = async (action, message) => {
    setBusy(true);
    try {
      await action();
      done(message);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const move = async (index, delta) => {
    const next = [...courses];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    const base = detail.data;
    setOrderOverride({ base, courses: next });
    setReordering(true);
    setActionError(null);
    try {
      const result = await reorderCourses(id, next.map((c) => c.id));
      setOrderOverride({ base, courses: result.courses });
      detail.reload();
    } catch (err) {
      setOrderOverride(null);
      setActionError(getErrorMessage(err));
    } finally {
      setReordering(false);
    }
  };

  const download = async (course) => {
    setActionError(null);
    try {
      await downloadMaterial(course);
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  };

  // ---- Loading / error -------------------------------------------------
  if (!plan) {
    return (
      <>
        <Link to="/plans" className="back-link"><Icon name="chevronLeft" size={14} />All plans</Link>
        {detail.error ? (
          <div className="inline-error inline-error--row" role="alert">
            <span>{detail.error}</span>
            <Button variant="secondary" size="sm" onClick={detail.reload}>Try again</Button>
          </div>
        ) : <p className="loading-text">Loading plan…</p>}
      </>
    );
  }

  const summary = progress.data?.summary;
  const trainees = progress.data?.trainees || [];

  return (
    <>
      <Link to="/plans" className="back-link"><Icon name="chevronLeft" size={14} />All plans</Link>
      <PageHeader
        eyebrow="Training Plan"
        title={plan.name}
        subtitle={plan.description}
        actions={(
          <>
            <Button variant="secondary" icon="edit" onClick={() => setDialog({ type: 'editPlan' })}>Edit details</Button>
            <Button icon="users" onClick={() => { setNotice(null); setDialog({ type: 'assign' }); }}>Assign</Button>
            <Menu label="More plan actions" items={[
              { label: 'Delete plan', icon: 'trash', tone: 'danger', onSelect: () => setDialog({ type: 'deletePlan' }) },
            ]} />
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

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-card__label">Due date</div>
          <div className="stat-card__value stat-card__value--sm">{formatDay(plan.dueDate)}</div>
          <div className="stat-card__foot">
            {plan.pastDue ? <Badge tone="danger">Due date passed</Badge> : `Started ${formatDay(plan.startDate)}`}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-card__label">Courses</div>
          <div className="stat-card__value">{plan.courseCount}</div>
          <div className="stat-card__foot">{plan.totalMinutes ? `${formatMinutes(plan.totalMinutes)} in total` : 'No durations set'}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-card__label">Assigned trainees</div>
          <div className="stat-card__value">{plan.assignedCount}</div>
          <div className="stat-card__foot">{plural(plan.completedCount, 'has', 'have')} completed it</div>
        </div>
        <div className="card stat-card">
          <div className="stat-card__label">Average completion</div>
          <div className={`stat-card__value ${plan.avgCompletion === null ? 'stat-card__value--empty' : ''}`}>
            {plan.avgCompletion === null ? '—' : `${plan.avgCompletion}%`}
          </div>
          <div className="stat-card__foot">
            {plan.overdueCount > 0
              ? <span className="text-danger">{plural(plan.overdueCount, 'trainee')} overdue</span>
              : 'Nobody overdue'}
          </div>
        </div>
      </div>

      {/* ---- Courses (plan builder) ---- */}
      <section className="card panel">
        <div className="toolbar">
          <h2 className="panel__title toolbar__title">
            Courses <span className="toolbar__meta">taken in this order</span>
          </h2>
          <Button size="sm" icon="plus" onClick={() => { setNotice(null); setDialog({ type: 'addCourse' }); }}>Add course</Button>
        </div>
        <div className="panel__body">
          {courses.length === 0 ? (
            <div className="empty-state">
              <strong>No courses in this plan yet</strong>
              <span>Add the first course and upload its material (PDF, Word, PowerPoint, video or a link).</span>
              <Button size="sm" icon="plus" onClick={() => setDialog({ type: 'addCourse' })}>Add course</Button>
            </div>
          ) : (
            <ol className={`course-list ${reordering ? 'is-loading' : ''}`}>
              {courses.map((course, index) => {
                const info = MATERIAL_INFO[materialType(course)];
                const menuItems = [{ label: 'Edit course', icon: 'edit', onSelect: () => setDialog({ type: 'editCourse', course }) }];
                if (course.material && course.material.type !== 'link') {
                  menuItems.push({ label: 'Download material', icon: 'download', onSelect: () => download(course) });
                }
                menuItems.push({ label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => setDialog({ type: 'deleteCourse', course }) });
                return (
                  <li key={course.id} className="course-row">
                    <span className="course-row__pos">{index + 1}</span>
                    <span className="course-row__main">
                      <strong>{course.name}</strong>
                      <small>
                        <Icon name={info.icon} size={13} /> {info.label}
                        {course.material?.type === 'link' && (
                          <> · <a href={course.material.url} target="_blank" rel="noopener noreferrer">Open link</a></>
                        )}
                        {' · '}{formatMinutes(course.durationMinutes)}
                      </small>
                    </span>
                    <span className="course-row__actions">
                      <button type="button" className="icon-button" onClick={() => move(index, -1)}
                        disabled={index === 0 || reordering} aria-label={`Move ${course.name} up`} title="Move up">
                        <Icon name="arrowUp" size={15} />
                      </button>
                      <button type="button" className="icon-button" onClick={() => move(index, 1)}
                        disabled={index === courses.length - 1 || reordering} aria-label={`Move ${course.name} down`} title="Move down">
                        <Icon name="arrowDown" size={15} />
                      </button>
                      <Menu label={`Actions for ${course.name}`} items={menuItems} />
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      {/* ---- Progress (FR9) ---- */}
      <section className="card panel">
        <div className="toolbar">
          <h2 className="panel__title toolbar__title">
            Trainee progress
            {summary && summary.assignedCount > 0 && (
              <span className="toolbar__meta">
                {summary.completedCount} completed · {summary.notStartedCount} not started · {summary.overdueCount} overdue
              </span>
            )}
          </h2>
        </div>
        <div className="panel__body">
          {progress.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{progress.error}</span>
              <Button variant="secondary" size="sm" onClick={progress.reload}>Try again</Button>
            </div>
          )}
          {!progress.data && !progress.error && <p className="loading-text">Loading progress…</p>}

          {progress.data && trainees.length === 0 && (
            <div className="empty-state">
              <strong>Nobody is assigned to this plan yet</strong>
              <span>Assign it to individual trainees or to a whole department.</span>
              <Button size="sm" icon="users" onClick={() => setDialog({ type: 'assign' })}>Assign</Button>
            </div>
          )}

          {trainees.length > 0 && (
            <div className={`table-wrap ${progress.loading ? 'is-loading' : ''}`}>
              <table className="table table--progress">
                <thead>
                  <tr>
                    <th>Trainee</th>
                    <th className="hide-sm">Department</th>
                    <th>Progress</th>
                    <th className="hide-sm">Courses done</th>
                    <th className="hide-sm">Last activity</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {trainees.map((t) => {
                    const status = PROGRESS_STATUS[t.status];
                    return (
                      <tr key={t.id}>
                        <td>
                          <div className="user-cell">
                            <span className="avatar">{initials(t.fullName)}</span>
                            <span className="user-cell__text">
                              <span className="table__name">{t.fullName}</span>
                              <span className="user-cell__email">{t.email}</span>
                            </span>
                          </div>
                        </td>
                        <td className="hide-sm">{t.department || '—'}</td>
                        <td><ProgressBar value={t.completionPct} tone={toneForStatus(t.status)} /></td>
                        <td className="hide-sm">{t.completedCourses} / {t.totalCourses}</td>
                        <td className="hide-sm" title={t.lastActivityAt ? new Date(t.lastActivityAt).toLocaleString() : undefined}>
                          {timeAgo(t.lastActivityAt)}
                        </td>
                        <td><Badge tone={status.tone} dot>{status.label}</Badge></td>
                        <td className="table__actions">
                          <Menu label={`Actions for ${t.fullName}`} items={[
                            { label: 'Unassign', icon: 'userOff', tone: 'danger', onSelect: () => setDialog({ type: 'unassign', trainee: t }) },
                          ]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---- Dialogs ---- */}
      {dialog?.type === 'editPlan' && (
        <PlanFormModal plan={plan} onClose={closeDialog} onSaved={(saved) => done(`“${saved.name}” was updated.`)} />
      )}

      {(dialog?.type === 'addCourse' || dialog?.type === 'editCourse') && (
        <CourseFormModal
          course={dialog.course}
          fixedPlan={plan}
          onClose={closeDialog}
          onSaved={(saved, isNew) => done(isNew ? `“${saved.name}” was added.` : `“${saved.name}” was updated.`)}
        />
      )}

      {dialog?.type === 'assign' && (
        <AssignPlanModal
          plan={plan}
          onClose={closeDialog}
          onAssigned={({ assigned, alreadyAssigned }) => done(
            assigned.length === 0
              ? `Everyone you picked was already assigned (${alreadyAssigned.length}).`
              : `Assigned ${plural(assigned.length, 'trainee')}${alreadyAssigned.length ? ` · ${alreadyAssigned.length} already had this plan` : ''}.`,
          )}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'deleteCourse'}
        title={`Delete “${dialog?.course?.name}”?`}
        confirmLabel="Delete course"
        tone="danger"
        busy={busy}
        error={dialog?.type === 'deleteCourse' ? actionError : null}
        onConfirm={() => run(() => deleteCourse(dialog.course.id), `“${dialog.course.name}” was deleted.`)}
        onCancel={closeDialog}
      >
        The course and its material are removed from this plan. Courses that trainees have already started cannot be deleted.
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'unassign'}
        title={`Unassign ${dialog?.trainee?.fullName}?`}
        confirmLabel="Unassign"
        tone="danger"
        busy={busy}
        error={dialog?.type === 'unassign' ? actionError : null}
        onConfirm={() => run(() => unassignTrainee(id, dialog.trainee.id), `${dialog.trainee.fullName} was unassigned.`)}
        onCancel={closeDialog}
      >
        The plan disappears from their dashboard. Their progress is kept, so assigning them again picks up where they left off.
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'deletePlan'}
        title={`Delete “${plan.name}”?`}
        confirmLabel="Delete plan"
        tone="danger"
        busy={busy}
        error={dialog?.type === 'deletePlan' ? actionError : null}
        onConfirm={async () => {
          setBusy(true);
          try {
            await deletePlan(id);
            navigate('/plans', { replace: true, state: { notice: `“${plan.name}” was deleted.` } });
          } catch (err) {
            setActionError(getErrorMessage(err));
            setBusy(false);
          }
        }}
        onCancel={closeDialog}
      >
        {plural(plan.courseCount, 'course')} and their files are deleted too. A plan can only be deleted when nobody is assigned and no one has started its courses.
      </ConfirmDialog>
    </>
  );
}
