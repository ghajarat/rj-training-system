// Phase 6 tests: dashboard suggestions. The rules and the parsing of the LLM's
// answer are tested directly; the API is tested with AI_FAKE=1 (no keys, no cost).
//
//   npm test
//
// WARNING: re-runs the migrations and the seed first, so it WIPES the
// database in DATABASE_URL. Dev only.
process.env.AI_FAKE = '1';

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const request = require('supertest');

const ROOT = path.join(__dirname, '..');
const PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';
const URL = '/api/me/recommendations';

const llm = require('../services/ai/llm');
const { pickCandidates, parseReasons, clearCache, MAX_SUGGESTIONS } = require('../services/recommendations');

// ---------------------------------------------------------------------
// Rules (no database)
// ---------------------------------------------------------------------

const NOW = new Date(2026, 5, 15);   // 15 June 2026

let nextId = 0;
function course(status = 'not_started', completionPct = 0) {
  nextId += 1;
  return { id: `c${nextId}`, name: `Course ${nextId}`, status, completionPct };
}

function plan(name, dueDate, courses, extra = {}) {
  return {
    planId: `plan-${name}`,
    planName: name,
    dueDate,
    upcoming: false,
    overdue: false,
    status: 'in_progress',
    totalCourses: courses.length,
    courses,
    ...extra,
  };
}

const FAR = '2026-12-31';

test('rules: the most urgent kind comes first', () => {
  const picked = pickCandidates([
    plan('Later', FAR, [course('in_progress', 50)]),
    plan('Soon', '2026-06-20', [course()]),
    plan('Late', '2026-06-01', [course()], { overdue: true, status: 'overdue' }),
  ], [], NOW);
  assert.deepEqual(picked.map(c => c.kind), ['overdue', 'due_soon', 'continue']);
  assert.match(picked[0].reason, /overdue by 14 days/);
  assert.match(picked[1].reason, /due in 5 days/);
});

test('rules: a plan offers its first unfinished course, in plan order', () => {
  const second = course();
  const picked = pickCandidates([plan('P', FAR, [course('completed', 100), second, course()])], [], NOW);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].courseId, second.id);
  assert.equal(picked[0].kind, 'next');
});

test('rules: finished, empty and not-yet-begun plans offer nothing', () => {
  const picked = pickCandidates([
    plan('Done', FAR, [course('completed', 100)], { status: 'completed' }),
    plan('Empty', FAR, []),
    plan('Upcoming', FAR, [course()], { upcoming: true, status: 'not_started' }),
  ], [], NOW);
  assert.deepEqual(picked, []);
});

test('rules: an upcoming plan the trainee already opened still counts', () => {
  const picked = pickCandidates([plan('Upcoming', FAR, [course('started')], { upcoming: true })], [], NOW);
  assert.equal(picked[0].kind, 'continue');
});

test('rules: a course asked about is suggested unless it is finished or upcoming', () => {
  const asked = course();
  const finished = course('completed', 100);
  const future = course();
  const picked = pickCandidates([
    plan('P', FAR, [finished, course(), asked]),
    plan('F', FAR, [future], { upcoming: true }),
  ], [asked.id, finished.id, future.id], NOW);
  assert.deepEqual(picked.map(c => c.kind), ['asked_about', 'next']);
  assert.equal(picked[0].courseId, asked.id);
});

test('rules: a course offered twice keeps its more urgent reason', () => {
  const c = course();
  const picked = pickCandidates([plan('P', '2026-06-20', [c])], [c.id], NOW);
  assert.deepEqual(picked.map(x => x.kind), ['due_soon']);
});

test('rules: never more than the maximum', () => {
  const plans = Array.from({ length: 6 }, (_, i) => plan(`P${i}`, FAR, [course()]));
  assert.equal(pickCandidates(plans, [], NOW).length, MAX_SUGGESTIONS);
});

// ---------------------------------------------------------------------
// The LLM's answer (no database)
// ---------------------------------------------------------------------

test('parseReasons: maps by id, whatever the order, and tidies spaces', () => {
  const text = '[{"id":2,"reason":"Second."},{"id":1,"reason":" First\\n one. "}]';
  assert.deepEqual(parseReasons(text, 2), ['First one.', 'Second.']);
});

test('parseReasons: accepts a code fence', () => {
  assert.deepEqual(parseReasons('```json\n[{"id":1,"reason":"Fine."}]\n```', 1), ['Fine.']);
});

test('parseReasons: rejects anything else', () => {
  const bad = {
    'not JSON': 'Here you go!',
    'not a list': '{"id":1,"reason":"x"}',
    'too few': '[{"id":1,"reason":"x"}]',
    'too many': '[{"id":1,"reason":"x"},{"id":2,"reason":"y"},{"id":3,"reason":"z"}]',
    'an id that was not asked for': '[{"id":1,"reason":"x"},{"id":7,"reason":"y"}]',
    'a repeated id': '[{"id":1,"reason":"x"},{"id":1,"reason":"y"}]',
    'an empty reason': '[{"id":1,"reason":"x"},{"id":2,"reason":"  "}]',
    'a reason that is not text': '[{"id":1,"reason":"x"},{"id":2,"reason":5}]',
    'a very long reason': JSON.stringify([{ id: 1, reason: 'x' }, { id: 2, reason: 'y'.repeat(201) }]),
    'a null item': '[{"id":1,"reason":"x"},null]',
  };
  for (const [name, text] of Object.entries(bad)) {
    assert.equal(parseReasons(text, 2), null, name);
  }
});

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

