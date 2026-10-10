// Trainer landing page. Phase 2 shell only — cohort metrics, sentiment and
// knowledge-gap flags arrive in Phase 4b and Phase 7.
import { useAuth } from '../auth/useAuth';
import PageHeader from './PageHeader';

const STATS = ['Active Trainees', 'Avg. Completion', 'Feedback Sentiment', 'Knowledge Gaps Flagged'];

export default function TrainerOverview() {
  const { user } = useAuth();

  return (
    <>
      <PageHeader
        eyebrow="Trainer overview"
        title={`Welcome back, ${user.fullName.split(' ')[0]}.`}
        subtitle="Cohort health at a glance — who’s on track and who needs support."
      />

      <div className="stat-grid">
        {STATS.map((label) => (
          <div key={label} className="card stat-card">
            <p className="stat-card__label">{label}</p>
            <p className="stat-card__value stat-card__value--empty">—</p>
            <p className="stat-card__foot">Available in Phase 7</p>
          </div>
        ))}
      </div>

      <section className="card panel">
        <h2 className="panel__title">Cohort Progress</h2>
        <div className="panel__body empty-state">
          <strong>Trainee progress by plan</strong>
          <span className="phase-tag">Phase 4b</span>
        </div>
      </section>
    </>
  );
}
