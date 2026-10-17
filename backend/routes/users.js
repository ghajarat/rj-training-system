// /api/users — admin user management. Admin only (NFR07).
//
//   GET    /api/users                  list with search, filters, pagination
//   POST   /api/users                  invite a user                       FR1
//   GET    /api/users/:id              one user
//   PATCH  /api/users/:id              edit name, role, department         FR19
//   POST   /api/users/:id/setup-link   new invite / password-reset link    FR1
//   POST   /api/users/:id/deactivate   soft-deactivate                     FR19
//   POST   /api/users/:id/reactivate   undo a deactivation                 FR19
//
// Every change writes an audit row in the same transaction (FR2).
// Accounts are never hard-deleted: progress, feedback and chat history stay.
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const audit = require('../services/audit');
const { USER_SELECT, STATUSES, toUserDto, findUserById } = require('../services/users');
const { createSetupToken, expirySql, expiresHours } = require('../utils/setupToken');
const {
  EMAIL_RE, isUuid, requireUuid, parsePagination, paginationDto, likePattern,
} = require('../utils/validate');

const ROLES = ['Trainee', 'Trainer', 'Admin'];

const router = express.Router();

router.use(authenticate, authorize('Admin'));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// Runs fn(client) inside BEGIN/COMMIT, rolling back on any error.
async function inTransaction(fn) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Last-admin rule: the system must always keep at least one active admin.
//
// Locks every active admin row (FOR UPDATE) before anything else in the
// transaction. If two admins try to demote/deactivate each other at the same
// moment, the second transaction waits here until the first commits, then
// sees the new count — so both cannot succeed. Always locking the admin rows
// first, in user_id order, also keeps transactions from deadlocking.
async function lockActiveAdminIds(client) {
  const { rows } = await client.query(
    `SELECT u.user_id
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE r.role_name = 'Admin' AND u.is_active
      ORDER BY u.user_id
        FOR UPDATE OF u`,
  );
  return rows.map(r => r.user_id);
}

function assertNotLastAdmin(adminIds, targetId) {
  if (adminIds.length <= 1 && adminIds.includes(targetId)) {
    throw new HttpError(409, 'LAST_ADMIN',
      'This is the only active administrator. Make another user an Admin first.');
  }
}

// Locks and returns the target user, or throws 404.
async function lockUser(client, id) {
  const { rows } = await client.query(
    `SELECT u.user_id, u.full_name, u.email, u.is_active, u.dept_id, u.password_hash IS NULL AS awaiting_password,
            r.role_name, d.dept_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.dept_id = u.dept_id
      WHERE u.user_id = $1
        FOR UPDATE OF u`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'USER_NOT_FOUND', 'That user does not exist.');
  return rows[0];
}

function readFullName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 100) {
    throw new HttpError(400, 'VALIDATION', 'Full name must be between 2 and 100 characters.');
  }
  return name;
}

function readRole(value) {
  if (!ROLES.includes(value)) {
    throw new HttpError(400, 'VALIDATION', `Role must be one of: ${ROLES.join(', ')}.`);
  }
  return value;
}

// departmentId may be null (no department). Returns { id, name }.
async function readDepartment(client, value) {
  if (value === null || value === '') return { id: null, name: null };
  if (!isUuid(value)) throw new HttpError(400, 'VALIDATION', 'Please choose a valid department.');
  const { rows } = await client.query('SELECT dept_name FROM departments WHERE dept_id = $1', [value]);
  if (!rows[0]) throw new HttpError(400, 'VALIDATION', 'That department does not exist.');
  return { id: value, name: rows[0].dept_name };
}

async function roleIdFor(client, roleName) {
  const { rows } = await client.query('SELECT role_id FROM roles WHERE role_name = $1', [roleName]);
  return rows[0].role_id;
}

