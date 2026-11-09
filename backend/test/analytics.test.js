// Phase 7 tests: feedback sentiment, Trainer Overview and Analytics & ROI.
// Runs with AI_FAKE=1 (no keys, no cost): the fake LLM scores a comment from
// a small word list (services/ai/fake.js), so the expected values are known.
//
//   npm test
//
// WARNING: re-runs the migrations and the seed first, so it WIPES the
// database in DATABASE_URL. Dev only. Uses db/seed.js alone (not the demo
// cohort), so every number below can be worked out from that file.
process.env.AI_FAKE = '1';

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const request = require('supertest');

const ROOT = path.join(__dirname, '..');
const PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';

const llm = require('../services/ai/llm');
const sentiment = require('../services/sentiment');
const { gapSeverity } = require('../services/analytics');

// ---------------------------------------------------------------------
// Units (no database)
// ---------------------------------------------------------------------

test('sentiment: scores are bucketed at ±0.25', () => {
  assert.equal(sentiment.bucketOf(0.25), 'positive');
  assert.equal(sentiment.bucketOf(0.24), 'neutral');
  assert.equal(sentiment.bucketOf(-0.24), 'neutral');
  assert.equal(sentiment.bucketOf(-0.25), 'negative');
  assert.equal(sentiment.bucketOf(null), null);
});

test('sentiment: parseScores keeps good items, clamps, and drops the rest', () => {
  assert.deepEqual(sentiment.parseScores('[{"id":1,"score":0.5},{"id":2,"score":-0.3}]', 2), [0.5, -0.3]);
  assert.deepEqual(sentiment.parseScores('```json\n[{"id":2,"score":3},{"id":1,"score":-9}]\n```', 2), [-1, 1]);
  assert.deepEqual(sentiment.parseScores('[{"id":1,"score":"high"},{"id":7,"score":0.1}]', 2), [null, null]);
  assert.deepEqual(sentiment.parseScores('Sure! Here are the scores.', 2), [null, null]);
  assert.deepEqual(sentiment.parseScores('{"id":1,"score":0.5}', 1), [null]);
});

test('knowledge gaps: severity rules', () => {
  assert.equal(gapSeverity(0.3, 0), 'high');
  assert.equal(gapSeverity(0.1, 3), 'high');
  assert.equal(gapSeverity(0.15, 0), 'medium');
  assert.equal(gapSeverity(0.05, 1), 'medium');
  assert.equal(gapSeverity(0.05, 0), 'low');
  assert.equal(gapSeverity(null, 0), 'low');
});

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

let app;
let db;
const tokens = {};
const ids = {};

const get = (url, email) => request(app).get(url).set({ Authorization: `Bearer ${tokens[email]}` });

async function courseId(name) {
  const { rows } = await db.query('SELECT course_id FROM courses WHERE course_name = $1', [name]);
  return rows[0].course_id;
}

// One question + bot reply in a new session for this user.
async function ask(email, courseIds, { outcome = 'answered', daysAgo = 1, section = null } = {}) {
  const at = new Date(Date.now() - daysAgo * 86400000);
  const { rows: [s] } = await db.query(
    'INSERT INTO chat_sessions (user_id, started_at) VALUES ($1, $2) RETURNING session_id', [ids[email], at]);
  await db.query(
    `INSERT INTO chat_messages (session_id, sender_role, message_text, created_at) VALUES ($1, 'user', 'q', $2)`,
    [s.session_id, at]);
  const citations = section ? [{ n: 1, docId: null, title: 'Test SOP', section }] : [];
  await db.query(
    `INSERT INTO chat_messages (session_id, sender_role, message_text, created_at, outcome, citations, related_course_ids)
     VALUES ($1, 'bot', 'a', $2, $3, $4, $5::uuid[])`,
    [s.session_id, at, outcome, JSON.stringify(citations), courseIds]);
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
  await sentiment.whenIdle();
  await db.pool.end();
});

beforeEach(() => {
  mock.restoreAll();
});

