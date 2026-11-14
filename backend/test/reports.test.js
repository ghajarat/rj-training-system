// Phase 8 tests: reports and PDF/CSV export (FR17), and System Health.
//
//   npm test
//
// WARNING: re-runs the migrations and the seed first, so it WIPES the
// database in DATABASE_URL. Dev only. Uses db/seed.js alone (not the demo
// cohort), so the numbers can be worked out from that file.
process.env.AI_FAKE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const request = require('supertest');
const { PDFParse } = require('pdf-parse');

const ROOT = path.join(__dirname, '..');
const PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';

const reportExport = require('../services/reportExport');
const { worst } = require('../services/systemHealth');

// ---------------------------------------------------------------------
// Units (no database)
// ---------------------------------------------------------------------

test('export: values are formatted for people', () => {
  const f = reportExport.formatValue;
  assert.equal(f(null, 'int'), '-');
  assert.equal(f(12345, 'int'), '12,345');
  assert.equal(f(67, 'pct'), '67%');
  assert.equal(f(3.8, 'rating'), '3.8 / 5');
  assert.equal(f(25, 'score'), '+25');
  assert.equal(f(-25, 'score'), '-25');
  assert.equal(f(-42, 'change'), '-42%');
  assert.equal(f('2026-11-04', 'date'), '4 Nov 2026');
});

