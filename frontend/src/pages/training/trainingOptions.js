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