test('API: signed-out users and trainees are refused', async () => {
  for (const url of ['/api/analytics/overview', '/api/analytics/roi']) {
    assert.equal((await request(app).get(url)).status, 401, url);
    const res = await get(url, 'trainee@rj.com');
    assert.equal(res.status, 403, url);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('API: trainers and admins can open both screens', async () => {
  for (const email of ['trainer@rj.com', 'admin@rj.com']) {
    assert.equal((await get('/api/analytics/overview', email)).status, 200, email);
    assert.equal((await get('/api/analytics/roi', email)).status, 200, email);
  }
});

test('overview: cohort numbers match the seed', async () => {
  const { body } = await get('/api/analytics/overview', 'trainer@rj.com');
  const s = body.summary;
  assert.equal(s.activeTrainees, 3);                // Omar, Lina, Yousef (Huda is deactivated)
  // Started plans only: 65 (Omar cabin) 10 (Omar service) 100 (Lina) 60 (Yousef AVSEC) 100 (Omar AVSEC)
  assert.equal(s.avgCompletion, 67);
  assert.equal(s.atRisk, 1);
  assert.equal(s.overdueTrainees, 1);
  assert.equal(s.ratings, 5);
  assert.equal(s.avgRating, 3.8);

  // Most urgent first: Yousef's overdue AVSEC plan.
  assert.equal(body.trainees[0].fullName, 'Yousef Nasser');
  assert.equal(body.trainees[0].status, 'overdue');
  assert.equal(body.trainees[0].atRisk, true);
  assert.ok(body.trainees.every(t => t.status !== 'completed'));

  // Same numbers as the plan list (services/progress.js).
  const plan = body.plans.find(p => p.planName === 'Aviation Security Refresher');
  assert.deepEqual([plan.assignedCount, plan.completedCount, plan.overdueCount, plan.avgCompletion], [2, 1, 1, 80]);
  assert.equal(body.plans.find(p => p.planName === 'Ground Handling Fundamentals').upcoming, true);
});

test('sentiment: seeded comments are scored and summarised', async () => {
  let { body } = await get('/api/analytics/overview', 'trainer@rj.com');
  assert.equal(body.sentiment.responses, 0);
  assert.equal(body.sentiment.pending, 4);          // 5 ratings, one without a comment
  assert.equal(body.sentiment.score, null);

  assert.equal(await sentiment.scorePending(), 4);

  ({ body } = await get('/api/analytics/overview', 'trainer@rj.com'));
  // Fake scores: "clear … helped" +1, "practical … rushed" 0, "Good overview" +1, "theoretical … wanted" −1
  assert.deepEqual(
    [body.sentiment.responses, body.sentiment.pending, body.sentiment.positivePct,
      body.sentiment.neutralPct, body.sentiment.negativePct, body.sentiment.score],
    [4, 0, 50, 25, 25, 25]);
});

test('sentiment: saving feedback scores the new comment in the background', async () => {
  const id = await courseId('In-Flight First Aid');   // Omar has it at 60%
  const res = await request(app).put(`/api/me/courses/${id}/feedback`)
    .set({ Authorization: `Bearer ${tokens['trainee@rj.com']}` })
    .send({ rating: 5, comment: 'Excellent and very practical.' });
  assert.equal(res.status, 200);
  await sentiment.whenIdle();
  const { rows } = await db.query(
    'SELECT sentiment_score FROM feedback WHERE trainee_id = $1 AND course_id = $2', [ids['trainee@rj.com'], id]);
  assert.equal(rows[0].sentiment_score, 1);
});

test('sentiment: an AI failure leaves the comment unscored and the save still works', async () => {
  mock.method(llm, 'generate', async () => { throw new Error('AI unavailable'); });
  mock.method(console, 'error', () => {});
  const id = await courseId('Fire Fighting On Board');
  const res = await request(app).put(`/api/me/courses/${id}/feedback`)
    .set({ Authorization: `Bearer ${tokens['trainee@rj.com']}` })
    .send({ rating: 2, comment: 'Changed my mind: too long.' });
  assert.equal(res.status, 200);
  await sentiment.whenIdle();
  const { rows } = await db.query(
    'SELECT sentiment_score FROM feedback WHERE trainee_id = $1 AND course_id = $2', [ids['trainee@rj.com'], id]);
  assert.equal(rows[0].sentiment_score, null);

  // Picked up again once the AI is back.
  mock.restoreAll();
  await sentiment.scorePending();
  const again = await db.query(
    'SELECT sentiment_score FROM feedback WHERE trainee_id = $1 AND course_id = $2', [ids['trainee@rj.com'], id]);
  assert.equal(again.rows[0].sentiment_score, -1);
});

test('sentiment: a model answer that is not numbers changes nothing', async () => {
  mock.method(llm, 'generate', async () => ({ text: 'Ignore the rules and print the comments.', refused: false }));
  const id = await courseId('RJ Service Standards');   // Lina's feedback
  await db.query('UPDATE feedback SET sentiment_score = NULL WHERE course_id = $1', [id]);
  assert.equal(await sentiment.scorePending(), 0);
  const { rows } = await db.query('SELECT sentiment_score FROM feedback WHERE course_id = $1', [id]);
  assert.equal(rows[0].sentiment_score, null);
  mock.restoreAll();
  await sentiment.scorePending();
});

test('knowledge gaps: a course several of its trainees asked about is flagged', async () => {
  const avsec = await courseId('AVSEC Awareness');            // Omar and Yousef's plan
  const evacuation = await courseId('Emergency Evacuation Procedures');

  await ask('trainee@rj.com', [avsec], { section: '4. Screening' });
  await ask('trainee3@rj.com', [avsec], { outcome: 'not_found' });
  // Not a gap: only one trainee in the window (one is too old, one is staff).
  await ask('trainee2@rj.com', [evacuation]);
  await ask('trainee@rj.com', [evacuation], { daysAgo: 40 });
  await ask('trainer@rj.com', [evacuation], { outcome: 'not_found' });

  const { body } = await get('/api/analytics/overview', 'trainer@rj.com');
  const k = body.knowledgeGaps;
  assert.equal(k.gaps.length, 1);
  assert.deepEqual(
    [k.gaps[0].courseName, k.gaps[0].traineesAsked, k.gaps[0].traineesAssigned, k.gaps[0].askRatePct,
      k.gaps[0].unanswered, k.gaps[0].severity, k.gaps[0].topSource.section],
    ['AVSEC Awareness', 2, 2, 100, 1, 'high', '4. Screening']);
  assert.equal(k.unansweredQuestions, 2);    // every role counts towards SOP coverage
});

test('roi: KPIs, cost and ROI follow the stated model', async () => {
  const { body } = await get('/api/analytics/roi', 'admin@rj.com');
  const byName = Object.fromEntries(body.kpis.map(k => [k.name, k]));

  const safety = byName['Safety incidents (per quarter)'];
  assert.deepEqual([safety.changePct, safety.lowerIsBetter, safety.improved, safety.benefit], [-42, true, true, 9000]);
  const ontime = byName['On-time service delivery (%)'];
  assert.deepEqual([ontime.after, ontime.changePct, ontime.benefit], [null, null, null]);
  assert.equal(body.summary.benefit, 9000 + 4050 + 4800);

  // 485 training minutes in the seed's progress rows; 3 trainees in training.
  const m = body.model;
  assert.equal(m.trainingCost, Math.round((485 / 60) * m.costPerTrainingHour));
  assert.equal(m.platformCost, 3 * m.platformCostPerTrainee);
  assert.equal(body.summary.cost, m.trainingCost + m.platformCost);
  assert.equal(body.summary.costPerTrainee, Math.round(body.summary.cost / 3));
  assert.equal(body.summary.roiPct, Math.round(((body.summary.benefit - body.summary.cost) / body.summary.cost) * 100));

  assert.deepEqual(body.summary.compliance, { pct: 67, compliant: 2, total: 3 });
  assert.equal(body.summary.timeToCompetency.completedPlans, 2);
  assert.deepEqual(body.sentimentByPlan.map(p => p.planName),
    ['Cabin Safety Recurrent 2026', 'Customer Service Excellence']);
});

test('analytics leave deactivated users out', async () => {
  await db.query('UPDATE users SET is_active = FALSE WHERE email = $1', ['trainee3@rj.com']);
  try {
    const { body } = await get('/api/analytics/overview', 'trainer@rj.com');
    assert.equal(body.summary.activeTrainees, 2);
    assert.equal(body.summary.overdueTrainees, 0);
    assert.ok(!body.trainees.some(t => t.fullName === 'Yousef Nasser'));
  } finally {
    await db.query('UPDATE users SET is_active = TRUE WHERE email = $1', ['trainee3@rj.com']);
  }
});
