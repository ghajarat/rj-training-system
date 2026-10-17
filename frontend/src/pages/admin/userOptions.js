// Labels and dropdown options for User Management. Values must match the
// backend: role names = roles.role_name, statuses = services/users.js STATUSES.
import { ROLES } from '../../auth/roles';

export const ROLE_OPTIONS = Object.values(ROLES).map((r) => ({ value: r, label: r }));

export const STATUS_INFO = {
  active:         { label: 'Active',         tone: 'success' },
  invited:        { label: 'Invited',        tone: 'accent' },
  invite_expired: { label: 'Invite expired', tone: 'warning' },
  inactive:       { label: 'Deactivated',    tone: 'neutral' },
};

export const STATUS_OPTIONS = Object.entries(STATUS_INFO).map(([value, { label }]) => ({ value, label }));

// Matches the design: Admin in Prom Gold, Trainer in Flint Gray, Trainee light.
export const ROLE_TONE = {
  [ROLES.ADMIN]: 'accent',
  [ROLES.TRAINER]: 'primary',
  [ROLES.TRAINEE]: 'neutral',
};

// Same rule as backend utils/password.js — shown before the user submits.
export const PASSWORD_RULE = 'Use 10 to 72 characters, including at least one letter and one number.';

export function checkPassword(password) {
  if (password.length < 10 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return PASSWORD_RULE;
  }
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
