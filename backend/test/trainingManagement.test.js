// Phase 4b API tests: courses and materials (FR7), plans and assignments
// (FR8), progress (FR9), and their audit rows (FR2).
//
//   npm test
//
// WARNING: re-runs the migrations and the seed first, so it WIPES the
// database in DATABASE_URL and the files in uploads/materials/. Dev only.
//
// The upload limit is lowered to 1 MB for this file, so the "too large"
// case does not need a 100 MB test file.
process.env.MATERIAL_MAX_MB = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const ROOT = path.join(__dirname, '..');
const PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';
const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

// Smallest bytes that pass each type's content check
const PDF = Buffer.from('%PDF-1.4\n% test file\n');
const DOCX = Buffer.from('PK\u0003\u0004 pretend zip', 'latin1');
const NOT_A_PDF = Buffer.from('MZ this is really an exe');

let app;
let db;
let materialFiles;
const tokens = {};
const ids = {};
const plans = {};   // plan name → id (seeded)

function as(email) {
  const auth = { Authorization: `Bearer ${tokens[email]}` };
  return {
    get: url => request(app).get(url).set(auth),
    post: (url, body) => request(app).post(url).set(auth).send(body),
    patch: (url, body) => request(app).patch(url).set(auth).send(body),
    put: (url, body) => request(app).put(url).set(auth).send(body),
    delete: url => request(app).delete(url).set(auth),
    // multipart/form-data: fields + optional { buffer, name } file
    upload: (method, url, fields, file) => {
      let req = request(app)[method](url).set(auth);
      for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
      if (file) req = req.attach('file', file.buffer, file.name);
      return req;
    },
  };
}

const storedFiles = () => (fs.existsSync(materialFiles.MATERIALS_DIR)
  ? fs.readdirSync(materialFiles.MATERIALS_DIR).sort()
  : []);

async function auditCount(action) {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = $1', [action]);
  return rows[0].n;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

before(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run tests in production.');
  execFileSync('node', ['db/migrate.js'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('node', ['db/seed.js'], { cwd: ROOT, stdio: 'ignore' });

  app = require('../app');
  db = require('../db');
  materialFiles = require('../services/materialFiles');

  for (const email of ['admin@rj.com', 'trainer@rj.com', 'trainee@rj.com']) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `seed login failed for ${email}`);
    tokens[email] = res.body.token;
  }
  const users = await db.query('SELECT user_id, email FROM users');
  users.rows.forEach(r => { ids[r.email] = r.user_id; });
  const planRows = await db.query('SELECT plan_id, plan_name FROM training_plans');
  planRows.rows.forEach(r => { plans[r.plan_name] = r.plan_id; });
});

after(async () => {
  await db.pool.end();
});

// ---------------------------------------------------------------------
test('role-based access (NFR07)', async (t) => {
  const urls = ['/api/courses', '/api/plans', '/api/trainees',
    `/api/plans/${RANDOM_UUID}/progress`, `/api/courses/${RANDOM_UUID}/material`];
  for (const url of urls) {
    await t.test(`no token on ${url} → 401`, async () => {
      assert.equal((await request(app).get(url)).status, 401);
    });
    await t.test(`trainee on ${url} → 403`, async () => {
      const res = await as('trainee@rj.com').get(url);
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });
  }

  await t.test('trainer and admin can read', async () => {
    for (const email of ['trainer@rj.com', 'admin@rj.com']) {
      for (const url of ['/api/courses', '/api/plans', '/api/trainees', '/api/departments']) {
        assert.equal((await as(email).get(url)).status, 200, `${email} ${url}`);
      }
    }
  });

  await t.test('trainee cannot create, change or assign anything', async () => {
    const trainee = as('trainee@rj.com');
    const planId = plans['Cabin Safety Recurrent 2026'];
    assert.equal((await trainee.post('/api/plans', { name: 'Hack', startDate: today(), dueDate: today() })).status, 403);
    assert.equal((await trainee.patch(`/api/plans/${planId}`, { name: 'Hack' })).status, 403);
    assert.equal((await trainee.delete(`/api/plans/${planId}`)).status, 403);
    assert.equal((await trainee.post(`/api/plans/${planId}/assignments`, { traineeIds: [ids['trainee@rj.com']] })).status, 403);
  });

  await t.test('trainee upload is refused before any file is written', async () => {
    const before = storedFiles();
    const res = await as('trainee@rj.com').upload('post', '/api/courses',
      { planId: plans['Cabin Safety Recurrent 2026'], name: 'Sneaky' }, { buffer: PDF, name: 'x.pdf' });
    assert.equal(res.status, 403);
    assert.deepEqual(storedFiles(), before);
  });
});

