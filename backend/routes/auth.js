// /api/auth — sign-in and session lookup.
//
// Follows the Login Sequence Diagram (GP1 Fig. 18): Web App → Backend →
// Database (fetch user + verify hash) → JWT Service → token + role back to
// the Web App, which redirects to the role's dashboard.
//
// There is no /register route: accounts are created by admins only (FR19).
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { signToken } = require('../utils/jwt');
const { verifyPassword } = require('../utils/password');
const loginAttempts = require('../services/loginAttempts');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same shape is returned by /login and /me so the frontend has one User type.
const USER_COLUMNS = `
  u.user_id, u.full_name, u.email, u.created_at,
  r.role_name, d.dept_name`;

function toUserDto(row) {
  return {
    id: row.user_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role_name,
    department: row.dept_name,
    createdAt: row.created_at,
  };
}

// POST /api/auth/login   { email, password }  →  { token, user }
router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    throw new HttpError(400, 'VALIDATION', 'Email and password are both required.');
  }
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'VALIDATION', 'Please enter a valid email address.');
  }

  const lockedUntil = loginAttempts.getLock(email);
  if (lockedUntil) {
    const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
    throw new HttpError(423, 'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, u.password_hash
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.dept_id = u.dept_id
      WHERE u.email = $1`,
    [email],
  );
  const user = rows[0];

  // Always run bcrypt, even for unknown emails (see utils/password.js).
  const ok = await verifyPassword(password, user?.password_hash);

  if (!user || !ok) {
    const { locked, remaining } = loginAttempts.recordFailure(email);
    if (locked) {
      throw new HttpError(423, 'ACCOUNT_LOCKED',
        'Too many failed attempts. Your account is temporarily locked.');
    }
    // Deliberately vague: never reveal whether the email exists.
    const hint = remaining <= 2 ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : '';
    throw new HttpError(401, 'INVALID_CREDENTIALS', `Incorrect email or password.${hint}`);
  }

  loginAttempts.clearFailures(email);
  res.json({ token: signToken(user), user: toUserDto(user) });
});

// GET /api/auth/me  →  { user }
// Used by the frontend on page load to confirm a stored token is still good
// and to fetch fresh profile data. Also fails if the account was deleted
// after the token was issued.
router.get('/me', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.dept_id = u.dept_id
      WHERE u.user_id = $1`,
    [req.user.id],
  );
  if (!rows[0]) {
    throw new HttpError(401, 'TOKEN_INVALID', 'This account no longer exists.');
  }
  res.json({ user: toUserDto(rows[0]) });
});

module.exports = router;
module.exports.toUserDto = toUserDto;
