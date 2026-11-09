// One headline number in a card (Trainer Overview, Analytics & ROI).
//
//   <StatCard label="Active Trainees" value={39} foot="3 new this week" />
//   <StatCard label="Training ROI" value="+402%" valueTone="success" />
//   <StatCard label="At-Risk Trainees" value={7} foot="7 overdue" footTone="danger" />
//
// value null/undefined → "—". Tones: 'success' | 'warning' | 'danger'.
import './StatCard.css';

export default function StatCard({ label, value, unit, foot, valueTone, footTone }) {
  const empty = value === null || value === undefined;
  return (
    <div className="card stat-card">
      <p className="stat-card__label">{label}</p>
      <p className={`stat-card__value ${empty ? 'stat-card__value--empty' : ''} ${valueTone && !empty ? `stat-card__value--${valueTone}` : ''}`}>
        {empty ? '—' : value}
        {!empty && unit && <span className="stat-card__unit"> {unit}</span>}
      </p>
      <p className={`stat-card__foot ${footTone ? `stat-card__foot--${footTone}` : ''}`}>{foot || ' '}</p>
    </div>
  );
}
