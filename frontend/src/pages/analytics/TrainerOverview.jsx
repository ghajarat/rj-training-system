// Trainer Overview (Phase 7) — the Trainer's home page, /trainer.
// Design: docs/designs/Trainer_overview.png, with these differences:
//   - "Avg. Quiz Score" → Avg. Feedback Rating: there are no quizzes in the
//     schema (GP1). Knowledge gaps come from AI Assistant questions instead
//     of quiz misses (services/analytics.js explains how).
//   - Completion by Program shows the current completion only: progress has
//     no history, so there is no "previous quarter" to compare with.
//   - "Cohort report" opens the Cohort Progress report (Phase 8, FR17).
// All numbers come from GET /api/analytics/overview.
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import ProgressBar from '../../components/ProgressBar';
import SentimentGauge from '../../components/SentimentGauge';
import StatCard from '../../components/StatCard';
import useFetch from '../../hooks/useFetch';
import { formatDay, initials, plural, timeAgo } from '../../utils/format';
import PageHeader from '../PageHeader';
import { PROGRESS_STATUS, toneForStatus } from '../training/trainingOptions';
import '../dashboard.css';
import './analytics.css';

const SEVERITY = {
  high: { label: 'High', tone: 'danger' },
  medium: { label: 'Medium', tone: 'warning' },
  low: { label: 'Low', tone: 'neutral' },
};

function subtitleFor(summary, plans) {
  if (summary.activeTrainees === 0) return 'No trainees have been assigned a plan yet.';
  const running = plans.filter((p) => !p.upcoming).length;
  return `Monitoring ${plural(summary.activeTrainees, 'trainee')} across ${plural(running, 'active plan')}. `
    + (summary.atRisk > 0 ? `${summary.atRisk} need${summary.atRisk === 1 ? 's' : ''} attention.` : 'Everyone is on track.');
}

