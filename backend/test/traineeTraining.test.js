// Phase 4c API tests: a trainee's own plans and materials (FR4), progress
// (FR5) and feedback (FR6), and that a trainee can only reach their own data.
//
//   npm test
//
// WARNING: re-runs the migrations and the seed first, so it WIPES the
// database in DATABASE_URL and the files in uploads/materials/. Dev only.
//
// Seeded data used here (db/seed.js), for Omar Khalil (trainee@rj.com):
//   Cabin Safety Recurrent 2026    100, 100, 60, 0   course 1 = PDF, course 4 = web link,
//                                                    feedback on courses 1 and 2
//   Customer Service Excellence    30, 0, 0
//   Aviation Security Refresher    100, 100          finished (due date passed)
//   Ground Handling Fundamentals   0, 0              starts 1 Nov 2026: upcoming, never opened
// Lina Saleh (trainee2@rj.com) has only Customer Service Excellence, all 100.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const request = require('supertest');

const ROOT = path.join(__dirname, '..');
const PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';
const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

let app;
let db;
const tokens = {};
const ids = {};
const plans = {};     // plan name → id
const courses = {};   // plan name → [course id in plan order]

function as(email) {
  const auth = { Authorization: `Bearer ${tokens[email]}` };
  return {
    get: url => request(app).get(url).set(auth),
    put: (url, body) => request(app).put(url).set(auth).send(body),
    post: (url, body) => request(app).post(url).set(auth).send(body),
    delete: url => request(app).delete(url).set(auth),
  };
}

const omar = () => as('trainee@rj.com');
const lina = () => as('trainee2@rj.com');
const trainer = () => as('trainer@rj.com');

const CABIN = 'Cabin Safety Recurrent 2026';
const SERVICE = 'Customer Service Excellence';
const AVSEC = 'Aviation Security Refresher';
const GROUND = 'Ground Handling Fundamentals';

const progressUrl = id => `/api/me/courses/${id}/progress`;
const feedbackUrl = id => `/api/me/courses/${id}/feedback`;
const findPlan = (body, name) => body.plans.find(p => p.planName === name);

async function assignmentStatus(planName, email) {
  const { rows } = await db.query(
    'SELECT status FROM plan_assignments WHERE plan_id = $1 AND trainee_id = $2',
    [plans[planName], ids[email]]);
  return rows[0]?.status;
}

async function progressRow(email, courseId) {
  const { rows } = await db.query(
    'SELECT completion_pct, last_accessed FROM progress WHERE trainee_id = $1 AND course_id = $2',
    [ids[email], courseId]);
  return rows[0];
}

before(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run tests in production.');
  execFileSync('node', ['db/migrate.js'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('node', ['db/seed.js'], { cwd: ROOT, stdio: 'ignore' });

  app = require('../app');
  db = require('../db');

  for (const email of ['admin@rj.com', 'trainer@rj.com', 'trainee@rj.com', 'trainee2@rj.com']) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `seed login failed for ${email}`);
    tokens[email] = res.body.token;
  }
  (await db.query('SELECT user_id, email FROM users')).rows
    .forEach(r => { ids[r.email] = r.user_id; });
  (await db.query('SELECT plan_id, plan_name FROM training_plans')).rows
    .forEach(r => { plans[r.plan_name] = r.plan_id; });
  (await db.query('SELECT course_id, plan_id FROM courses ORDER BY sequence_order')).rows
    .forEach(r => {
      const name = Object.keys(plans).find(n => plans[n] === r.plan_id);
      (courses[name] ||= []).push(r.course_id);
    });
});

after(async () => {
  await db.pool.end();
});

// ---------------------------------------------------------------------
test('role-based access: /api/me is for trainees only (NFR07)', async (t) => {
  const urls = ['/api/me/plans', `/api/me/courses/${RANDOM_UUID}/material`];
  for (const url of urls) {
    await t.test(`no token on ${url} → 401`, async () => {
      assert.equal((await request(app).get(url)).status, 401);
    });
    for (const email of ['trainer@rj.com', 'admin@rj.com']) {
      await t.test(`${email} on ${url} → 403`, async () => {
        const res = await as(email).get(url);
        assert.equal(res.status, 403);
        assert.equal(res.body.error.code, 'FORBIDDEN');
      });
    }
  }
  await t.test('trainer cannot write progress or feedback → 403', async () => {
    assert.equal((await trainer().put(progressUrl(RANDOM_UUID), { completionPct: 50 })).status, 403);
    assert.equal((await trainer().put(feedbackUrl(RANDOM_UUID), { rating: 5 })).status, 403);
  });
});

