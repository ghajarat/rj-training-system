// Labels, icons and tones shared by the training pages (Phase 4b).

// Material types, as returned in course.material.type by the API.
export const MATERIAL_INFO = {
  pdf:  { label: 'PDF',        icon: 'file' },
  docx: { label: 'Word',       icon: 'file' },
  pptx: { label: 'PowerPoint', icon: 'layers' },
  mp4:  { label: 'Video',      icon: 'play' },
  link: { label: 'Web link',   icon: 'link' },
  none: { label: 'No material', icon: 'book' },
};

export const MATERIAL_TYPE_OPTIONS = Object.entries(MATERIAL_INFO)
  .map(([value, { label }]) => ({ value, label }));

export const materialType = (course) => course.material?.type || 'none';

// Trainee progress status (services/progress.js on the backend).
export const PROGRESS_STATUS = {
  completed:   { label: 'Completed',   tone: 'success' },
  overdue:     { label: 'Overdue',     tone: 'danger' },
  in_progress: { label: 'In progress', tone: 'warning' },
  not_started: { label: 'Not started', tone: 'neutral' },
};

// Progress bar colour for a status.
export function toneForStatus(status) {
  if (status === 'completed') return 'success';
  if (status === 'overdue') return 'danger';
  return 'primary';
}

// ---------- Trainee side (Phase 4c) ----------

// A plan whose start date is still ahead and that nobody has touched shows
// as "Upcoming" to the trainee (decision 4: it can still be opened).
export function planStatusFor(plan) {
  if (plan.upcoming && plan.status === 'not_started') return { label: 'Upcoming', tone: 'primary' };
  return PROGRESS_STATUS[plan.status];
}

// One course for one trainee (services/progress.js, COURSE_STATUS_SQL).
export const COURSE_STATUS = {
  not_started: { label: 'Not started', tone: 'neutral', action: 'Start' },
  started:     { label: 'Started',     tone: 'warning', action: 'Resume' },
  in_progress: { label: 'In progress', tone: 'warning', action: 'Resume' },
  completed:   { label: 'Completed',   tone: 'success', action: 'Review' },
};

// Labels for the progress steps a trainee can choose (decision 1).
export const PROGRESS_STEP_LABELS = { 0: 'Started', 25: '25%', 50: '50%', 75: '75%', 100: 'Completed' };
