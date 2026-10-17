// Display helpers shared across pages.

export function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export function formatDateTime(value) {
  return value ? dateTimeFmt.format(new Date(value)) : '—';
}

export function formatDate(value) {
  return value ? dateFmt.format(new Date(value)) : '—';
}

// "just now", "5 min ago", "3h ago", "yesterday", "4 days ago", then a date.
export function timeAgo(value) {
  if (!value) return 'Never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(value);
}

// A calendar day from the API ('YYYY-MM-DD', e.g. a plan's due date).
// Read as a LOCAL date: new Date('2026-12-31') would be UTC midnight, which
// shows as 30 Dec in any time zone west of UTC.
export function formatDay(value) {
  if (!value) return '—';
  const [y, m, d] = value.split('-').map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
}

// Today as 'YYYY-MM-DD' in the user's time zone (default for date inputs).
export function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// 90 → "1h 30m", 45 → "45m", null → "—"
export function formatMinutes(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// 1536000 → "1.5 MB"
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

// Whole days from today to an API day ('YYYY-MM-DD'), in the user's time
// zone: 0 = today, 1 = tomorrow, -2 = two days ago.
export function daysUntil(value) {
  const [y, m, d] = value.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

// "Due today", "Due tomorrow", "Due in 5 days", "Overdue by 2 days".
export function dueLabel(value) {
  const days = daysUntil(value);
  if (days < 0) return `Overdue by ${plural(-days, 'day')}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}
