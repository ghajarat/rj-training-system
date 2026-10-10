// Role names must match roles.role_name in the database exactly.
export const ROLES = {
  TRAINEE: 'Trainee',
  TRAINER: 'Trainer',
  ADMIN: 'Admin',
};

// Where each role lands after signing in (GP1 §4.1.4).
export const ROLE_HOME = {
  [ROLES.TRAINEE]: '/dashboard',
  [ROLES.TRAINER]: '/trainer',
  [ROLES.ADMIN]: '/admin/users',
};

export function homeFor(role) {
  return ROLE_HOME[role] || '/signin';
}
