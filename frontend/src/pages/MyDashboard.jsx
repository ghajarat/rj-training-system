// Trainee landing page: My Dashboard (FR4, FR5).
// Design: docs/designs/Trainee_dashboard.png, with the Phase 4c decisions:
//   - Stat cards show what the data supports: overall progress, courses
//     completed, training hours (length of finished courses), next due date.
//     The design's Certifications and AI-query cards have no data source.
//   - "Up Next" (live sessions, not in the schema) becomes Upcoming due dates.
//   - Schedule, Achievements and Recent Activity are left out (Phase 4a
//     decision / not in any requirement).
//   - "Suggested by your AI Assistant" is an empty, clearly marked Phase 6 slot.
// All numbers come from GET /api/me/plans (services/progress.js), the same
// definitions trainers see on My Trainees.
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Icon from '../components/Icon';
import ProgressBar from '../components/ProgressBar';
import { dueLabel, formatDay, formatMinutes, plural } from '../utils/format';
import PageHeader from './PageHeader';
import { planStatusFor, toneForStatus } from './training/trainingOptions';
import useMyTraining, { nextCourse } from './training/useMyTraining';
import './dashboard.css';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// "You have 3 active learning paths. Cabin Safety is due in 6 days."
function headline(summary) {
  if (summary.planCount === 0) return 'No training has been assigned to you yet.';
  if (summary.openPlanCount === 0) return 'You have finished all your training plans. Well done.';
  const next = summary.nextDue;
  // dueLabel: "Due in 6 days" / "Overdue by 2 days" → "... is due in 6 days."
  return `You have ${plural(summary.openPlanCount, 'active learning path')}. `
    + `${next.planName} is ${dueLabel(next.dueDate).toLowerCase()}.`;
}

// Short line under a plan's name: where the trainee is in it.
function planPosition(plan) {
  if (plan.totalCourses === 0) return 'No courses yet';
  if (plan.status === 'completed') return `All ${plural(plan.totalCourses, 'course')} completed`;
  if (plan.upcoming && plan.status === 'not_started') return `Starts ${formatDay(plan.startDate)}`;
  const next = plan.courses.find((c) => c.status !== 'completed');
  return `Course ${next.position} of ${plan.totalCourses} · ${next.name}`;
}