export default function TrainerOverview() {
  const { user } = useAuth();
  const { data, error, reload } = useFetch('/analytics/overview');
  const s = data?.summary;

  return (
    <>
      <PageHeader
        eyebrow="Trainer overview"
        title={`Welcome back, ${user.fullName.split(' ')[0]}.`}
        subtitle={data ? subtitleFor(s, data.plans) : 'Loading cohort health…'}
        actions={(
          <>
            <Link to="/reports?report=cohort-progress" className="btn btn--secondary">
              <Icon name="file" size={16} />
              <span>Cohort report</span>
            </Link>
            <Link to="/plans" className="btn btn--primary">
              <Icon name="plus" size={16} />
              <span>Assign a plan</span>
            </Link>
          </>
        )}
      />

      {error && (
        <div className="inline-error inline-error--row page-alert" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={reload}>Try again</Button>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Cohort Completion Rate" value={s && s.avgCompletion !== null ? `${s.avgCompletion}%` : null}
          foot={s && `${s.completedAssignments} of ${plural(s.assignments, 'plan assignment')} completed`} />
        <StatCard label="Active Trainees" value={s?.activeTrainees}
          foot={s && (s.newThisWeek > 0 ? `${s.newThisWeek} new this week` : 'No new trainees this week')}
          footTone={s?.newThisWeek > 0 ? 'success' : undefined} />
        <StatCard label="Avg. Feedback Rating" value={s?.avgRating} unit="/ 5"
          foot={s && (s.ratings ? `From ${plural(s.ratings, 'rating')}` : 'No ratings yet')} />
        <StatCard label="At-Risk Trainees" value={s?.atRisk} valueTone={s?.atRisk > 0 ? 'warning' : undefined}
          foot={s && (s.overdueTrainees > 0 ? `${s.overdueTrainees} with an overdue plan` : 'No overdue plans')}
          footTone={s?.overdueTrainees > 0 ? 'danger' : 'success'} />
      </div>

      <div className="dashboard-grid">
        <PlanCompletion data={data} />
        <FeedbackSentiment data={data} />
      </div>

      <div className="analytics-grid">
        <KnowledgeGaps data={data} />
        <NeedsAttention data={data} />
      </div>
    </>
  );
}

function Loading({ data, text = 'Loading…' }) {
  return !data ? <p className="loading-text">{text}</p> : null;
}

function PlanCompletion({ data }) {
  const plans = data?.plans;
  return (
    <section className="card panel dashboard-grid__main" aria-labelledby="completion-title">
      <h2 id="completion-title" className="panel__title">
        Completion by Plan
        <span className="toolbar__meta">average completion of assigned trainees</span>
      </h2>
      <div className="panel__body">
        <Loading data={data} />
        {plans?.length === 0 && (
          <div className="empty-state">
            <strong>No plans assigned yet</strong>
            <span>Assign a training plan to trainees to see its completion here.</span>
          </div>
        )}
        {plans?.length > 0 && (
          <ul className="bar-list">
            {plans.map((p) => (
              <li key={p.planId} className="bar-row">
                <div className="bar-row__name">
                  <Link to={`/plans/${p.planId}`} className="table__link">{p.planName}</Link>
                  <span className="table__sub">
                    {plural(p.assignedCount, 'trainee')} · {p.upcoming ? `Starts ${formatDay(p.startDate)}` : `Due ${formatDay(p.dueDate)}`}
                  </span>
                </div>
                <ProgressBar value={p.avgCompletion} label={`${p.planName} average completion`}
                  tone={p.overdueCount > 0 ? 'danger' : p.upcoming ? 'accent' : 'primary'} />
                <span className="bar-row__meta">
                  <span>{p.completedCount}/{p.assignedCount} done</span>
                  {p.overdueCount > 0 && <span className="text-danger">{p.overdueCount} overdue</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FeedbackSentiment({ data }) {
  const s = data?.sentiment;
  return (
    <section className="card panel dashboard-grid__side" aria-labelledby="sentiment-title">
      <h2 id="sentiment-title" className="panel__title">
        Feedback Sentiment
        {s && <span className="toolbar__meta">{plural(s.responses, 'comment')}</span>}
      </h2>
      <div className="panel__body">
        <Loading data={data} />
        {s && s.responses === 0 && (
          <div className="empty-state">
            <strong>No scored feedback yet</strong>
            <span>
              {s.pending > 0
                ? `${plural(s.pending, 'comment')} waiting for the AI to score.`
                : 'Trainees’ comments appear here once they rate a course.'}
            </span>
          </div>
        )}
        {s && s.responses > 0 && (
          <>
            <SentimentGauge score={s.score} />
            <div className="sentiment-split">
              <div><strong className="text-success">{s.positivePct}%</strong><span>Positive</span></div>
              <div><strong>{s.neutralPct}%</strong><span>Neutral</span></div>
              <div><strong className="text-danger">{s.negativePct}%</strong><span>Negative</span></div>
            </div>
            <div className="sentiment-notes">
              {s.lowestRated && (
                <p><strong>Needs attention:</strong> {s.lowestRated.courseName} ({s.lowestRated.avgRating}★ from {plural(s.lowestRated.ratings, 'rating')}).</p>
              )}
              {s.highestRated && (
                <p><strong>Best rated:</strong> {s.highestRated.courseName} ({s.highestRated.avgRating}★).</p>
              )}
              {s.pending > 0 && <p className="text-muted">{plural(s.pending, 'newer comment')} still waiting for the AI.</p>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function KnowledgeGaps({ data }) {
  const k = data?.knowledgeGaps;
  return (
    <section className="card panel" aria-labelledby="gaps-title">
      <h2 id="gaps-title" className="panel__title gaps__title">
        <Icon name="alert" size={16} className="text-warning" />
        Knowledge Gaps
        {k && <span className="toolbar__meta">from AI Assistant questions, last {k.windowDays} days</span>}
      </h2>
      <div className="panel__body">
        <Loading data={data} />
        {k?.gaps.length === 0 && (
          <div className="empty-state">
            <strong>No knowledge gaps flagged</strong>
            <span>A course is flagged when several of its trainees ask the AI Assistant about it.</span>
          </div>
        )}
        {k?.gaps.length > 0 && (
          <ul className="gap-list">
            {k.gaps.map((g) => {
              const severity = SEVERITY[g.severity];
              return (
                <li key={g.courseId} className="gap-row">
                  <div className="gap-row__text">
                    <span className="gap-row__name">{g.courseName}</span>
                    <span className="table__sub">
                      {g.topSource
                        ? `Most cited: ${g.topSource.section || g.topSource.title}`
                        : 'The SOP library had no answer'}
                      {' · '}{g.traineesAsked} of {plural(g.traineesAssigned, 'trainee')} asked
                      {g.unanswered > 0 && `, ${g.unanswered} unanswered`}
                    </span>
                  </div>
                  <div className="gap-row__metric">
                    <strong className={`text-${severity.tone === 'neutral' ? 'muted' : severity.tone}`}>
                      {g.askRatePct ?? '—'}%
                    </strong>
                    <span>asked</span>
                  </div>
                  <Badge tone={severity.tone} dot>{severity.label}</Badge>
                  <Link to={`/plans/${g.planId}`} className="btn btn--secondary btn--sm">Review</Link>
                </li>
              );
            })}
          </ul>
        )}
        {k?.unansweredQuestions > 0 && (
          <p className="panel__note">
            {plural(k.unansweredQuestions, 'question')} in the last {k.windowDays} days had no answer in the SOP library.
          </p>
        )}
      </div>
    </section>
  );
}

function NeedsAttention({ data }) {
  const rows = data?.trainees;
  return (
    <section className="card panel" aria-labelledby="attention-title">
      <div className="dashboard-panel__head">
        <h2 id="attention-title" className="panel__title">Trainee Progress</h2>
        <Link to="/trainees" className="link-arrow">View all <Icon name="arrowRight" size={14} /></Link>
      </div>
      <div className="panel__body">
        <Loading data={data} />
        {rows?.length === 0 && (
          <div className="empty-state">
            <strong>Nothing open right now</strong>
            <span>Trainees with unfinished plans appear here, the most urgent first.</span>
          </div>
        )}
        {rows?.length > 0 && (
          <div className="table-wrap">
            <table className="table table--attention">
              <thead>
                <tr>
                  <th>Trainee · plan</th>
                  <th>Progress</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const status = t.atRisk && t.status !== 'overdue'
                    ? { label: 'Behind', tone: 'warning' }
                    : PROGRESS_STATUS[t.status];
                  return (
                    <tr key={t.traineeId}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar">{initials(t.fullName)}</span>
                          <span className="user-cell__text">
                            <span className="table__link">{t.fullName}</span>
                            <span className="user-cell__email">
                              {t.planName} · active {timeAgo(t.lastActivityAt).toLowerCase()}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td><ProgressBar value={t.completionPct} tone={toneForStatus(t.status)} /></td>
                      <td><Badge tone={status.tone} dot>{status.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