let app;
let db;
const tokens = {};
const ids = {};

const get = email => request(app).get(URL).set({ Authorization: `Bearer ${tokens[email]}` });

async function coursesOf(traineeEmail) {
  const { rows } = await db.query(
    `SELECT c.course_id FROM courses c
       JOIN plan_assignments pa ON pa.plan_id = c.plan_id
      WHERE pa.trainee_id = $1`,
    [ids[traineeEmail]]);
  return rows.map(r => r.course_id);
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
  (await db.query('SELECT user_id, email FROM users')).rows.forEach((r) => { ids[r.email] = r.user_id; });
});

after(async () => {
  await db.pool.end();
});

beforeEach(() => {
  clearCache();
  mock.restoreAll();
});

test('API: signed-out and staff are refused', async () => {
  assert.equal((await request(app).get(URL)).status, 401);
  assert.equal((await get('trainer@rj.com')).status, 403);
  assert.equal((await get('admin@rj.com')).status, 403);
});

test('API: suggests only the trainee\'s own unfinished courses, with AI reasons', async () => {
  const res = await get('trainee@rj.com');
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'ai');
  assert.ok(res.body.suggestions.length > 0 && res.body.suggestions.length <= MAX_SUGGESTIONS);

  const mine = await coursesOf('trainee@rj.com');
  const { rows: finished } = await db.query(
    'SELECT course_id FROM progress WHERE trainee_id = $1 AND completion_pct = 100', [ids['trainee@rj.com']]);
  for (const s of res.body.suggestions) {
    assert.ok(mine.includes(s.courseId), 'a course from my plans');
    assert.ok(!finished.some(f => f.course_id === s.courseId), 'not a finished course');
    assert.equal(s.reason, `Fake AI reason for ${s.courseName}.`);
    assert.ok(s.courseName && s.planId && s.planName && s.dueDate && s.kind);
  }
});

test('API: a trainee with everything finished gets none, and no LLM call', async () => {
  const generate = mock.method(llm, 'generate', llm.generate);
  const res = await get('trainee2@rj.com');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.suggestions, []);
  assert.equal(generate.mock.callCount(), 0);
});

test('API: falls back to the rules when the LLM fails, refuses or answers badly', async () => {
  const answers = {
    fails: async () => { throw new Error('down'); },
    refuses: async () => ({ text: '', refused: true }),
    'answers badly': async () => ({ text: 'Sure! Here are some courses.', refused: false }),
  };
  const logged = mock.method(console, 'error', () => {});
  for (const [name, fake] of Object.entries(answers)) {
    clearCache();
    mock.method(llm, 'generate', fake);
    const res = await get('trainee@rj.com');
    assert.equal(res.status, 200, name);
    assert.equal(res.body.source, 'rules', name);
    assert.ok(res.body.suggestions.length > 0, name);
    assert.ok(res.body.suggestions.every(s => s.reason && !s.reason.startsWith('Fake AI')), name);
  }
  logged.mock.restore();
});

test('API: the LLM is asked once, and again only when progress changes', async () => {
  const generate = mock.method(llm, 'generate', llm.generate);
  const [first] = (await get('trainee@rj.com')).body.suggestions;
  await get('trainee@rj.com');
  assert.equal(generate.mock.callCount(), 1);

  const res = await request(app).put(`/api/me/courses/${first.courseId}/progress`)
    .set({ Authorization: `Bearer ${tokens['trainee@rj.com']}` }).send({ completionPct: 75 });
  assert.equal(res.status, 200);
  await get('trainee@rj.com');
  assert.equal(generate.mock.callCount(), 2);
});

test('API: a course the assistant linked to my question is suggested', async () => {
  // Lina has finished her plan, so give her a new plan with two open courses:
  // the second would not be suggested without the chat link.
  const created = await db.query(
    `INSERT INTO training_plans (created_by, plan_name, start_date, end_date)
     VALUES ($1, 'Phase 6 test plan', '2020-01-01', '2099-01-01') RETURNING plan_id`,
    [ids['trainer@rj.com']]);
  const planId = created.rows[0].plan_id;
  const inserted = await db.query(
    `INSERT INTO courses (plan_id, course_name, sequence_order)
     VALUES ($1, 'Open first', 1), ($1, 'Open second', 2) RETURNING course_id, course_name`,
    [planId]);
  const second = inserted.rows.find(r => r.course_name === 'Open second').course_id;
  await db.query('INSERT INTO plan_assignments (plan_id, trainee_id) VALUES ($1, $2)', [planId, ids['trainee2@rj.com']]);

  let names = (await get('trainee2@rj.com')).body.suggestions.map(s => s.courseName);
  assert.deepEqual(names, ['Open first']);

  const session = await db.query(
    'INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING session_id', [ids['trainee2@rj.com']]);
  await db.query(
    `INSERT INTO chat_messages (session_id, sender_role, message_text, related_course_ids)
     VALUES ($1, 'bot', 'An answer.', $2::uuid[])`,
    [session.rows[0].session_id, [second]]);

  const res = await get('trainee2@rj.com');
  names = res.body.suggestions.map(s => s.courseName);
  assert.deepEqual(names, ['Open second', 'Open first']);
  assert.equal(res.body.suggestions[0].kind, 'asked_about');

  // Someone else's chat must not change Omar's suggestions.
  const omar = (await get('trainee@rj.com')).body.suggestions;
  assert.ok(!omar.some(s => s.courseId === second));
});
