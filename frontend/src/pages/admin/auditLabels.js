// How each audit action (backend services/audit.js ACTIONS) is shown.
export const ACTION_INFO = {
  LOGIN:             { label: 'Signed in',          tone: 'neutral' },
  LOGIN_FAILED:      { label: 'Failed sign-in',     tone: 'warning' },
  USER_INVITED:      { label: 'Invited user',       tone: 'accent' },
  SETUP_LINK_ISSUED: { label: 'Issued setup link',  tone: 'accent' },
  PASSWORD_SET:      { label: 'Set password',       tone: 'success' },
  USER_UPDATED:      { label: 'Edited user',        tone: 'primary' },
  USER_DEACTIVATED:  { label: 'Deactivated user',   tone: 'danger' },
  USER_REACTIVATED:  { label: 'Reactivated user',   tone: 'success' },
  // Phase 4b — training management (FR7, FR8)
  COURSE_CREATED:    { label: 'Added course',       tone: 'accent' },
  COURSE_UPDATED:    { label: 'Edited course',      tone: 'primary' },
  COURSE_DELETED:    { label: 'Deleted course',     tone: 'danger' },
  PLAN_CREATED:      { label: 'Created plan',       tone: 'accent' },
  PLAN_UPDATED:      { label: 'Edited plan',        tone: 'primary' },
  PLAN_DELETED:      { label: 'Deleted plan',       tone: 'danger' },
  PLAN_ASSIGNED:     { label: 'Assigned plan',      tone: 'success' },
  PLAN_UNASSIGNED:   { label: 'Unassigned plan',    tone: 'warning' },
};

const FIELD_LABELS = {
  fullName: 'Name', role: 'Role', department: 'Department',
  name: 'Name', durationMinutes: 'Duration (min)', material: 'Material',
  description: 'Description', startDate: 'Start', dueDate: 'Due',
};

// { field: { from, to } } → "Name: A → B · Due: 2026-11-01 → 2026-12-01"
function describeChanges(changes = {}) {
  return Object.entries(changes)
    .map(([field, change]) => (change.changed
      ? `${FIELD_LABELS[field] || field} changed`
      : `${FIELD_LABELS[field] || field}: ${change.from ?? 'none'} → ${change.to ?? 'none'}`))
    .join(' · ');
}

const FAILURE_REASONS = {
  wrong_password: 'Wrong password',
  invitation_not_accepted: 'Invitation not accepted yet',
  deactivated: 'Account is deactivated',
};

const PURPOSES = { invite: 'Invitation', reset: 'Password reset' };

// One readable line for the Details column.
export function describeDetails(action, details = {}) {
  switch (action) {
    case 'USER_UPDATED':
      return describeChanges(details.changes);
    case 'COURSE_CREATED':
      return `${details.courseName} · in ${details.planName}${details.fileName ? ` · ${details.fileName}` : ''}`;
    case 'COURSE_UPDATED':
      return `${details.courseName} · ${describeChanges(details.changes)}`;
    case 'COURSE_DELETED':
      return `${details.courseName} · from ${details.planName}`;
    case 'PLAN_UPDATED':
      return details.reordered
        ? `${details.planName} · courses reordered`
        : `${details.planName} · ${describeChanges(details.changes)}`;
    case 'PLAN_CREATED':
    case 'PLAN_DELETED':
    case 'PLAN_UNASSIGNED':
      return details.planName || '';
    case 'PLAN_ASSIGNED':
      return `${details.planName}${details.department ? ` · via ${details.department}` : ''}`;
    case 'USER_INVITED':
      return `As ${details.role}${details.department ? ` · ${details.department}` : ''}`;
    case 'LOGIN_FAILED':
      return FAILURE_REASONS[details.reason] || '';
    case 'SETUP_LINK_ISSUED':
    case 'PASSWORD_SET':
      return PURPOSES[details.purpose] || '';
    default:
      return '';
  }
}
