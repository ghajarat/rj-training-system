// Phase 4a API tests: auth, user management, setup links, audit log.
//
//   npm test
//
// WARNING: re-runs the migrations and the seed first, so it WIPES the
// database in DATABASE_URL and reloads the demo data. Dev databases only.
//
// Uses Node's built-in test runner (node:test) and supertest, which calls
// the Express app in-process — no server needs to be running.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const request = require('supertest');

const ROOT = path.join(__dirname, '..');
const PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';
const NEW_PASSWORD = 'Fresh-start-2026';
const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

let app;
let db;
const tokens = {};   // email → JWT
const ids = {};      // email → user id

async function login(email, password = PASSWORD) {
  return request(app).post('/api/auth/login').send({ email, password });
}

function as(email) {
  const auth = { Authorization: `Bearer ${tokens[email]}` };
  return {
    get: url => request(app).get(url).set(auth),
    post: (url, body) => request(app).post(url).set(auth).send(body),
    patch: (url, body) => request(app).patch(url).set(auth).send(body),
  };
}

const tokenFromUrl = url => new URL(url).searchParams.get('token');

before(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run tests in production.');
  execFileSync('node', ['db/migrate.js'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('node', ['db/seed.js'], { cwd: ROOT, stdio: 'ignore' });

  app = require('../app');
  db = require('../db');

  for (const email of ['admin@rj.com', 'trainer@rj.com', 'trainee@rj.com', 'trainee2@rj.com']) {
    const res = await login(email);
    assert.equal(res.status, 200, `seed login failed for ${email}`);
    tokens[email] = res.body.token;
    ids[email] = res.body.user.id;
  }
  const { rows } = await db.query('SELECT user_id, email FROM users');
  rows.forEach(r => { ids[r.email] = r.user_id; });
});

after(async () => {
  await db.pool.end();
});

// ---------------------------------------------------------------------
test('login', async (t) => {
  await t.test('success returns token and user without secrets', async () => {
    const res = await login('trainer@rj.com');
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'Trainer');
    assert.equal(res.body.user.status, 'active');
    assert.equal(res.body.user.password_hash, undefined);
    assert.ok(res.body.user.lastActiveAt, 'login should set lastActiveAt');
  });

  await t.test('missing fields → 400', async () => {
    const res = await login('', '');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION');
  });

  await t.test('wrong password → 401 and an audit row', async () => {
    const res = await login('trainee2@rj.com', 'wrong-password-1');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    const { rows } = await db.query(
      `SELECT details FROM audit_logs WHERE action = 'LOGIN_FAILED' AND actor_id = $1`,
      [ids['trainee2@rj.com']]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].details.reason, 'wrong_password');
  });

  await t.test('seeded deactivated account → 403 ACCOUNT_DEACTIVATED', async () => {
    const res = await login('huda.mansour@rj.com');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCOUNT_DEACTIVATED');
  });

  await t.test('deactivated account with WRONG password → generic 401 (no account disclosure)', async () => {
    const res = await login('huda.mansour@rj.com', 'not-the-password-9');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  await t.test('invited user without password → 401', async () => {
    const res = await login('sami.odeh@rj.com', 'anything-at-all-1');
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------
test('role-based access (NFR07)', async (t) => {
  // /api/departments is also open to Trainers since Phase 4b (assigning a
  // plan to a department, FR8) — covered in trainingManagement.test.js.
  for (const url of ['/api/users', '/api/audit-logs', `/api/users/${RANDOM_UUID}`]) {
    await t.test(`no token on ${url} → 401`, async () => {
      const res = await request(app).get(url);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTH_REQUIRED');
    });
    await t.test(`trainer on ${url} → 403`, async () => {
      const res = await as('trainer@rj.com').get(url);
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });
    await t.test(`trainee on ${url} → 403`, async () => {
      const res = await as('trainee@rj.com').get(url);
      assert.equal(res.status, 403);
    });
  }

  await t.test('trainer cannot invite, edit, deactivate or reactivate', async () => {
    const trainer = as('trainer@rj.com');
    const target = ids['trainee@rj.com'];
    assert.equal((await trainer.post('/api/users', { fullName: 'X Y', email: 'x@rj.com', role: 'Trainee' })).status, 403);
    assert.equal((await trainer.patch(`/api/users/${target}`, { fullName: 'Hacked' })).status, 403);
    assert.equal((await trainer.post(`/api/users/${target}/deactivate`)).status, 403);
    assert.equal((await trainer.post(`/api/users/${target}/reactivate`)).status, 403);
    assert.equal((await trainer.post(`/api/users/${target}/setup-link`)).status, 403);
  });
});

// ---------------------------------------------------------------------
test('GET /api/users', async (t) => {
  const admin = as('admin@rj.com');

  await t.test('lists users with counts and pagination', async () => {
    const res = await admin.get('/api/users');
    assert.equal(res.status, 200);
    assert.equal(res.body.users.length, 7);
    assert.deepEqual(res.body.counts, { total: 7, pendingInvites: 1 });
    assert.deepEqual(res.body.pagination, { page: 1, pageSize: 20, total: 7, totalPages: 1 });
    for (const u of res.body.users) {
      assert.equal(u.password_hash, undefined);
      assert.equal(u.setup_token_hash, undefined);
    }
  });

  await t.test('search by name or email', async () => {
    const byName = await admin.get('/api/users?search=omar');
    assert.deepEqual(byName.body.users.map(u => u.email), ['trainee@rj.com']);
    const byEmail = await admin.get('/api/users?search=TRAINEE2');
    assert.deepEqual(byEmail.body.users.map(u => u.email), ['trainee2@rj.com']);
  });

  await t.test('search treats % as text, not a wildcard', async () => {
    const res = await admin.get('/api/users?search=%25');
    assert.equal(res.body.users.length, 0);
  });

  await t.test('filter by role, status and department', async () => {
    const trainers = await admin.get('/api/users?role=Trainer');
    assert.deepEqual(trainers.body.users.map(u => u.email), ['trainer@rj.com']);

    const invited = await admin.get('/api/users?status=invited');
    assert.deepEqual(invited.body.users.map(u => u.email), ['sami.odeh@rj.com']);
    assert.ok(invited.body.users[0].inviteExpiresAt);

    const inactive = await admin.get('/api/users?status=inactive');
    assert.deepEqual(inactive.body.users.map(u => u.email), ['huda.mansour@rj.com']);

    const deptId = trainers.body.users[0].departmentId;
    const inDept = await admin.get(`/api/users?departmentId=${deptId}`);
    assert.ok(inDept.body.users.every(u => u.departmentId === deptId));
    assert.equal(inDept.body.pagination.total, 2);
  });

  await t.test('pagination', async () => {
    const res = await admin.get('/api/users?pageSize=3&page=3');
    assert.equal(res.body.users.length, 1);
    assert.deepEqual(res.body.pagination, { page: 3, pageSize: 3, total: 7, totalPages: 3 });
  });

  await t.test('invalid filters → 400', async () => {
    for (const qs of ['status=banned', 'role=Pilot', 'page=0', 'pageSize=500', 'departmentId=abc']) {
      const res = await admin.get(`/api/users?${qs}`);
      assert.equal(res.status, 400, qs);
      assert.equal(res.body.error.code, 'VALIDATION');
    }
  });

  await t.test('GET /:id — found, 404, 400', async () => {
    const ok = await admin.get(`/api/users/${ids['trainee@rj.com']}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.fullName, 'Omar Khalil');
    assert.equal((await admin.get(`/api/users/${RANDOM_UUID}`)).status, 404);
    assert.equal((await admin.get('/api/users/not-a-uuid')).status, 400);
  });
});

// ---------------------------------------------------------------------
test('GET /api/departments', async () => {
  const res = await as('admin@rj.com').get('/api/departments');
  assert.equal(res.status, 200);
  assert.equal(res.body.departments.length, 4);
  assert.equal((await request(app).get('/api/departments')).status, 401);
  assert.equal((await as('trainee@rj.com').get('/api/departments')).status, 403);
});

// ---------------------------------------------------------------------
test('invite → set password → sign in (FR1)', async (t) => {
  const admin = as('admin@rj.com');
  const { body: { departments } } = await admin.get('/api/departments');
  let inviteToken;

  await t.test('validation failures → 400', async () => {
    const cases = [
      { fullName: 'A', email: 'new@rj.com', role: 'Trainee' },
      { fullName: 'New Person', email: 'not-an-email', role: 'Trainee' },
      { fullName: 'New Person', email: 'new@rj.com', role: 'Pilot' },
      { fullName: 'New Person', email: 'new@rj.com', role: 'Trainee', departmentId: RANDOM_UUID },
    ];
    for (const body of cases) {
      const res = await admin.post('/api/users', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION');
    }
  });

  await t.test('duplicate email → 409', async () => {
    const res = await admin.post('/api/users', { fullName: 'Copy Cat', email: 'Trainer@RJ.com', role: 'Trainee' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  await t.test('success → 201 with invite link, status invited, audit row', async () => {
    const res = await admin.post('/api/users', {
      fullName: '  Dana   Qasem ', email: 'Dana.Qasem@rj.com', role: 'Trainer', departmentId: departments[0].id,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.fullName, 'Dana Qasem');
    assert.equal(res.body.user.email, 'dana.qasem@rj.com');
    assert.equal(res.body.user.status, 'invited');
    assert.match(res.body.inviteUrl, /\/set-password\?token=/);
    inviteToken = tokenFromUrl(res.body.inviteUrl);
    ids['dana.qasem@rj.com'] = res.body.user.id;

    const { rows } = await db.query(
      `SELECT actor_id, details FROM audit_logs WHERE action = 'USER_INVITED' AND target_user_id = $1`,
      [res.body.user.id]);
    assert.equal(rows[0].actor_id, ids['admin@rj.com']);
    assert.equal(rows[0].details.role, 'Trainer');

    const stored = await db.query('SELECT setup_token_hash FROM users WHERE user_id = $1', [res.body.user.id]);
    assert.notEqual(stored.rows[0].setup_token_hash, inviteToken, 'raw token must not be stored');
  });

  await t.test('verify link', async () => {
    const ok = await request(app).post('/api/auth/setup/verify').send({ token: inviteToken });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { fullName: 'Dana Qasem', email: 'dana.qasem@rj.com', purpose: 'invite' });

    const bad = await request(app).post('/api/auth/setup/verify').send({ token: 'made-up' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'SETUP_LINK_INVALID');

    const missing = await request(app).post('/api/auth/setup/verify').send({});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'VALIDATION');
  });

  await t.test('weak password → 400', async () => {
    for (const password of ['short1', 'onlyletters', '1234567890']) {
      const res = await request(app).post('/api/auth/setup').send({ token: inviteToken, password });
      assert.equal(res.status, 400, password);
      assert.equal(res.body.error.code, 'VALIDATION');
    }
  });

  await t.test('set password, link is then single-use, user can sign in', async () => {
    const res = await request(app).post('/api/auth/setup').send({ token: inviteToken, password: NEW_PASSWORD });
    assert.equal(res.status, 200);

    const again = await request(app).post('/api/auth/setup').send({ token: inviteToken, password: NEW_PASSWORD });
    assert.equal(again.status, 400);
    assert.equal(again.body.error.code, 'SETUP_LINK_INVALID');

    const signIn = await login('dana.qasem@rj.com', NEW_PASSWORD);
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.user.status, 'active');
  });

  await t.test('expired invite → status invite_expired, link rejected', async () => {
    const res = await admin.post('/api/users', { fullName: 'Late Comer', email: 'late@rj.com', role: 'Trainee' });
    const token = tokenFromUrl(res.body.inviteUrl);
    await db.query(`UPDATE users SET setup_token_expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`,
      [res.body.user.id]);

    const user = await admin.get(`/api/users/${res.body.user.id}`);
    assert.equal(user.body.user.status, 'invite_expired');
    const verify = await request(app).post('/api/auth/setup/verify').send({ token });
    assert.equal(verify.status, 400);

    // A new link replaces the old one
    const link = await admin.post(`/api/users/${res.body.user.id}/setup-link`);
    assert.equal(link.status, 200);
    assert.equal(link.body.purpose, 'invite');
    assert.equal(link.body.user.status, 'invited');
  });
});

// ---------------------------------------------------------------------
test('password-reset link for an active user (FR1)', async () => {
  const admin = as('admin@rj.com');
  const id = ids['trainee2@rj.com'];

  const res = await admin.post(`/api/users/${id}/setup-link`);
  assert.equal(res.status, 200);
  assert.equal(res.body.purpose, 'reset');
  assert.equal(res.body.user.status, 'active', 'a pending reset does not change status');

  // The old password still works until the link is used
  assert.equal((await login('trainee2@rj.com')).status, 200);

  const token = tokenFromUrl(res.body.setupUrl);
  const verify = await request(app).post('/api/auth/setup/verify').send({ token });
  assert.equal(verify.body.purpose, 'reset');
  assert.equal((await request(app).post('/api/auth/setup').send({ token, password: NEW_PASSWORD })).status, 200);

  assert.equal((await login('trainee2@rj.com')).status, 401);
  assert.equal((await login('trainee2@rj.com', NEW_PASSWORD)).status, 200);
});

// ---------------------------------------------------------------------
test('PATCH /api/users/:id (FR19)', async (t) => {
  const admin = as('admin@rj.com');
  const id = ids['trainee@rj.com'];

  await t.test('edit name and department, audit records from/to', async () => {
    const { body: { departments } } = await admin.get('/api/departments');
    const target = departments.find(d => d.name === 'Ground Operations');
    const res = await admin.patch(`/api/users/${id}`, { fullName: 'Omar K. Khalil', departmentId: target.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.fullName, 'Omar K. Khalil');
    assert.equal(res.body.user.department, 'Ground Operations');

    const { rows } = await db.query(
      `SELECT details FROM audit_logs WHERE action = 'USER_UPDATED' AND target_user_id = $1`, [id]);
    assert.deepEqual(rows[0].details.changes.fullName, { from: 'Omar Khalil', to: 'Omar K. Khalil' });
    assert.deepEqual(rows[0].details.changes.department, { from: 'Cabin Crew', to: 'Ground Operations' });
  });

  await t.test('no real change → no audit row', async () => {
    const before = await db.query(`SELECT COUNT(*)::int n FROM audit_logs WHERE action = 'USER_UPDATED'`);
    const res = await admin.patch(`/api/users/${id}`, { fullName: 'Omar K. Khalil' });
    assert.equal(res.status, 200);
    const afterCount = await db.query(`SELECT COUNT(*)::int n FROM audit_logs WHERE action = 'USER_UPDATED'`);
    assert.equal(afterCount.rows[0].n, before.rows[0].n);
  });

  await t.test('department can be cleared with null', async () => {
    const res = await admin.patch(`/api/users/${id}`, { departmentId: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.department, null);
  });

  await t.test('role change takes effect on the next request', async () => {
    const promote = await admin.patch(`/api/users/${id}`, { role: 'Trainer' });
    assert.equal(promote.body.user.role, 'Trainer');
    // Old token still says "Trainee", but the DB now says Trainer
    const me = await as('trainee@rj.com').get('/api/auth/me');
    assert.equal(me.body.user.role, 'Trainer');
    await admin.patch(`/api/users/${id}`, { role: 'Trainee' });
  });

  await t.test('validation failures → 400', async () => {
    assert.equal((await admin.patch(`/api/users/${id}`, {})).status, 400);
    assert.equal((await admin.patch(`/api/users/${id}`, { email: 'new@rj.com' })).status, 400);
    assert.equal((await admin.patch(`/api/users/${id}`, { role: 'Pilot' })).status, 400);
    assert.equal((await admin.patch(`/api/users/${id}`, { fullName: '' })).status, 400);
    assert.equal((await admin.patch('/api/users/nope', { fullName: 'Valid Name' })).status, 400);
  });

  await t.test('unknown user → 404', async () => {
    const res = await admin.patch(`/api/users/${RANDOM_UUID}`, { fullName: 'Valid Name' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'USER_NOT_FOUND');
  });

  await t.test('admin cannot change their own role → 409', async () => {
    const res = await admin.patch(`/api/users/${ids['admin@rj.com']}`, { role: 'Trainee' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'SELF_ROLE_CHANGE');
  });

  await t.test('admin can still edit their own name', async () => {
    const res = await admin.patch(`/api/users/${ids['admin@rj.com']}`, { fullName: 'System Admin' });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------
test('deactivate / reactivate (FR19)', async (t) => {
  const admin = as('admin@rj.com');
  const id = ids['trainee@rj.com'];

  await t.test('cannot deactivate yourself → 409', async () => {
    const res = await admin.post(`/api/users/${ids['admin@rj.com']}/deactivate`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'SELF_DEACTIVATE');
  });

  await t.test('deactivation blocks the user on their NEXT request, not just at login', async () => {
    assert.equal((await as('trainee@rj.com').get('/api/auth/me')).status, 200);

    const res = await admin.post(`/api/users/${id}/deactivate`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.status, 'inactive');

    const me = await as('trainee@rj.com').get('/api/auth/me');
    assert.equal(me.status, 401);
    assert.equal(me.body.error.code, 'ACCOUNT_DEACTIVATED');

    const signIn = await login('trainee@rj.com');
    assert.equal(signIn.status, 403);
    assert.equal(signIn.body.error.code, 'ACCOUNT_DEACTIVATED');
  });

  await t.test('deactivating twice → 409; setup link for inactive → 409', async () => {
    assert.equal((await admin.post(`/api/users/${id}/deactivate`)).body.error.code, 'ALREADY_INACTIVE');
    assert.equal((await admin.post(`/api/users/${id}/setup-link`)).body.error.code, 'USER_INACTIVE');
  });

  await t.test('deactivating an invited user cancels the invite link', async () => {
    const invited = await admin.post('/api/users', { fullName: 'Never Joined', email: 'never@rj.com', role: 'Trainee' });
    const token = tokenFromUrl(invited.body.inviteUrl);
    await admin.post(`/api/users/${invited.body.user.id}/deactivate`);
    const verify = await request(app).post('/api/auth/setup/verify').send({ token });
    assert.equal(verify.status, 400);
  });

  await t.test('reactivate restores access; twice → 409', async () => {
    const res = await admin.post(`/api/users/${id}/reactivate`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.status, 'active');
    assert.equal((await login('trainee@rj.com')).status, 200);
    assert.equal((await admin.post(`/api/users/${id}/reactivate`)).body.error.code, 'ALREADY_ACTIVE');
  });

  await t.test('unknown user → 404, bad id → 400', async () => {
    assert.equal((await admin.post(`/api/users/${RANDOM_UUID}/deactivate`)).status, 404);
    assert.equal((await admin.post('/api/users/123/reactivate')).status, 400);
  });

  await t.test('last active admin: two admins deactivating each other at once cannot both succeed', async () => {
    // Make the trainer a second admin and sign them in.
    await admin.patch(`/api/users/${ids['trainer@rj.com']}`, { role: 'Admin' });
    const signIn = await login('trainer@rj.com');
    tokens['trainer@rj.com'] = signIn.body.token;

    const [a, b] = await Promise.all([
      admin.post(`/api/users/${ids['trainer@rj.com']}/deactivate`),
      as('trainer@rj.com').post(`/api/users/${ids['admin@rj.com']}/deactivate`),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses.filter(s => s === 200).length, 1, `got ${statuses}`);
    // The loser is rejected either by the last-admin rule (409) or, if the
    // winner committed before it was authenticated, as deactivated (401).
    const loser = a.status === 200 ? b : a;
    assert.ok(['LAST_ADMIN', 'ACCOUNT_DEACTIVATED'].includes(loser.body.error.code), loser.body.error.code);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int n FROM users u JOIN roles r USING (role_id)
        WHERE r.role_name = 'Admin' AND u.is_active`);
    assert.equal(rows[0].n, 1);

    // Restore: whichever admin survived reactivates the other, then demotes the trainer.
    const survivor = a.status === 200 ? 'admin@rj.com' : 'trainer@rj.com';
    const other = survivor === 'admin@rj.com' ? 'trainer@rj.com' : 'admin@rj.com';
    assert.equal((await as(survivor).post(`/api/users/${ids[other]}/reactivate`)).status, 200);
    if (survivor === 'trainer@rj.com') {
      tokens['admin@rj.com'] = (await login('admin@rj.com')).body.token;
    }
    assert.equal((await as('admin@rj.com').patch(`/api/users/${ids['trainer@rj.com']}`, { role: 'Trainer' })).status, 200);
  });
});

// ---------------------------------------------------------------------
test('GET /api/audit-logs (FR2)', async (t) => {
  const admin = as('admin@rj.com');

  await t.test('lists newest first with actor and target', async () => {
    const res = await admin.get('/api/audit-logs');
    assert.equal(res.status, 200);
    assert.ok(res.body.entries.length > 10);
    const times = res.body.entries.map(e => new Date(e.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((x, y) => y - x));
    assert.ok(res.body.actions.includes('USER_DEACTIVATED'));
  });

  await t.test('every admin action from this run was logged', async () => {
    for (const action of ['LOGIN', 'LOGIN_FAILED', 'USER_INVITED', 'SETUP_LINK_ISSUED',
      'PASSWORD_SET', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_REACTIVATED']) {
      const res = await admin.get(`/api/audit-logs?action=${action}`);
      assert.ok(res.body.pagination.total > 0, action);
      assert.ok(res.body.entries.every(e => e.action === action));
    }
  });

  await t.test('filter by user, search and date range', async () => {
    const id = ids['trainee@rj.com'];
    const byUser = await admin.get(`/api/audit-logs?userId=${id}`);
    assert.ok(byUser.body.entries.every(e => e.actor?.id === id || e.target?.id === id));

    const bySearch = await admin.get('/api/audit-logs?search=dana');
    assert.ok(bySearch.body.entries.length > 0);

    const future = await admin.get('/api/audit-logs?from=2099-01-01');
    assert.equal(future.body.entries.length, 0);
    const past = await admin.get('/api/audit-logs?to=2000-01-01');
    assert.equal(past.body.entries.length, 0);
    const wide = await admin.get('/api/audit-logs?from=2000-01-01&to=2099-12-31');
    assert.ok(wide.body.pagination.total > 0);
  });

  await t.test('pagination', async () => {
    const res = await admin.get('/api/audit-logs?pageSize=5&page=2');
    assert.equal(res.body.entries.length, 5);
    assert.equal(res.body.pagination.page, 2);
  });

  await t.test('invalid filters → 400', async () => {
    for (const qs of ['action=DROP_TABLES', 'from=yesterday', 'from=2026-05-02&to=2026-05-01', 'userId=1', 'pageSize=0']) {
      const res = await admin.get(`/api/audit-logs?${qs}`);
      assert.equal(res.status, 400, qs);
    }
  });
});