// ---------------------------------------------------------------------
test('my plans (FR4, FR5)', async (t) => {
  let body;
  before(async () => {
    const res = await omar().get('/api/me/plans');
    assert.equal(res.status, 200);
    body = res.body;
  });

  await t.test('returns only my four assigned plans, sorted by due date', async () => {
    assert.deepEqual(body.plans.map(p => p.planName).sort(), [AVSEC, CABIN, SERVICE, GROUND].sort());
    const due = body.plans.map(p => p.dueDate);
    assert.deepEqual(due, [...due].sort());
  });

  await t.test('per-course status, material and my own feedback', async () => {
    const cabin = findPlan(body, CABIN);
    assert.equal(cabin.completionPct, 65);
    assert.deepEqual(cabin.courses.map(c => c.status), ['completed', 'completed', 'in_progress', 'not_started']);
    assert.equal(cabin.courses[0].material.type, 'pdf');
    assert.equal(cabin.courses[0].material.url, null);          // files only through the API
    assert.equal(cabin.courses[3].material.type, 'link');
    assert.match(cabin.courses[3].material.url, /^https:\/\//);
    assert.equal(cabin.courses[0].feedback.rating, 5);
    assert.equal(cabin.courses[2].feedback, null);
  });

  await t.test('no one else\'s feedback leaks in', async () => {
    // Lina rated every Customer Service course; Omar rated none of them.
    assert.ok(findPlan(body, SERVICE).courses.every(c => c.feedback === null));
  });

  await t.test('upcoming and completed plans are flagged', async () => {
    const ground = findPlan(body, GROUND);
    assert.equal(ground.upcoming, true);
    assert.equal(ground.status, 'not_started');
    assert.ok(ground.courses.every(c => c.status === 'not_started'));
    assert.equal(findPlan(body, AVSEC).status, 'completed');
    assert.equal(findPlan(body, AVSEC).overdue, false);
  });

  await t.test('summary agrees with the list', async () => {
    const s = body.summary;
    assert.equal(s.planCount, 4);
    assert.equal(s.openPlanCount, 3);
    assert.equal(s.overallPct, 43);                 // floor((65 + 10 + 100 + 0) / 4)
    assert.equal(s.completedCourses, 4);
    assert.equal(s.totalCourses, 11);
    assert.equal(s.completedMinutes, 90 + 60 + 45 + 30);
    const firstOpen = body.plans.find(p => p.status !== 'completed');
    assert.equal(s.nextDue.planName, firstOpen.planName);
  });

  await t.test('another trainee sees only their own plan', async () => {
    const res = await lina().get('/api/me/plans');
    assert.deepEqual(res.body.plans.map(p => p.planName), [SERVICE]);
    assert.ok(res.body.plans[0].courses.every(c => c.feedback !== null));
  });
});

// ---------------------------------------------------------------------
test('opening a material (FR4)', async (t) => {
  await t.test('my uploaded file downloads', async () => {
    const res = await omar().get(`/api/me/courses/${courses[CABIN][0]}/material`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/pdf/);
    assert.match(res.headers['content-disposition'], /attachment/);
  });

  await t.test('a course outside my plans is 404, as if it did not exist', async () => {
    const res = await lina().get(`/api/me/courses/${courses[CABIN][0]}/material`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COURSE_NOT_FOUND');
    const unknown = await lina().get(`/api/me/courses/${RANDOM_UUID}/material`);
    assert.equal(unknown.body.error.code, 'COURSE_NOT_FOUND');
  });

  await t.test('a web link or empty course has no file', async () => {
    const link = await omar().get(`/api/me/courses/${courses[CABIN][3]}/material`);
    assert.equal(link.status, 404);
    assert.equal(link.body.error.code, 'NO_FILE');
  });

  await t.test('malformed id → 400', async () => {
    assert.equal((await omar().get('/api/me/courses/not-a-uuid/material')).status, 400);
  });
});

// ---------------------------------------------------------------------
test('updating my progress (FR5)', async (t) => {
  const service = () => courses[SERVICE];

  await t.test('only 0, 25, 50, 75 or 100 are accepted', async () => {
    for (const completionPct of [33, -1, 101, 'abc', null, '', undefined]) {
      const res = await omar().put(progressUrl(service()[1]), { completionPct });
      assert.equal(res.status, 400, String(completionPct));
      assert.equal(res.body.error.code, 'VALIDATION');
    }
  });

  await t.test('0% on an unopened course marks it started', async () => {
    const res = await omar().put(progressUrl(courses[GROUND][0]), { completionPct: 0 });
    assert.equal(res.status, 200);
    assert.equal(findPlan(res.body, GROUND).courses[0].status, 'started');
    assert.equal(findPlan(res.body, GROUND).status, 'in_progress');
    assert.ok((await progressRow('trainee@rj.com', courses[GROUND][0])).last_accessed);
  });

  await t.test('in progress, then completed; the response carries fresh totals', async () => {
    let res = await omar().put(progressUrl(service()[1]), { completionPct: 50 });
    assert.equal(findPlan(res.body, SERVICE).courses[1].status, 'in_progress');
    res = await omar().put(progressUrl(service()[1]), { completionPct: 100 });
    assert.equal(findPlan(res.body, SERVICE).courses[1].status, 'completed');
    assert.equal(findPlan(res.body, SERVICE).completionPct, 43);   // floor((30 + 100 + 0) / 3)
    assert.equal(res.body.summary.completedCourses, 5);
  });

  await t.test('finishing every course completes the plan assignment', async () => {
    await omar().put(progressUrl(service()[0]), { completionPct: 100 });
    const res = await omar().put(progressUrl(service()[2]), { completionPct: 100 });
    assert.equal(findPlan(res.body, SERVICE).status, 'completed');
    assert.equal(await assignmentStatus(SERVICE, 'trainee@rj.com'), 'completed');
  });

  await t.test('moving back reopens it (decision 2)', async () => {
    const res = await omar().put(progressUrl(service()[2]), { completionPct: 75 });
    assert.equal(findPlan(res.body, SERVICE).status, 'in_progress');
    assert.equal(await assignmentStatus(SERVICE, 'trainee@rj.com'), 'active');
    await omar().put(progressUrl(service()[2]), { completionPct: 100 });
  });

  await t.test('my changes never touch another trainee\'s row', async () => {
    assert.equal((await progressRow('trainee2@rj.com', service()[2])).completion_pct, 100);
    await lina().put(progressUrl(service()[2]), { completionPct: 25 });
    assert.equal((await progressRow('trainee@rj.com', service()[2])).completion_pct, 100);
    await lina().put(progressUrl(service()[2]), { completionPct: 100 });
  });

  await t.test('a course outside my plans → 404', async () => {
    const res = await lina().put(progressUrl(courses[CABIN][2]), { completionPct: 100 });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COURSE_NOT_FOUND');
    assert.equal((await progressRow('trainee2@rj.com', courses[CABIN][2])), undefined);
  });
});

// ---------------------------------------------------------------------
test('plan completion follows trainer changes (FR5)', async (t) => {
  let extraCourseId;

  await t.test('a new course reopens a finished plan', async () => {
    assert.equal(await assignmentStatus(AVSEC, 'trainee@rj.com'), 'completed');
    const res = await trainer().post('/api/courses', { planId: plans[AVSEC], name: 'Insider Threat Basics' });
    assert.equal(res.status, 201);
    extraCourseId = res.body.course.id;
    assert.equal(await assignmentStatus(AVSEC, 'trainee@rj.com'), 'active');
  });

  await t.test('deleting it completes the plan again', async () => {
    assert.equal((await trainer().delete(`/api/courses/${extraCourseId}`)).status, 204);
    assert.equal(await assignmentStatus(AVSEC, 'trainee@rj.com'), 'completed');
  });

  await t.test('unassigned: access is gone; re-assigned: progress and status come back', async () => {
    assert.equal((await trainer().delete(`/api/plans/${plans[SERVICE]}/assignments/${ids['trainee@rj.com']}`)).status, 204);
    const gone = await omar().get(`/api/me/courses/${courses[SERVICE][0]}/material`);
    assert.equal(gone.body.error.code, 'COURSE_NOT_FOUND');
    assert.equal((await omar().put(progressUrl(courses[SERVICE][0]), { completionPct: 50 })).status, 404);

    const res = await trainer().post(`/api/plans/${plans[SERVICE]}/assignments`, { traineeIds: [ids['trainee@rj.com']] });
    assert.equal(res.status, 200);
    assert.equal(await assignmentStatus(SERVICE, 'trainee@rj.com'), 'completed');
  });
});

// ---------------------------------------------------------------------
test('feedback on a course (FR6)', async (t) => {
  const course = () => courses[CABIN][2];   // 60%, no feedback yet

  await t.test('validation', async () => {
    const bad = [
      { rating: 0 }, { rating: 6 }, { rating: 3.5 }, { rating: 'five' }, {},
      { rating: 4, comment: 'x'.repeat(2001) }, { rating: 4, comment: 42 },
    ];
    for (const body of bad) {
      const res = await omar().put(feedbackUrl(course()), body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
      assert.equal(res.body.error.code, 'VALIDATION');
    }
  });

  await t.test('refused until the course is started (decision 3)', async () => {
    const res = await omar().put(feedbackUrl(courses[GROUND][1]), { rating: 4 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'COURSE_NOT_STARTED');
  });

  await t.test('saved as written (only the ends trimmed)', async () => {
    const res = await omar().put(feedbackUrl(course()), { rating: 4, comment: '  Good pace.\nThe quiz  was hard!  ' });
    assert.equal(res.status, 200);
    assert.deepEqual(findPlan(res.body, CABIN).courses[2].feedback,
      { rating: 4, comment: 'Good pace.\nThe quiz  was hard!' });
  });

  await t.test('saving again edits the same row', async () => {
    await db.query('UPDATE feedback SET sentiment_score = 0.8 WHERE trainee_id = $1 AND course_id = $2',
      [ids['trainee@rj.com'], course()]);
    // Same comment, new rating: the sentiment score still applies.
    await omar().put(feedbackUrl(course()), { rating: 2, comment: 'Good pace.\nThe quiz  was hard!' });
    let { rows } = await db.query('SELECT rating, sentiment_score FROM feedback WHERE trainee_id = $1 AND course_id = $2',
      [ids['trainee@rj.com'], course()]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { rating: 2, sentiment_score: 0.8 });

    // New comment: scored again by Phase 7.
    await omar().put(feedbackUrl(course()), { rating: 2, comment: 'Changed my mind.' });
    ({ rows } = await db.query('SELECT sentiment_score FROM feedback WHERE trainee_id = $1 AND course_id = $2',
      [ids['trainee@rj.com'], course()]));
    assert.equal(rows[0].sentiment_score, null);
  });

  await t.test('an empty comment is stored as no comment', async () => {
    const res = await omar().put(feedbackUrl(course()), { rating: 3, comment: '   ' });
    assert.deepEqual(findPlan(res.body, CABIN).courses[2].feedback, { rating: 3, comment: null });
  });

  await t.test('the database allows one feedback per trainee and course (migration 003)', async () => {
    await assert.rejects(
      db.query('INSERT INTO feedback (trainee_id, course_id, rating) VALUES ($1, $2, 1)',
        [ids['trainee@rj.com'], course()]),
      /uq_feedback_trainee_course/);
  });

  await t.test('a course outside my plans → 404, nothing stored', async () => {
    const res = await lina().put(feedbackUrl(course()), { rating: 1 });
    assert.equal(res.status, 404);
    const { rows } = await db.query('SELECT 1 FROM feedback WHERE trainee_id = $1 AND course_id = $2',
      [ids['trainee2@rj.com'], course()]);
    assert.equal(rows.length, 0);
  });
});
