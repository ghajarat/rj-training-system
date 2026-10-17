// Thin completion bar with an optional % label (FR9).
//
//   <ProgressBar value={65} />                    65% in Flint Gray
//   <ProgressBar value={40} tone="danger" />      overdue
//   <ProgressBar value={null} />                  "—" (nothing to measure)
//
// tone: 'primary' | 'success' | 'danger' | 'accent'
import './ProgressBar.css';

export default function ProgressBar({ value, tone = 'primary', showLabel = true, label = 'Completion' }) {
  const empty = value === null || value === undefined;
  const pct = empty ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="progress">
      <div
        className={`progress__track progress__track--${tone}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={empty ? undefined : pct}
      >
        <span className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="progress__label">{empty ? '—' : `${pct}%`}</span>}
    </div>
  );
}