export default function MyDashboard() {
  const { user } = useAuth();
  const firstName = user.fullName.split(' ')[0];
  const training = useMyTraining();
  const data = training.data;
  const summary = data?.summary;
  const up = data ? nextCourse(data.plans) : null;

  // Open plans first (by due date, as sent), then finished ones.
  const plans = data
    ? [...data.plans.filter((p) => p.status !== 'completed'), ...data.plans.filter((p) => p.status === 'completed')]
    : [];
  const dueSoon = plans.filter((p) => p.status !== 'completed').slice(0, 4);

  return (
    <>
      <PageHeader
        eyebrow="My training"
        title={`${greeting()}, ${firstName}.`}
        subtitle={summary ? headline(summary) : 'Loading your training…'}
        actions={up && (
          <Link to={`/materials?course=${up.course.id}`} className="btn btn--primary">
            <Icon name="play" size={16} />
            <span>{up.course.status === 'not_started' ? 'Start next course' : 'Resume course'}</span>
          </Link>
        )}
      />

      {training.error && (
        <div className="inline-error inline-error--row page-alert" role="alert">
          <span>{training.error}</span>
          <Button variant="secondary" size="sm" onClick={training.reload}>Try again</Button>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Overall progress" icon="chart"
          value={summary?.overallPct != null ? `${summary.overallPct}%` : null}
          foot={summary && plural(summary.planCount, 'plan') + ' assigned'} />
        <StatCard label="Courses completed" icon="check"
          value={summary && summary.totalCourses > 0 ? summary.completedCourses : null}
          unit={summary?.totalCourses ? `/ ${summary.totalCourses}` : null}
          foot={summary && (summary.totalCourses - summary.completedCourses === 0 && summary.totalCourses > 0
            ? 'All done'
            : `${summary.totalCourses - summary.completedCourses} to go`)} />
        <StatCard label="Training time completed" icon="clock"
          value={summary ? (summary.completedMinutes ? formatMinutes(summary.completedMinutes) : '0h') : null}
          foot={summary && 'From finished courses'} />
        <StatCard label="Next due" icon="calendar" small
          value={summary?.nextDue ? formatDay(summary.nextDue.dueDate) : null}
          foot={summary && (summary.nextDue ? summary.nextDue.planName : 'Nothing due')}
          footTone={summary?.nextDue?.overdue ? 'danger' : undefined} />
      </div>

      <div className="dashboard-grid">
        <section className="card panel dashboard-grid__main" aria-labelledby="paths-title">
          <div className="dashboard-panel__head">
            <h2 id="paths-title" className="panel__title">
              Active Learning Paths
              {summary && <span className="toolbar__meta">{summary.openPlanCount} in progress</span>}
            </h2>
            <Link to="/materials" className="link-arrow">View all <Icon name="arrowRight" size={14} /></Link>
          </div>

          <div className="panel__body">
            {!data && !training.error && <p className="loading-text">Loading your plans…</p>}
            {data && plans.length === 0 && (
              <div className="empty-state">
                <strong>No training assigned yet</strong>
                <span>When a trainer assigns you a training plan, it appears here with your progress.</span>
              </div>
            )}
            {plans.length > 0 && (
              <ul className="path-list">
                {plans.map((plan) => {
                  const status = planStatusFor(plan);
                  return (
                    <li key={plan.planId} className="path-row">
                      <div className="path-row__name">
                        <Link to={`/materials?plan=${plan.planId}`} className="table__link">{plan.planName}</Link>
                        <span className="table__sub">{planPosition(plan)}</span>
                      </div>
                      <div className="path-row__progress">
                        <ProgressBar value={plan.completionPct} tone={toneForStatus(plan.status)}
                          label={`${plan.planName} completion`} />
                      </div>
                      <Badge tone={status.tone} dot>{status.label}</Badge>
                      <span className="path-row__due">{formatDay(plan.dueDate)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="card panel dashboard-grid__side" aria-labelledby="due-title">
          <h2 id="due-title" className="panel__title">Upcoming due dates</h2>
          <div className="panel__body">
            {!data && !training.error && <p className="loading-text">Loading…</p>}
            {data && dueSoon.length === 0 && (
              <div className="empty-state">
                <strong>Nothing due</strong>
                <span>{plans.length ? 'Every plan is complete.' : 'No plans assigned.'}</span>
              </div>
            )}
            {dueSoon.length > 0 && (
              <ul className="due-list">
                {dueSoon.map((plan) => <DueItem key={plan.planId} plan={plan} />)}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Phase 6 slot: personalised suggestions from the AI Assistant. Kept empty on purpose. */}
      <section className="card panel ai-slot" aria-labelledby="ai-title">
        <h2 id="ai-title" className="panel__title">Suggested by your AI Assistant</h2>
        <div className="panel__body empty-state">
          <strong>Personalised recommendations will appear here</strong>
          <span>Based on your plans and progress, once the AI Assistant is connected.</span>
          <span className="phase-tag">Phase 6</span>
        </div>
      </section>
    </>
  );
}

function StatCard({ label, icon, value, unit, foot, footTone, small = false }) {
  const empty = value === null || value === undefined;
  return (
    <div className="card stat-card">
      <p className="stat-card__label stat-card__label--icon">
        {label}
        <Icon name={icon} size={18} className="stat-card__icon" />
      </p>
      <p className={`stat-card__value ${small ? 'stat-card__value--sm' : ''} ${empty ? 'stat-card__value--empty' : ''}`}>
        {empty ? '—' : value}
        {!empty && unit && <span className="stat-card__unit"> {unit}</span>}
      </p>
      <p className={`stat-card__foot ${footTone ? `text-${footTone}` : ''}`}>{foot || ' '}</p>
    </div>
  );
}

function DueItem({ plan }) {
  const [, month, day] = plan.dueDate.split('-').map(Number);
  const monthName = new Date(2000, month - 1, 1).toLocaleString('en-GB', { month: 'short' });
  return (
    <li className="due-item">
      <span className={`due-item__date ${plan.overdue ? 'is-overdue' : ''}`} aria-hidden="true">
        <span className="due-item__month">{monthName}</span>
        <span className="due-item__day">{String(day).padStart(2, '0')}</span>
      </span>
      <div className="due-item__text">
        <Link to={`/materials?plan=${plan.planId}`} className="table__link">{plan.planName}</Link>
        <span className={`table__sub ${plan.overdue ? 'text-danger' : ''}`}>
          {dueLabel(plan.dueDate)} · {plan.completionPct}% complete
        </span>
      </div>
    </li>
  );
}