test('export: CSV cells are quoted and protected against formula injection', () => {
  const c = reportExport.csvCell;
  assert.equal(c('plain'), 'plain');
  assert.equal(c('a,b'), '"a,b"');
  assert.equal(c('say "hi"'), '"say ""hi"""');
  assert.equal(c('line\nbreak'), '"line\nbreak"');
  assert.equal(c('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(c('+1'), "'+1");
  assert.equal(c('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(c(-12), '-12');          // a real number stays a number
  assert.equal(c(null), '');
});

test('export: PDF text outside the built-in font is replaced, not garbled', () => {
  assert.equal(reportExport.pdfText('Café − 5 — ok'), 'Café - 5 — ok');
  assert.equal(reportExport.pdfText('عمر'), '???');
});

test('system health: overall status is the worst check', () => {
  assert.equal(worst(['ok', 'ok']), 'ok');
  assert.equal(worst(['ok', 'warning', 'ok']), 'warning');
  assert.equal(worst(['warning', 'error', 'ok']), 'error');
});

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

let app;
let db;
const tokens = {};

const get = (url, email) => request(app).get(url).set({ Authorization: `Bearer ${tokens[email]}` });

// Collects a binary response body into a Buffer.
function binary(res, cb) {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function pdfTextOf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

async function idOf(table, column, name) {
  const idColumn = { training_plans: 'plan_id', departments: 'dept_id' }[table];
  const { rows } = await db.query(`SELECT ${idColumn} AS id FROM ${table} WHERE ${column} = $1`, [name]);
  return rows[0].id;
}

before(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run tests in production.');
  execFileSync('node', ['db/migrate.js'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('node', ['db/seed.js'], { cwd: ROOT, stdio: 'ignore' });

  app = require('../app');
  db = require('../db');

  for (const email of ['admin@rj.com', 'trainer@rj.com', 'trainee@rj.com']) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `seed login failed for ${email}`);
    tokens[email] = res.body.token;
  }
});

after(async () => {
  await require('../services/sentiment').whenIdle();
  await db.pool.end();
});

test('reports: signed-out users and trainees are refused', async () => {
  for (const url of ['/api/reports', '/api/reports/cohort-progress', '/api/reports/cohort-progress/export']) {
    assert.equal((await request(app).get(url)).status, 401, url);
    const res = await get(url, 'trainee@rj.com');
    assert.equal(res.status, 403, url);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('reports: trainers and admins see the catalogue', async () => {
  for (const email of ['trainer@rj.com', 'admin@rj.com']) {
    const res = await get('/api/reports', email);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.reports.map(r => r.id),
      ['cohort-progress', 'plan-summary', 'feedback', 'roi', 'ai-usage']);
  }
});

test('reports: every report builds with the same shape', async () => {
  const { body: { reports } } = await get('/api/reports', 'trainer@rj.com');
  for (const r of reports) {
    const res = await get(`/api/reports/${r.id}`, 'trainer@rj.com');
    assert.equal(res.status, 200, r.id);
    const rep = res.body;
    assert.equal(rep.id, r.id);
    assert.ok(rep.title && rep.generatedAt, r.id);
    assert.ok(Array.isArray(rep.filters) && Array.isArray(rep.summary) && Array.isArray(rep.notes), r.id);
    for (const s of rep.sections) {
      for (const row of s.rows) {
        for (const c of s.columns) assert.ok(c.key in row, `${r.id}: ${s.title} row is missing ${c.key}`);
      }
    }
  }
});

test('reports: unknown report is 404', async () => {
  const res = await get('/api/reports/salaries', 'admin@rj.com');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'REPORT_NOT_FOUND');
  assert.equal((await get('/api/reports/salaries/export', 'admin@rj.com')).status, 404);
});

test('cohort progress: matches the seed and leaves out deactivated users', async () => {
  const { body } = await get('/api/reports/cohort-progress', 'trainer@rj.com');
  const rows = body.sections[0].rows;
  const names = new Set(rows.map(r => r.trainee));
  assert.deepEqual([...names].sort(), ['Lina Saleh', 'Omar Khalil', 'Yousef Nasser'].sort());
  assert.ok(!names.has('Huda Mansour'));
  // Overdue first: Yousef's Aviation Security plan.
  assert.equal(rows[0].trainee, 'Yousef Nasser');
  assert.equal(rows[0].status, 'Overdue');
  const summary = Object.fromEntries(body.summary.map(s => [s.label, s.value]));
  assert.equal(summary.Trainees, 3);
  assert.equal(summary['Plan assignments'], rows.length);
  assert.equal(summary.Overdue, 1);
});

test('cohort progress: filters narrow the rows and are named in the report', async () => {
  const planId = await idOf('training_plans', 'plan_name', 'Aviation Security Refresher');
  let res = await get(`/api/reports/cohort-progress?planId=${planId}`, 'trainer@rj.com');
  assert.equal(res.status, 200);
  assert.equal(res.body.sections[0].rows.length, 2);
  assert.ok(res.body.sections[0].rows.every(r => r.plan === 'Aviation Security Refresher'));
  assert.deepEqual(res.body.filters, [{ label: 'Plan', value: 'Aviation Security Refresher' }]);

  res = await get('/api/reports/cohort-progress?status=completed', 'trainer@rj.com');
  assert.ok(res.body.sections[0].rows.length > 0);
  assert.ok(res.body.sections[0].rows.every(r => r.status === 'Completed'));

  const deptId = await idOf('departments', 'dept_name', 'Ground Operations');
  res = await get(`/api/reports/cohort-progress?departmentId=${deptId}`, 'trainer@rj.com');
  assert.equal(res.status, 200);
  assert.ok(res.body.sections[0].rows.every(r => r.department === 'Ground Operations'));
});

test('cohort progress: bad filters are refused with a clear message', async () => {
  let res = await get('/api/reports/cohort-progress?planId=abc', 'trainer@rj.com');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION');

  res = await get('/api/reports/cohort-progress?planId=00000000-0000-4000-8000-000000000000', 'trainer@rj.com');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'PLAN_NOT_FOUND');

  res = await get('/api/reports/cohort-progress?departmentId=00000000-0000-4000-8000-000000000000', 'trainer@rj.com');
  assert.equal(res.body.error.code, 'DEPARTMENT_NOT_FOUND');

  res = await get('/api/reports/cohort-progress?status=lost', 'trainer@rj.com');
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /status must be one of/);
});

test('plan summary: agrees with the plan progress numbers', async () => {
  const { body } = await get('/api/reports/plan-summary', 'admin@rj.com');
  const avsec = body.sections[0].rows.find(r => r.plan === 'Aviation Security Refresher');
  assert.deepEqual([avsec.assigned, avsec.completed, avsec.overdue, avsec.avgCompletion], [2, 1, 1, 80]);
});

test('feedback: ratings per course, no comment text', async () => {
  const { body } = await get('/api/reports/feedback', 'trainer@rj.com');
  const summary = Object.fromEntries(body.summary.map(s => [s.label, s.value]));
  assert.equal(summary.Ratings, 5);
  assert.equal(summary['Average rating'], 3.8);
  assert.ok(!JSON.stringify(body).includes('helped'), 'comment text must not appear in a report');
  assert.ok(body.notes.some(n => /waiting for an AI score/.test(n)));
});

test('ROI: same figures as the Analytics & ROI page', async () => {
  const [{ body: rep }, { body: roi }] = await Promise.all([
    get('/api/reports/roi', 'admin@rj.com'),
    get('/api/analytics/roi', 'admin@rj.com'),
  ]);
  const summary = Object.fromEntries(rep.summary.map(s => [s.label, s.value]));
  assert.equal(summary['Training ROI'], roi.summary.roiPct);
  assert.equal(summary['Benefit (JOD)'], roi.summary.benefit);
  assert.equal(summary['Cost (JOD)'], roi.summary.cost);
  assert.equal(rep.sections[0].rows.length, roi.kpis.length);
  assert.ok(rep.notes.some(n => /demo assumptions/.test(n)));
});

test('AI usage: default period is the last 30 days; dates are checked', async () => {
  let res = await get('/api/reports/ai-usage', 'trainer@rj.com');
  assert.equal(res.status, 200);
  assert.match(res.body.filters[0].value, /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(res.body.sections[0].rows.map(r => r.role), ['Trainee', 'Trainer', 'Admin']);

  res = await get('/api/reports/ai-usage?from=2026-02-30', 'trainer@rj.com');
  assert.equal(res.status, 400);
  res = await get('/api/reports/ai-usage?from=2026-05-01&to=2026-04-01', 'trainer@rj.com');
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /on or before/);
  res = await get('/api/reports/ai-usage?from=2024-01-01&to=2026-01-01', 'trainer@rj.com');
  assert.equal(res.status, 400);
});

test('AI usage: counts questions by outcome, never their text', async () => {
  const { rows: [omar] } = await db.query(`SELECT user_id FROM users WHERE email = 'trainee@rj.com'`);
  const { rows: [s] } = await db.query(
    'INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING session_id', [omar.user_id]);
  await db.query(
    `INSERT INTO chat_messages (session_id, sender_role, message_text, outcome, citations)
     VALUES ($1, 'user', 'secret question text', NULL, '[]'),
            ($1, 'bot', 'answer', 'answered', '[{"n":1,"title":"Galley SOP","section":"Ovens"}]'),
            ($1, 'bot', 'answer', 'not_found', '[]')`,
    [s.session_id]);

  const { body } = await get('/api/reports/ai-usage', 'trainer@rj.com');
  const trainee = body.sections[0].rows.find(r => r.role === 'Trainee');
  assert.ok(trainee.questions >= 2);
  assert.ok(trainee.notFound >= 1);
  assert.ok(body.sections[2].rows.some(r => r.title === 'Galley SOP' && r.section === 'Ovens'));
  assert.ok(!JSON.stringify(body).includes('secret question text'));
});

test('export: PDF download is a real PDF with the report in it, and is audited', async () => {
  const res = await get('/api/reports/cohort-progress/export?format=pdf', 'trainer@rj.com')
    .buffer(true).parse(binary);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /attachment; filename="rj-cohort-progress-\d{4}-\d{2}-\d{2}\.pdf"/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.subarray(0, 5).toString('latin1'), '%PDF-');

  const text = await pdfTextOf(res.body);
  assert.match(text, /Cohort Progress/);
  assert.match(text, /Yousef Nasser/);
  assert.match(text, /Generated .* by Rania Haddad/);    // the trainer's name
  assert.match(text, /Page 1 of \d+/);

  const { rows } = await db.query(
    `SELECT a.details FROM audit_logs a JOIN users u ON u.user_id = a.actor_id
      WHERE a.action = 'REPORT_EXPORTED' AND u.email = 'trainer@rj.com'
      ORDER BY a.created_at DESC LIMIT 1`);
  assert.equal(rows[0].details.report, 'cohort-progress');
  assert.equal(rows[0].details.format, 'pdf');
});

test('export: PDF is the default; every report exports', async () => {
  for (const id of ['plan-summary', 'feedback', 'roi', 'ai-usage']) {
    const res = await get(`/api/reports/${id}/export`, 'admin@rj.com').buffer(true).parse(binary);
    assert.equal(res.status, 200, id);
    assert.equal(res.headers['content-type'], 'application/pdf', id);
    assert.equal(res.body.subarray(0, 5).toString('latin1'), '%PDF-', id);
  }
});

test('export: CSV has the filters, the rows and an Excel-friendly BOM', async () => {
  const planId = await idOf('training_plans', 'plan_name', 'Aviation Security Refresher');
  const res = await get(`/api/reports/cohort-progress/export?format=csv&planId=${planId}`, 'admin@rj.com')
    .buffer(true).parse(binary);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/csv/);
  const csv = res.body.toString('utf8');
  assert.ok(csv.startsWith('﻿Report,Cohort Progress'));
  assert.match(csv, /Plan,Aviation Security Refresher/);
  assert.match(csv, /Yousef Nasser,Ground Operations,Aviation Security Refresher/);
});

test('export: unknown format is refused', async () => {
  const res = await get('/api/reports/roi/export?format=xlsx', 'admin@rj.com');
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /pdf or csv/);
});

