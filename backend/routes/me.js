// /api/me — a trainee's own training (FR4, FR5, FR6). Trainees only.
//
//   GET /api/me/plans                       my plans, courses, progress, feedback  FR4/FR5
//   GET /api/me/courses/:id/material        download a material of my course      FR4
//   PUT /api/me/courses/:id/progress        { completionPct }                      FR5
//   PUT /api/me/courses/:id/feedback        { rating, comment? }                   FR6
//
// "Only my own data" is structural: the trainee is ALWAYS req.user.id (set by
// authenticate from the verified token and the database). No route reads a
// trainee id from the URL or the body, so there is nothing to tamper with.
//
// A course is "mine" when it belongs to a plan assigned to me. Any other
// course answers 404 COURSE_NOT_FOUND, the same as a course that does not
// exist, so a trainee cannot probe which course ids are real.
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const materialFiles = require('../services/materialFiles');
const { traineeProgress, syncAssignmentStatus } = require('../services/progress');
const { requireUuid } = require('../utils/validate');

const router = express.Router();

router.use(authenticate, authorize('Trainee'));

// Decision 1 (Phase 4c): started = 0, in progress = 25/50/75, completed = 100.
// Fixed steps keep the numbers honest and comparable between trainees.
const PROGRESS_STEPS = [0, 25, 50, 75, 100];
const COMMENT_MAX = 2000;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// The course, if it is in one of my plans; otherwise 404.
//
// With { lockPlan: true } (inside a transaction) the course's plan row is
// locked FOR SHARE. Trainers lock the plan FOR UPDATE before adding or
// deleting a course or unassigning someone, so they wait for this
// transaction (and it for them) and plan completion is never computed from
// a course list that is changing underneath it. FOR SHARE, not FOR UPDATE:
// two trainees saving progress on the same plan do not block each other.
async function findMyCourse(queryable, traineeId, courseId, { lockPlan = false } = {}) {
  const { rows } = await queryable.query(
    `SELECT c.course_id, c.plan_id, c.course_name, c.material_url
       FROM courses c
       JOIN plan_assignments pa ON pa.plan_id = c.plan_id AND pa.trainee_id = $2
       JOIN training_plans tp   ON tp.plan_id = c.plan_id
      WHERE c.course_id = $1
      ${lockPlan ? 'FOR SHARE OF tp' : ''}`,
    [courseId, traineeId]);
  if (!rows[0]) {
    throw new HttpError(404, 'COURSE_NOT_FOUND', 'That course is not part of any training plan assigned to you.');
  }
  return rows[0];
}

// Dashboard numbers, worked out from the same plan list the page shows,
// so the cards can never disagree with the list under them.
function summarize(plans) {
  const courses = plans.flatMap(p => p.courses);
  const completed = courses.filter(c => c.status === 'completed');
  const open = plans.filter(p => p.status !== 'completed');   // already sorted by due date
  return {
    planCount: plans.length,
    openPlanCount: open.length,
    // Each plan counts equally, the same as avgCompletion on My Trainees.
    // null with no plans, so the UI shows "—" instead of a fake 0%.
    overallPct: plans.length
      ? Math.floor(plans.reduce((sum, p) => sum + p.completionPct, 0) / plans.length)
      : null,
    completedCourses: completed.length,
    totalCourses: courses.length,
    completedMinutes: completed.reduce((sum, c) => sum + (c.durationMinutes || 0), 0),
    nextDue: open[0]
      ? { planId: open[0].planId, planName: open[0].planName, dueDate: open[0].dueDate, overdue: open[0].overdue }
      : null,
  };
}

async function myTraining(traineeId) {
  const plans = await traineeProgress(traineeId, db, { withFeedback: true });
  return { summary: summarize(plans), plans };
}

function readCompletion(value) {
  const pct = Number(value);
  if (value === null || value === '' || !PROGRESS_STEPS.includes(pct)) {
    throw new HttpError(400, 'VALIDATION', `Progress must be one of ${PROGRESS_STEPS.join(', ')} percent.`);
  }
  return pct;
}

function readRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, 'VALIDATION', 'Please choose a rating from 1 to 5 stars.');
  }
  return rating;
}

// The comment is stored as the trainee wrote it (only the surrounding spaces
// are trimmed): Phase 7 runs sentiment analysis on the original text.
function readComment(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'VALIDATION', 'The comment must be text.');
  const text = value.trim();
  if (text.length > COMMENT_MAX) {
    throw new HttpError(400, 'VALIDATION', `The comment must be at most ${COMMENT_MAX} characters.`);
  }
  return text || null;
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

// GET /api/me/plans
//   → { summary, plans: [{ planId, planName, description, startDate, upcoming, dueDate,
//                          completionPct, completedCourses, totalCourses, overdue, status,
//                          courses: [{ id, name, position, durationMinutes, completionPct,
//                                      status, lastAccessedAt, material, feedback }] }] }
router.get('/plans', async (req, res) => {
  res.json(await myTraining(req.user.id));
});

// GET /api/me/courses/:id/material  →  the file, as a download            FR4
// Only for a course in a plan assigned to me. Web links are not served
// here: the browser opens material.url directly.
router.get('/courses/:id/material', async (req, res) => {
  const course = await findMyCourse(db, req.user.id, requireUuid(req.params.id, 'course id'));
  await materialFiles.sendCourseFile(res, course);
});

// PUT /api/me/courses/:id/progress   { completionPct: 0 | 25 | 50 | 75 | 100 }
//   → { summary, plans }  (the whole refreshed list, so every number on
//                          screen updates from one source)                  FR5
// Moving back is allowed (decision 2): a course marked complete by mistake
// can be corrected. last_accessed records when it last changed.
router.put('/courses/:id/progress', async (req, res) => {
  const id = requireUuid(req.params.id, 'course id');
  const pct = readCompletion((req.body || {}).completionPct);

  await db.transaction(async (client) => {
    const course = await findMyCourse(client, req.user.id, id, { lockPlan: true });
    // One row per (trainee, course): uq_progress_trainee_course.
    await client.query(
      `INSERT INTO progress (trainee_id, course_id, completion_pct, last_accessed)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (trainee_id, course_id)
       DO UPDATE SET completion_pct = EXCLUDED.completion_pct, last_accessed = NOW()`,
      [req.user.id, id, pct]);
    await syncAssignmentStatus(client, course.plan_id, req.user.id);
  });

  res.json(await myTraining(req.user.id));
});

// PUT /api/me/courses/:id/feedback   { rating: 1..5, comment? }
//   → { summary, plans }                                                   FR6
// One feedback per course per trainee (migration 003); saving again edits
// it. Allowed once the course is started (decision 3). A changed comment
// clears sentiment_score so the AI module (Phase 7) scores it again.
router.put('/courses/:id/feedback', async (req, res) => {
  const id = requireUuid(req.params.id, 'course id');
  const body = req.body || {};
  const rating = readRating(body.rating);
  const comment = readComment(body.comment);

  await db.transaction(async (client) => {
    await findMyCourse(client, req.user.id, id);
    const { rows: [started] } = await client.query(
      `SELECT 1 FROM progress
        WHERE trainee_id = $1 AND course_id = $2
          AND (completion_pct > 0 OR last_accessed IS NOT NULL)`,
      [req.user.id, id]);
    if (!started) {
      throw new HttpError(409, 'COURSE_NOT_STARTED', 'Start this course before giving feedback on it.');
    }
    await client.query(
      `INSERT INTO feedback (trainee_id, course_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (trainee_id, course_id)
       DO UPDATE SET rating = EXCLUDED.rating,
                     comment = EXCLUDED.comment,
                     sentiment_score = CASE WHEN feedback.comment IS DISTINCT FROM EXCLUDED.comment
                                            THEN NULL ELSE feedback.sentiment_score END`,
      [req.user.id, id, rating, comment]);
  });

  res.json(await myTraining(req.user.id));
});

module.exports = router;
