// Trainee landing page (GP1 Fig. 29). Phase 2 shell only — the cards are
// wired to real data in Phase 4c (plans, progress) and Phase 6 (AI suggestions).
import { useAuth } from '../auth/useAuth';
import PageHeader from './PageHeader';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const STATS = ['Overall Progress', 'Hours This Quarter', 'Certifications', 'AI Assistant Queries'];

export default function MyDashboard() {
  const { user } = useAuth();
  const firstName = user.fullName.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow="My training"
        title={`${greeting()}, ${firstName}.`}
        subtitle="Your learning paths, progress and next steps will appear here."
      />

      <div className="stat-grid">
        {STATS.map((label) => (
          <div key={label} className="card stat-card">
            <p className="stat-card__label">{label}</p>
            <p className="stat-card__value stat-card__value--empty">—</p>
            <p className="stat-card__foot">Available in Phase 4c</p>
          </div>
        ))}
      </div>

      <section className="card panel">
        <h2 className="panel__title">Active Learning Paths</h2>
        <div className="panel__body empty-state">
          <strong>Assigned plans load here</strong>
          <span className="phase-tag">Phase 4c</span>
        </div>
      </section>

      <section className="card panel">
        <h2 className="panel__title">Suggested by your AI Assistant</h2>
        <div className="panel__body empty-state">
          <strong>Personalised recommendations</strong>
          <span className="phase-tag">Phase 6</span>
        </div>
      </section>
    </>
  );
}
