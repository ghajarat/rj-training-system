// Shared SQL and the one user shape sent to the frontend.
//
// Every endpoint that returns a user (login, /me, /users...) selects
// USER_SELECT and passes the row through toUserDto, so the frontend has a
// single User type and password_hash / setup_token_hash can never leak.
const db = require('../db');

// Account status, derived rather than stored (no extra column to keep in sync):
//   inactive        deactivated by an admin (FR19)
//   invited         no password yet, invite link still valid (FR1)
//   invite_expired  no password yet, link expired — admin can issue a new one
//   active          everything else
const STATUS_SQL = `
  CASE
    WHEN NOT u.is_active THEN 'inactive'
    WHEN u.password_hash IS NULL AND u.setup_token_expires_at > NOW() THEN 'invited'
    WHEN u.password_hash IS NULL THEN 'invite_expired'
    ELSE 'active'
  END`;

const STATUSES = ['active', 'inactive', 'invited', 'invite_expired'];

// "Last active" = most recent sign-in recorded in the audit log.
const USER_SELECT = `
  SELECT u.user_id, u.full_name, u.email, u.created_at, u.is_active, u.dept_id,
         u.setup_token_expires_at,
         r.role_name, d.dept_name,
         ${STATUS_SQL} AS status,
         (SELECT MAX(a.created_at) FROM audit_logs a
           WHERE a.actor_id = u.user_id AND a.action = 'LOGIN') AS last_active_at
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN departments d ON d.dept_id = u.dept_id`;

function toUserDto(row) {
  return {
    id: row.user_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role_name,
    departmentId: row.dept_id,
    department: row.dept_name,
    status: row.status,
    isActive: row.is_active,
    // Only meaningful while an invitation is pending
    inviteExpiresAt: row.status === 'invited' || row.status === 'invite_expired'
      ? row.setup_token_expires_at
      : null,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
  };
}

async function findUserById(id, queryable = db) {
  const { rows } = await queryable.query(`${USER_SELECT} WHERE u.user_id = $1`, [id]);
  return rows[0] || null;
}

module.exports = { USER_SELECT, STATUSES, toUserDto, findUserById };