// Gives the target a fresh one-time link; replaces any earlier one.
async function issueSetupLink(client, userId) {
  const link = createSetupToken();
  const { rows } = await client.query(
    `UPDATE users
        SET setup_token_hash = $1, setup_token_expires_at = ${expirySql('$2')}
      WHERE user_id = $3
      RETURNING setup_token_expires_at`,
    [link.tokenHash, expiresHours(), userId],
  );
  return { url: link.url, expiresAt: rows[0].setup_token_expires_at };
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

// GET /api/users?search=&role=&departmentId=&status=&page=&pageSize=
//   → { users, pagination, counts: { total, pendingInvites } }
router.get('/', async (req, res) => {
  const q = req.query;
  const paging = parsePagination(q);

  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (q.search !== undefined && String(q.search).trim()) {
    const search = String(q.search).trim();
    if (search.length > 100) throw new HttpError(400, 'VALIDATION', 'Search text is too long.');
    params.push(likePattern(search));
    where.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (q.role) add('role_name = ?', readRole(q.role));
  if (q.departmentId) add('dept_id = ?', requireUuid(q.departmentId, 'department'));
  if (q.status) {
    if (!STATUSES.includes(q.status)) {
      throw new HttpError(400, 'VALIDATION', `Status must be one of: ${STATUSES.join(', ')}.`);
    }
    add('status = ?', q.status);
  }

  const filter = where.length ? where.join(' AND ') : 'TRUE';

  // One pass for the three numbers the screen needs: rows matching the
  // filters (for paging) and the unfiltered header counts.
  const counts = await db.query(
    `WITH list AS (${USER_SELECT})
     SELECT COUNT(*) FILTER (WHERE ${filter})::int          AS matched,
            COUNT(*)::int                                   AS total,
            COUNT(*) FILTER (WHERE status = 'invited')::int AS pending
       FROM list`,
    params,
  );

  const page = await db.query(
    `WITH list AS (${USER_SELECT})
     SELECT * FROM list
      WHERE ${filter}
      ORDER BY full_name, user_id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paging.pageSize, paging.offset],
  );

  const { matched, total, pending } = counts.rows[0];
  res.json({
    users: page.rows.map(toUserDto),
    pagination: paginationDto(paging, matched),
    counts: { total, pendingInvites: pending },
  });
});

// POST /api/users   { fullName, email, role, departmentId }
//   → 201 { user, inviteUrl, inviteExpiresAt }                         FR1
// There is no email service, so the admin copies inviteUrl and sends it.
router.post('/', async (req, res) => {
  const body = req.body || {};
  const fullName = readFullName(body.fullName);
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 255) {
    throw new HttpError(400, 'VALIDATION', 'Please enter a valid email address.');
  }
  const role = readRole(body.role);

  const result = await inTransaction(async (client) => {
    const dept = await readDepartment(client, body.departmentId ?? null);

    const taken = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (taken.rows[0]) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'A user with this email already exists.');
    }

    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO users (role_id, dept_id, full_name, email, password_hash)
         VALUES ($1, $2, $3, $4, NULL)
         RETURNING user_id`,
        [await roleIdFor(client, role), dept.id, fullName, email],
      );
    } catch (err) {
      // Two invites for the same email at the same instant: the UNIQUE
      // constraint catches the one the SELECT above could not.
      if (err.code === '23505') {
        throw new HttpError(409, 'EMAIL_TAKEN', 'A user with this email already exists.');
      }
      throw err;
    }
    const userId = inserted.rows[0].user_id;

    const link = await issueSetupLink(client, userId);
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.USER_INVITED,
      targetUserId: userId,
      details: { email, role, department: dept.name },
    });

    return { user: await findUserById(userId, client), link };
  });

  res.status(201).json({
    user: toUserDto(result.user),
    inviteUrl: result.link.url,
    inviteExpiresAt: result.link.expiresAt,
  });
});

// GET /api/users/:id  →  { user }
router.get('/:id', async (req, res) => {
  const user = await findUserById(requireUuid(req.params.id, 'user id'));
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'That user does not exist.');
  res.json({ user: toUserDto(user) });
});