test('system health: admin only', async () => {
  assert.equal((await request(app).get('/api/system/health')).status, 401);
  assert.equal((await get('/api/system/health', 'trainer@rj.com')).status, 403);
  assert.equal((await get('/api/system/health', 'trainee@rj.com')).status, 403);
});

test('system health: reports every check and never a secret', async () => {
  const res = await get('/api/system/health', 'admin@rj.com');
  assert.equal(res.status, 200);
  const { checks } = res.body;
  assert.deepEqual(Object.keys(checks).sort(),
    ['accounts', 'ai', 'database', 'migrations', 'sentiment', 'server', 'sopIndex', 'storage']);
  for (const c of Object.values(checks)) assert.ok(['ok', 'warning', 'error'].includes(c.status));
  assert.ok(['ok', 'warning', 'error'].includes(res.body.status));

  assert.equal(checks.database.status === 'error', false);
  assert.ok(checks.database.pgvector);
  assert.equal(checks.migrations.status, 'ok');
  assert.deepEqual(checks.migrations.pending, []);
  assert.equal(checks.ai.status, 'warning');                // AI_FAKE=1 in tests
  assert.equal(typeof checks.ai.keysSet.openai, 'boolean');
  assert.equal(checks.accounts.deactivated, 1);             // Huda
  assert.equal(checks.accounts.pendingInvites, 1);          // Sami

  const body = JSON.stringify(res.body);
  for (const secret of [process.env.JWT_SECRET, process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY,
    process.env.DATABASE_URL]) {
    if (secret) assert.ok(!body.includes(secret), 'a secret leaked into the health response');
  }
});