// ---------------------------------------------------------------------
test('plans CRUD (FR8)', async (t) => {
  const trainer = as('trainer@rj.com');

  await t.test('list is sorted by due date, overdue plans last, with progress totals', async () => {
    const res = await trainer.get('/api/plans');
    assert.equal(res.status, 200);
    assert.equal(res.body.plans.length, 4);
    const last = res.body.plans.at(-1);
    assert.equal(last.name, 'Aviation Security Refresher');
    assert.equal(last.pastDue, true);
    assert.equal(last.assignedCount, 2);
    assert.equal(last.overdueCount, 1);
    assert.equal(last.completedCount, 1);
    const cabin = res.body.plans.find(p => p.name === 'Cabin Safety Recurrent 2026');
    assert.equal(cabin.courseCount, 4);
    assert.equal(cabin.totalMinutes, 270);
    assert.equal(cabin.dueDate, '2026-12-31');
  });

  await t.test('search', async () => {
    const res = await trainer.get('/api/plans?search=security');
    assert.deepEqual(res.body.plans.map(p => p.name), ['Aviation Security Refresher']);
  });

  await t.test('create → 201 with creator and an audit row', async () => {
    const before = await auditCount('PLAN_CREATED');
    const res = await trainer.post('/api/plans', {
      name: '  Crew   Resource Management ', description: 'CRM basics', startDate: today(), dueDate: daysFromNow(30),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.plan.name, 'Crew Resource Management');
    assert.equal(res.body.plan.createdBy.id, ids['trainer@rj.com']);
    assert.equal(res.body.plan.courseCount, 0);
    assert.equal(res.body.plan.assignedCount, 0);
    assert.equal(res.body.plan.avgCompletion, null);
    assert.equal(await auditCount('PLAN_CREATED'), before + 1);
    plans.crm = res.body.plan.id;
  });

  await t.test('admin can create too', async () => {
    const res = await as('admin@rj.com').post('/api/plans', { name: 'Admin plan', startDate: today(), dueDate: today() });
    assert.equal(res.status, 201);
    plans.adminPlan = res.body.plan.id;
  });

  await t.test('validation → 400', async () => {
    const bad = [
      {},
      { name: 'ab', startDate: today(), dueDate: today() },
      { name: 'Valid name', startDate: 'tomorrow', dueDate: today() },
      { name: 'Valid name', startDate: '2026-02-30', dueDate: '2026-03-01' },
      { name: 'Valid name', startDate: today(), dueDate: '2020-01-01' },
      { name: 'Valid name', startDate: today(), dueDate: today(), description: 'x'.repeat(2001) },
    ];
    for (const body of bad) {
      const res = await trainer.post('/api/plans', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION');
    }
  });

  await t.test('GET /:id — found with ordered courses, 404, 400', async () => {
    const ok = await trainer.get(`/api/plans/${plans['Cabin Safety Recurrent 2026']}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.courses.map(c => c.position), [1, 2, 3, 4]);
    assert.equal(ok.body.courses[0].name, 'Emergency Evacuation Procedures');
    assert.equal((await trainer.get(`/api/plans/${RANDOM_UUID}`)).status, 404);
    assert.equal((await trainer.get('/api/plans/abc')).status, 400);
  });

  await t.test('PATCH records only what changed', async () => {
    const res = await trainer.patch(`/api/plans/${plans.crm}`, { name: 'CRM Essentials', dueDate: daysFromNow(45) });
    assert.equal(res.status, 200);
    assert.equal(res.body.plan.name, 'CRM Essentials');
    const { rows } = await db.query(
      `SELECT details FROM audit_logs WHERE action = 'PLAN_UPDATED' ORDER BY created_at DESC LIMIT 1`);
    assert.deepEqual(Object.keys(rows[0].details.changes).sort(), ['dueDate', 'name']);
  });

  await t.test('PATCH validation and 404', async () => {
    assert.equal((await trainer.patch(`/api/plans/${plans.crm}`, {})).status, 400);
    assert.equal((await trainer.patch(`/api/plans/${plans.crm}`, { dueDate: '2000-01-01' })).status, 400);
    assert.equal((await trainer.patch(`/api/plans/${RANDOM_UUID}`, { name: 'Nope nope' })).status, 404);
  });
});

// ---------------------------------------------------------------------
test('courses and materials (FR7)', async (t) => {
  const trainer = as('trainer@rj.com');
  const course = {};

  await t.test('list with filters', async () => {
    const all = await trainer.get('/api/courses');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 11);
    const pdfs = await trainer.get('/api/courses?type=pdf');
    assert.deepEqual(pdfs.body.courses.map(c => c.name), ['Emergency Evacuation Procedures']);
    assert.equal(pdfs.body.courses[0].material.type, 'pdf');
    assert.equal(pdfs.body.courses[0].material.url, null, 'stored files have no public URL');
    const links = await trainer.get('/api/courses?type=link');
    assert.equal(links.body.courses[0].material.url, 'https://www.iata.org/en/publications/dgr/');
    const inPlan = await trainer.get(`/api/courses?planId=${plans['Ground Handling Fundamentals']}`);
    assert.equal(inPlan.body.courses.length, 2);
    assert.equal((await trainer.get('/api/courses?type=exe')).status, 400);
  });

  await t.test('create with a PDF → stored under a random name, added at the end', async () => {
    const before = storedFiles();
    const res = await trainer.upload('post', '/api/courses',
      { planId: plans.crm, name: 'Threat and Error Management', durationMinutes: '40' },
      { buffer: PDF, name: '../../evil name.PDF' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.course.position, 1);
    assert.equal(res.body.course.material.type, 'pdf');
    assert.equal(res.body.course.durationMinutes, 40);
    const added = storedFiles().filter(f => !before.includes(f));
    assert.equal(added.length, 1);
    assert.match(added[0], /^[0-9a-f-]{36}\.pdf$/);
    course.pdf = res.body.course.id;
  });

  await t.test('create with a link, and with no material', async () => {
    const link = await trainer.post('/api/courses',
      { planId: plans.crm, name: 'CRM Video Lecture', link: 'https://example.com/crm' });
    assert.equal(link.status, 201);
    assert.equal(link.body.course.position, 2);
    assert.equal(link.body.course.material.type, 'link');
    course.link = link.body.course.id;

    const empty = await trainer.post('/api/courses', { planId: plans.crm, name: 'Classroom Session' });
    assert.equal(empty.status, 201);
    assert.equal(empty.body.course.material, null);
    assert.equal(empty.body.course.position, 3);
    course.empty = empty.body.course.id;
  });

  await t.test('DOCX accepted', async () => {
    const res = await trainer.upload('post', '/api/courses',
      { planId: plans.adminPlan, name: 'Checklist' }, { buffer: DOCX, name: 'checklist.docx' });
    assert.equal(res.status, 201);
    assert.equal(res.body.course.material.type, 'docx');
  });

  await t.test('wrong type, fake content, too large → refused, nothing left on disk', async () => {
    const before = storedFiles();
    const fields = { planId: plans.crm, name: 'Bad upload' };

    const exe = await trainer.upload('post', '/api/courses', fields, { buffer: NOT_A_PDF, name: 'setup.exe' });
    assert.equal(exe.status, 400);
    assert.equal(exe.body.error.code, 'FILE_TYPE_NOT_ALLOWED');

    const fake = await trainer.upload('post', '/api/courses', fields, { buffer: NOT_A_PDF, name: 'report.pdf' });
    assert.equal(fake.status, 400);
    assert.equal(fake.body.error.code, 'FILE_CONTENT_MISMATCH');

    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10)]);
    const tooBig = await trainer.upload('post', '/api/courses', fields, { buffer: big, name: 'big.pdf' });
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.error.code, 'FILE_TOO_LARGE');

    // A valid file but an invalid field: the saved file must be removed again
    const badName = await trainer.upload('post', '/api/courses',
      { planId: plans.crm, name: 'x' }, { buffer: PDF, name: 'ok.pdf' });
    assert.equal(badName.status, 400);

    assert.deepEqual(storedFiles(), before);
  });

  await t.test('field validation → 400', async () => {
    const bad = [
      { name: 'No plan' },
      { planId: RANDOM_UUID, name: 'Unknown plan' },
      { planId: plans.crm, name: 'Bad link', link: 'javascript:alert(1)' },
      { planId: plans.crm, name: 'Bad link', link: 'not a url' },
      { planId: plans.crm, name: 'Bad duration', durationMinutes: 'ninety' },
      { planId: plans.crm, name: 'Bad duration', durationMinutes: 0 },
    ];
    for (const body of bad) {
      const res = await trainer.post('/api/courses', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const both = await trainer.upload('post', '/api/courses',
      { planId: plans.crm, name: 'Both', link: 'https://example.com' }, { buffer: PDF, name: 'a.pdf' });
    assert.equal(both.status, 400);
  });

  await t.test('download the stored file', async () => {
    const res = await trainer.get(`/api/courses/${course.pdf}/material`).buffer(true);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/pdf/);
    assert.match(res.headers['content-disposition'], /Threat-and-Error-Management\.pdf/);
    assert.equal(Buffer.from(res.body).subarray(0, 5).toString(), '%PDF-');
    const link = await trainer.get(`/api/courses/${course.link}/material`);
    assert.equal(link.status, 404);
    assert.equal(link.body.error.code, 'NO_FILE');
  });

  await t.test('PATCH: rename, then replace the file with a link → old file deleted', async () => {
    const before = await auditCount('COURSE_UPDATED');
    const renamed = await trainer.patch(`/api/courses/${course.pdf}`, { name: 'TEM Basics' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.course.name, 'TEM Basics');

    const filesBefore = storedFiles().length;
    const swapped = await trainer.patch(`/api/courses/${course.pdf}`, { link: 'https://example.com/tem' });
    assert.equal(swapped.status, 200);
    assert.equal(swapped.body.course.material.type, 'link');
    assert.equal(storedFiles().length, filesBefore - 1);
    assert.equal(await auditCount('COURSE_UPDATED'), before + 2);
  });

  await t.test('PATCH: upload a file to a course, then remove its material', async () => {
    const up = await trainer.upload('patch', `/api/courses/${course.empty}`, {}, { buffer: PDF, name: 'slides.pdf' });
    assert.equal(up.status, 200);
    assert.equal(up.body.course.material.type, 'pdf');
    const filesBefore = storedFiles().length;
    const cleared = await trainer.patch(`/api/courses/${course.empty}`, { link: '' });
    assert.equal(cleared.body.course.material, null);
    assert.equal(storedFiles().length, filesBefore - 1);
  });

  await t.test('PATCH validation', async () => {
    assert.equal((await trainer.patch(`/api/courses/${course.link}`, {})).status, 400);
    assert.equal((await trainer.patch(`/api/courses/${course.link}`, { planId: plans.adminPlan })).status, 400);
    assert.equal((await trainer.patch(`/api/courses/${RANDOM_UUID}`, { name: 'Ghost course' })).status, 404);
  });

  await t.test('reorder the plan', async () => {
    const order = [course.empty, course.pdf, course.link];
    const res = await trainer.put(`/api/plans/${plans.crm}/order`, { courseIds: order });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.courses.map(c => c.id), order);
    assert.deepEqual(res.body.courses.map(c => c.position), [1, 2, 3]);
  });

  await t.test('reorder must list every course exactly once', async () => {
    const url = `/api/plans/${plans.crm}/order`;
    for (const courseIds of [[course.pdf, course.link], [course.pdf, course.pdf, course.link], 'x', [RANDOM_UUID, course.pdf, course.link]]) {
      assert.equal((await trainer.put(url, { courseIds })).status, 400, JSON.stringify(courseIds));
    }
  });

  await t.test('delete a course with trainee progress → 409', async () => {
    const seeded = (await trainer.get(`/api/plans/${plans['Cabin Safety Recurrent 2026']}`)).body.courses[0];
    assert.ok(seeded.startedCount > 0);
    const res = await trainer.delete(`/api/courses/${seeded.id}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'COURSE_HAS_PROGRESS');
  });

  await t.test('delete an unused course → 204, positions close the gap', async () => {
    const res = await trainer.delete(`/api/courses/${course.empty}`);
    assert.equal(res.status, 204);
    const plan = await trainer.get(`/api/plans/${plans.crm}`);
    assert.deepEqual(plan.body.courses.map(c => [c.id, c.position]), [[course.pdf, 1], [course.link, 2]]);
    assert.equal((await trainer.delete(`/api/courses/${course.empty}`)).status, 404);
  });
});

// ---------------------------------------------------------------------
test('assign plans (FR8)', async (t) => {
  const trainer = as('trainer@rj.com');
  const url = () => `/api/plans/${plans.crm}/assignments`;

  await t.test('assign individual trainees', async () => {
    const before = await auditCount('PLAN_ASSIGNED');
    const res = await trainer.post(url(), { traineeIds: [ids['trainee@rj.com'], ids['trainee2@rj.com']] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.assigned.map(a => a.fullName).sort(), ['Lina Saleh', 'Omar Khalil']);
    assert.deepEqual(res.body.alreadyAssigned, []);
    assert.equal(await auditCount('PLAN_ASSIGNED'), before + 2);
  });

  await t.test('assigning again skips duplicates', async () => {
    const res = await trainer.post(url(), { traineeIds: [ids['trainee@rj.com']] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.assigned, []);
    assert.deepEqual(res.body.alreadyAssigned.map(a => a.fullName), ['Omar Khalil']);
  });

  await t.test('assign a department: only its active trainees, duplicates skipped', async () => {
    const depts = (await trainer.get('/api/departments')).body.departments;
    const cabinCrew = depts.find(d => d.name === 'Cabin Crew').id;
    const res = await trainer.post(url(), { departmentId: cabinCrew });
    assert.equal(res.status, 200);
    // Cabin Crew: Omar (already assigned) + Sami (invited, still active)
    assert.deepEqual(res.body.assigned.map(a => a.fullName), ['Sami Odeh']);
    assert.deepEqual(res.body.alreadyAssigned.map(a => a.fullName), ['Omar Khalil']);

    const training = depts.find(d => d.name === 'Training & Development').id;
    const none = await trainer.post(url(), { departmentId: training });
    assert.equal(none.status, 400);
    assert.equal(none.body.error.code, 'NO_TRAINEES');
  });

  await t.test('only active trainees can be assigned', async () => {
    for (const email of ['trainer@rj.com', 'huda.mansour@rj.com']) {
      const res = await trainer.post(url(), { traineeIds: [ids[email]] });
      assert.equal(res.status, 400, email);
      assert.equal(res.body.error.code, 'INVALID_TRAINEES');
    }
  });

  await t.test('request validation', async () => {
    for (const body of [{}, { traineeIds: [] }, { traineeIds: ['abc'] },
      { traineeIds: [ids['trainee@rj.com']], departmentId: RANDOM_UUID }, { departmentId: 'abc' }]) {
      assert.equal((await trainer.post(url(), body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await trainer.post(`/api/plans/${RANDOM_UUID}/assignments`, { traineeIds: [ids['trainee@rj.com']] })).status, 404);
  });

  await t.test('a plan past its due date cannot be assigned', async () => {
    const res = await trainer.post(`/api/plans/${plans['Aviation Security Refresher']}/assignments`,
      { traineeIds: [ids['trainee2@rj.com']] });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PLAN_PAST_DUE');
  });

  await t.test('the database itself refuses a duplicate assignment', async () => {
    await assert.rejects(
      db.query('INSERT INTO plan_assignments (plan_id, trainee_id) VALUES ($1, $2)', [plans.crm, ids['trainee@rj.com']]),
      err => err.code === '23505');
  });
});

// ---------------------------------------------------------------------
test('progress (FR9)', async (t) => {
  const trainer = as('trainer@rj.com');

  await t.test('per plan: completion, overdue and status', async () => {
    const res = await trainer.get(`/api/plans/${plans['Aviation Security Refresher']}/progress`);
    assert.equal(res.status, 200);
    assert.equal(res.body.plan.name, 'Aviation Security Refresher');
    assert.deepEqual(res.body.summary, {
      assignedCount: 2, completedCount: 1, overdueCount: 1, notStartedCount: 0, avgCompletion: 80,
    });
    const [first, second] = res.body.trainees;
    assert.equal(first.fullName, 'Yousef Nasser', 'overdue trainees come first');
    assert.equal(first.status, 'overdue');
    assert.equal(first.overdue, true);
    assert.equal(first.completionPct, 60);
    assert.equal(first.completedCourses, 1);
    assert.equal(first.totalCourses, 2);
    assert.ok(first.lastActivityAt);
    assert.equal(second.status, 'completed');
    assert.equal(second.overdue, false);
  });

  await t.test('a course with no progress row counts as 0%', async () => {
    const res = await trainer.get(`/api/plans/${plans['Cabin Safety Recurrent 2026']}/progress`);
    const omar = res.body.trainees.find(tr => tr.fullName === 'Omar Khalil');
    assert.equal(omar.completionPct, 65);          // (100 + 100 + 60 + 0) / 4
    assert.equal(omar.status, 'in_progress');
  });

  await t.test('newly assigned trainees are not started', async () => {
    const res = await trainer.get(`/api/plans/${plans.crm}/progress`);
    assert.equal(res.body.summary.assignedCount, 3);
    assert.equal(res.body.summary.notStartedCount, 3);
    assert.ok(res.body.trainees.every(tr => tr.status === 'not_started' && tr.completionPct === 0));
  });

  await t.test('404 for an unknown plan', async () => {
    assert.equal((await trainer.get(`/api/plans/${RANDOM_UUID}/progress`)).status, 404);
  });

  await t.test('trainees list: overdue first, assignedToPlan flag, no deactivated accounts', async () => {
    const res = await trainer.get(`/api/trainees?planId=${plans.crm}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.trainees[0].fullName, 'Yousef Nasser');
    assert.equal(res.body.trainees[0].overdueCount, 1);
    assert.ok(!res.body.trainees.some(tr => tr.email === 'huda.mansour@rj.com'));
    const byName = Object.fromEntries(res.body.trainees.map(tr => [tr.fullName, tr]));
    assert.equal(byName['Omar Khalil'].assignedToPlan, true);
    assert.equal(byName['Yousef Nasser'].assignedToPlan, false);
    assert.equal(byName['Omar Khalil'].planCount, 4);

    const search = await trainer.get('/api/trainees?search=lina');
    assert.deepEqual(search.body.trainees.map(tr => tr.fullName), ['Lina Saleh']);
    assert.equal(search.body.trainees[0].assignedToPlan, undefined);
  });

  await t.test('one trainee: plans with per-course detail', async () => {
    const res = await trainer.get(`/api/trainees/${ids['trainee3@rj.com']}/progress`);
    assert.equal(res.status, 200);
    assert.equal(res.body.trainee.fullName, 'Yousef Nasser');
    const avsec = res.body.plans.find(p => p.planName === 'Aviation Security Refresher');
    assert.equal(avsec.status, 'overdue');
    assert.deepEqual(avsec.courses.map(c => [c.position, c.completionPct]), [[1, 100], [2, 20]]);
    assert.equal((await trainer.get(`/api/trainees/${ids['trainer@rj.com']}/progress`)).status, 404);
    assert.equal((await trainer.get(`/api/trainees/${ids['huda.mansour@rj.com']}/progress`)).status, 404);
  });
});

// ---------------------------------------------------------------------
test('unassign and delete plans', async (t) => {
  const trainer = as('trainer@rj.com');

  await t.test('unassign → 204, progress rows kept, second time 404', async () => {
    const planId = plans['Customer Service Excellence'];
    const lina = ids['trainee2@rj.com'];
    const before = await db.query('SELECT COUNT(*)::int AS n FROM progress WHERE trainee_id = $1', [lina]);
    const res = await trainer.delete(`/api/plans/${planId}/assignments/${lina}`);
    assert.equal(res.status, 204);
    const after = await db.query('SELECT COUNT(*)::int AS n FROM progress WHERE trainee_id = $1', [lina]);
    assert.equal(after.rows[0].n, before.rows[0].n);
    assert.equal((await trainer.delete(`/api/plans/${planId}/assignments/${lina}`)).status, 404);
    assert.ok(await auditCount('PLAN_UNASSIGNED') >= 1);
  });

  await t.test('a plan with assignments cannot be deleted', async () => {
    const res = await trainer.delete(`/api/plans/${plans.crm}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PLAN_HAS_ASSIGNMENTS');
  });

  await t.test('a plan whose courses have progress cannot be deleted', async () => {
    // Nobody is assigned any more, but Lina's progress is still there.
    const planId = plans['Customer Service Excellence'];
    await trainer.delete(`/api/plans/${planId}/assignments/${ids['trainee@rj.com']}`);
    const res = await trainer.delete(`/api/plans/${planId}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PLAN_HAS_PROGRESS');
  });

  await t.test('an unused plan is deleted with its courses and files', async () => {
    const filesBefore = storedFiles().length;
    const res = await trainer.delete(`/api/plans/${plans.adminPlan}`);
    assert.equal(res.status, 204);
    assert.equal(storedFiles().length, filesBefore - 1);   // its DOCX
    const left = await db.query('SELECT COUNT(*)::int AS n FROM courses WHERE plan_id = $1', [plans.adminPlan]);
    assert.equal(left.rows[0].n, 0);
    assert.equal((await trainer.get(`/api/plans/${plans.adminPlan}`)).status, 404);
  });
});

// ---------------------------------------------------------------------
test('audit log covers training actions (FR2)', async () => {
  const res = await as('admin@rj.com').get('/api/audit-logs?action=PLAN_ASSIGNED');
  assert.equal(res.status, 200);
  assert.ok(res.body.entries.every(e => e.target && e.details.planName));
  for (const action of ['COURSE_CREATED', 'COURSE_UPDATED', 'COURSE_DELETED',
    'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_DELETED', 'PLAN_ASSIGNED', 'PLAN_UNASSIGNED']) {
    assert.ok(await auditCount(action) > 0, action);
  }
});