// PATCH /api/users/:id   { fullName?, role?, departmentId? }  →  { user }   FR19
// Email is not editable: it is the sign-in identity.
router.patch('/:id', async (req, res) => {
  const id = requireUuid(req.params.id, 'user id');
  const body = req.body || {};
  const fields = ['fullName', 'role', 'departmentId'].filter(f => body[f] !== undefined);
  if (fields.length === 0) {
    throw new HttpError(400, 'VALIDATION', 'Nothing to update. Send fullName, role or departmentId.');
  }
  if (body.email !== undefined) {
    throw new HttpError(400, 'VALIDATION', 'Email cannot be changed. Invite the user again with the new address.');
  }

  const fullName = body.fullName !== undefined ? readFullName(body.fullName) : undefined;
  const role = body.role !== undefined ? readRole(body.role) : undefined;

  const user = await inTransaction(async (client) => {
    const adminIds = await lockActiveAdminIds(client);
    const current = await lockUser(client, id);
    const dept = body.departmentId !== undefined
      ? await readDepartment(client, body.departmentId)
      : { id: current.dept_id, name: current.dept_name };

    // Record only what actually changes, as { field: { from, to } }.
    const changes = {};
    if (fullName !== undefined && fullName !== current.full_name) {
      changes.fullName = { from: current.full_name, to: fullName };
    }
    if (role !== undefined && role !== current.role_name) {
      changes.role = { from: current.role_name, to: role };
    }
    if (dept.id !== current.dept_id) {
      changes.department = { from: current.dept_name, to: dept.name };
    }

    if (changes.role) {
      // An admin who demotes themselves would lose access mid-session.
      if (id === req.user.id) {
        throw new HttpError(409, 'SELF_ROLE_CHANGE', 'You cannot change your own role. Ask another administrator.');
      }
      if (current.role_name === 'Admin') assertNotLastAdmin(adminIds, id);
    }

    if (Object.keys(changes).length > 0) {
      await client.query(
        `UPDATE users
            SET full_name = $1, role_id = $2, dept_id = $3
          WHERE user_id = $4`,
        [fullName ?? current.full_name,
         await roleIdFor(client, role ?? current.role_name),
         dept.id, id],
      );
      await audit.record(client, {
        actorId: req.user.id,
        action: audit.ACTIONS.USER_UPDATED,
        targetUserId: id,
        details: { changes },
      });
    }

    return findUserById(id, client);
  });

  res.json({ user: toUserDto(user) });
});

// POST /api/users/:id/setup-link  →  { user, setupUrl, expiresAt, purpose }   FR1
// For a pending user: a fresh invitation (the old link stops working).
// For an active user: a password-reset link — their current password keeps
// working until they use it.
router.post('/:id/setup-link', async (req, res) => {
  const id = requireUuid(req.params.id, 'user id');

  const result = await inTransaction(async (client) => {
    const current = await lockUser(client, id);
    if (!current.is_active) {
      throw new HttpError(409, 'USER_INACTIVE', 'This account is deactivated. Reactivate it before sending a link.');
    }
    const purpose = current.awaiting_password ? 'invite' : 'reset';
    const link = await issueSetupLink(client, id);
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.SETUP_LINK_ISSUED,
      targetUserId: id,
      details: { purpose },
    });
    return { user: await findUserById(id, client), link, purpose };
  });

  res.json({
    user: toUserDto(result.user),
    setupUrl: result.link.url,
    expiresAt: result.link.expiresAt,
    purpose: result.purpose,
  });
});

// POST /api/users/:id/deactivate  →  { user }                           FR19
// Takes effect on the user's very next request (see middleware/auth.js).
router.post('/:id/deactivate', async (req, res) => {
  const id = requireUuid(req.params.id, 'user id');
  if (id === req.user.id) {
    throw new HttpError(409, 'SELF_DEACTIVATE', 'You cannot deactivate your own account.');
  }

  const user = await inTransaction(async (client) => {
    const adminIds = await lockActiveAdminIds(client);
    const current = await lockUser(client, id);
    if (!current.is_active) {
      throw new HttpError(409, 'ALREADY_INACTIVE', 'This account is already deactivated.');
    }
    assertNotLastAdmin(adminIds, id);

    // Also cancels any pending invitation or reset link.
    await client.query(
      `UPDATE users
          SET is_active = FALSE, setup_token_hash = NULL, setup_token_expires_at = NULL
        WHERE user_id = $1`,
      [id],
    );
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.USER_DEACTIVATED,
      targetUserId: id,
    });
    return findUserById(id, client);
  });

  res.json({ user: toUserDto(user) });
});

// POST /api/users/:id/reactivate  →  { user }                           FR19
router.post('/:id/reactivate', async (req, res) => {
  const id = requireUuid(req.params.id, 'user id');

  const user = await inTransaction(async (client) => {
    const current = await lockUser(client, id);
    if (current.is_active) {
      throw new HttpError(409, 'ALREADY_ACTIVE', 'This account is already active.');
    }
    await client.query('UPDATE users SET is_active = TRUE WHERE user_id = $1', [id]);
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.USER_REACTIVATED,
      targetUserId: id,
    });
    return findUserById(id, client);
  });

  res.json({ user: toUserDto(user) });
});

module.exports = router;
