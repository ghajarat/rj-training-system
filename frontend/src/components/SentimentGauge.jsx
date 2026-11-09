// Half-circle gauge for a sentiment score from −100 to +100
// (% positive − % negative, like an NPS). Drawn as inline SVG, no chart library.
//
//   <SentimentGauge score={63} />
//   <SentimentGauge score={null} />      no scored feedback yet → "—"
//
// The arc is split where the score would turn negative / positive.
import './SentimentGauge.css';

const CX = 100;
const CY = 100;
const R = 80;

// Score −100 … +100 → point on the arc (−100 = left end, +100 = right end).
function point(score, radius = R) {
  const angle = Math.PI * (1 - (score + 100) / 200);
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)];
}

function arc(from, to) {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const SEGMENTS = [
  { from: -100, to: -20, tone: 'danger' },
  { from: -20, to: 20, tone: 'warning' },
  { from: 20, to: 100, tone: 'success' },
];

export default function SentimentGauge({ score }) {
  const empty = score === null || score === undefined;
  const clamped = empty ? 0 : Math.max(-100, Math.min(100, score));
  const [nx, ny] = point(clamped, R - 18);
  const label = empty ? '—' : `${clamped > 0 ? '+' : ''}${clamped}`;

  return (
    <svg className="gauge" viewBox="0 0 200 120" role="img"
      aria-label={empty ? 'No sentiment score yet' : `Sentiment score ${label} out of 100`}>
      {SEGMENTS.map((s) => (
        <path key={s.tone} d={arc(s.from, s.to)} className={`gauge__arc gauge__arc--${s.tone}`} />
      ))}
      {!empty && (
        <>
          <line x1={CX} y1={CY} x2={nx.toFixed(2)} y2={ny.toFixed(2)} className="gauge__needle" />
          <circle cx={CX} cy={CY} r="5" className="gauge__hub" />
        </>
      )}
      <text x={CX} y={CY - 26} textAnchor="middle" className="gauge__value">{label}</text>
      <text x={CX} y={CY + 16} textAnchor="middle" className="gauge__caption">sentiment score</text>
    </svg>
  );
}
