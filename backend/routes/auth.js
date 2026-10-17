// /api/auth — sign-in, session lookup, and one-time setup links.
//
// Follows the Login Sequence Diagram (GP1 Fig. 18): Web App → Backend →
// Database (fetch user + verify hash) → JWT Service → token + role back to
// the Web App, which redirects to the role's dashboard.
//
// There is no /register route: accounts are created by admins only (FR1).
// An invited user finishes their account through /setup with the one-time
// token from their invite link; the same route handles admin-issued
// password-reset links.
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { signToken } = require('../utils/jwt');
const { hashPassword, verifyPassword, checkPasswordStrength } = require('../utils/password');
const { hashToken } = require('../utils/setupToken');
const { EMAIL_RE } = require('../utils/validate');
const loginAttempts = require('../services/loginAttempts');
const audit = require('../services/audit');
const { toUserDto, findUserById } = require('../services/users');
const { authenticate } = require('../middleware/auth');

const router = express.Router();


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
    `SELECT u.user_id, u.full_name, u.password_hash, u.is_active, r.role_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE u.email = $1`,
    [email],
  );
  const user = rows[0];

  // Always run bcrypt, even for unknown emails or invited users with no
  // password yet (see utils/password.js).
  const ok = await verifyPassword(password, user?.password_hash);

  if (!user || !ok) {
    // FR2: failed sign-ins are only logged for real accounts, so the log
    // cannot be flooded with made-up emails.
    if (user) {
      await audit.record(db, {
        actorId: user.user_id,
        action: audit.ACTIONS.LOGIN_FAILED,
        targetUserId: user.user_id,
        details: { reason: user.password_hash ? 'wrong_password' : 'invitation_not_accepted' },
      });
    }
    const { locked, remaining } = loginAttempts.recordFailure(email);
    if (locked) {
      throw new HttpError(423, 'ACCOUNT_LOCKED',
        'Too many failed attempts. Your account is temporarily locked.');
    }
    // Deliberately vague: never reveal whether the email exists.
    const hint = remaining <= 2 ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : '';
    throw new HttpError(401, 'INVALID_CREDENTIALS', `Incorrect email or password.${hint}`);
  }

  // FR19: checked only after the password is verified, so this message
  // cannot be used to discover which emails exist.
  if (!user.is_active) {
    await audit.record(db, {
      actorId: user.user_id,
      action: audit.ACTIONS.LOGIN_FAILED,
      targetUserId: user.user_id,
      details: { reason: 'deactivated' },
    });
    throw new HttpError(403, 'ACCOUNT_DEACTIVATED',
      'Your account has been deactivated. Please contact your administrator.');
  }

  loginAttempts.clearFailures(email);
  // FR2: sign-ins feed the audit log and the "Last active" column.
  await audit.record(db, {
    actorId: user.user_id,
    action: audit.ACTIONS.LOGIN,
    targetUserId: user.user_id,
  });

  const fresh = await findUserById(user.user_id);
  res.json({ token: signToken(user), user: toUserDto(fresh) });
});

// GET /api/auth/me  →  { user }
// Used by the frontend on page load to confirm a stored token is still good
// and to fetch fresh profile data. authenticate already rejects deleted or
// deactivated accounts.
router.get('/me', authenticate, async (req, res) => {
  const user = await findUserById(req.user.id);
  res.json({ user: toUserDto(user) });
});

// ---------------------------------------------------------------------
// One-time setup links (FR1)
// ---------------------------------------------------------------------

function readToken(body) {
  const token = body?.token;
  if (typeof token !== 'string' || !token || token.length > 200) {
    throw new HttpError(400, 'VALIDATION', 'The link is missing its token. Please use the full link you were sent.');
  }
  return token;
}

function invalidLink() {
  return new HttpError(400, 'SETUP_LINK_INVALID',
    'This link is invalid or has expired. Ask your administrator for a new one.');
}

// A link is valid while its hash matches, it has not expired and the account
// is still active. is_invite tells an invitation from a password reset.
const VALID_LINK_SQL = `
  SELECT user_id, full_name, email, (password_hash IS NULL) AS is_invite
    FROM users
   WHERE setup_token_hash = $1
     AND setup_token_expires_at > NOW()
     AND is_active`;

// POST /api/auth/setup/verify   { token }  →  { fullName, email, purpose }
// Lets the set-password page greet the user (or show "link expired")
// before they type anything. POST so the token stays out of server URLs.
router.post('/setup/verify', async (req, res) => {
  const token = readToken(req.body);
  const { rows } = await db.query(VALID_LINK_SQL, [hashToken(token)]);
  const row = rows[0];
  if (!row) throw invalidLink();

  res.json({
    fullName: row.full_name,
    email: row.email,
    purpose: row.is_invite ? 'invite' : 'reset',
  });
});

// POST /api/auth/setup   { token, password }  →  { message }
// Sets the password and burns the token so the link works only once.
router.post('/setup', async (req, res) => {
  const token = readToken(req.body);
  const password = req.body?.password;

  const weak = checkPasswordStrength(password);
  if (weak) throw new HttpError(400, 'VALIDATION', weak);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // FOR UPDATE: if the same link is submitted twice at once, the second
    // request waits, then finds the token already cleared.
    const { rows } = await client.query(`${VALID_LINK_SQL} FOR UPDATE`, [hashToken(token)]);
    const user = rows[0];
    if (!user) throw invalidLink();

    await client.query(
      `UPDATE users
          SET password_hash = $1, setup_token_hash = NULL, setup_token_expires_at = NULL
        WHERE user_id = $2`,
      [await hashPassword(password), user.user_id],
    );
    await audit.record(client, {
      actorId: user.user_id,
      action: audit.ACTIONS.PASSWORD_SET,
      targetUserId: user.user_id,
      details: { purpose: user.is_invite ? 'invite' : 'reset' },
    });

    await client.query('COMMIT');
    loginAttempts.clearFailures(user.email);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ message: 'Your password has been set. You can now sign in.' });
});

module.exports = router;
