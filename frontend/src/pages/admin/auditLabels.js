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
};

const FIELD_LABELS = { fullName: 'Name', role: 'Role', department: 'Department' };

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
      return Object.entries(details.changes || {})
        .map(([field, { from, to }]) => `${FIELD_LABELS[field] || field}: ${from ?? 'none'} → ${to ?? 'none'}`)
        .join(' · ');
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
