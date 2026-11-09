// One bar split into parts that add up to 100%, e.g. positive / neutral /
// negative feedback.
//
//   <StackedBar label="Sentiment of Cabin Safety"
//     parts={[{ value: 70, tone: 'success', label: 'Positive' }, ...]} />
//
// Tones: 'success' | 'muted' | 'danger' | 'primary'. Empty parts are skipped.
import './StackedBar.css';

export default function StackedBar({ parts, label }) {
  const description = parts.map((p) => `${p.label} ${p.value}%`).join(', ');
  return (
    <div className="stacked-bar" role="img" aria-label={`${label}: ${description}`}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <span key={p.label} className={`stacked-bar__part stacked-bar__part--${p.tone}`}
          style={{ width: `${p.value}%` }} title={`${p.label}: ${p.value}%`} />
      ))}
    </div>
  );
}
