// How report values are shown on screen. Mirrors formatValue in the
// backend's services/reportExport.js, so the preview reads like the PDF.
//
// Column types: text | int | pct | date | datetime | rating | money | score | change | status
import { formatDateTime, formatDay } from '../../utils/format';

const NUMERIC = new Set(['int', 'pct', 'rating', 'money', 'score', 'change']);

export const isNumeric = (type) => NUMERIC.has(type);

export function formatCell(value, type) {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'int':
    case 'money': return Number(value).toLocaleString('en-US');
    case 'pct': return `${value}%`;
    case 'rating': return `${Number(value).toFixed(1)} / 5`;
    case 'score': return value > 0 ? `+${value}` : String(value);
    case 'change': return value > 0 ? `+${value}%` : `${value}%`;
    case 'date': return formatDay(value);
    case 'datetime': return formatDateTime(value);
    default: return String(value);
  }
}

// Progress status labels as the backend writes them in reports.
const STATUS_TONES = {
  Completed: 'success',
  Overdue: 'danger',
  'In progress': 'warning',
  'Not started': 'neutral',
};

export const statusTone = (label) => STATUS_TONES[label] || 'neutral';

export const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
];
