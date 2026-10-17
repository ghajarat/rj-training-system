// /api/trainees — trainees as seen by Trainers and Admins (FR8, FR9).
//
//   GET /api/trainees                 active trainees with a progress summary
//   GET /api/trainees/:id/progress    one trainee's plans and courses
//
// Separate from /api/users, which is Admin-only account management: this
// returns only what a trainer needs to assign plans and follow progress
// (no account status, setup links or roles).
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const { PROGRESS_CTE, traineeProgress } = require('../services/progress');
const {
  requireUuid, parsePagination, paginationDto, likePattern,
} = require('../utils/validate');

const router = express.Router();

router.use(authenticate, authorize('Trainer', 'Admin'));

// Active trainee accounts, with totals across all their plans.
const TRAINEE_SELECT = `
  WITH ${PROGRESS_CTE},
  trainee_stats AS (
    SELECT trainee_id,
           COUNT(*)::int                                     AS plan_count,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
           COUNT(*) FILTER (WHERE overdue)::int              AS overdue_count,
           FLOOR(AVG(completion_pct))::int                   AS avg_completion,
           MAX(last_activity_at)                             AS last_activity_at
      FROM ap
     GROUP BY trainee_id
  )
  SELECT u.user_id, u.full_name, u.email, u.dept_id, d.dept_name,
         COALESCE(s.plan_count, 0)      AS plan_count,
         COALESCE(s.completed_count, 0) AS completed_count,
         COALESCE(s.overdue_count, 0)   AS overdue_count,
         s.avg_completion, s.last_activity_at
    FROM users u
    JOIN roles r ON r.role_id = u.role_id AND r.role_name = 'Trainee'
    LEFT JOIN departments d    ON d.dept_id = u.dept_id
    LEFT JOIN trainee_stats s  ON s.trainee_id = u.user_id
   WHERE u.is_active`;

function toTraineeDto(row) {
  return {
    id: row.user_id,
    fullName: row.full_name,
    email: row.email,
    departmentId: row.dept_id,
    department: row.dept_name,
    planCount: row.plan_count,
    completedCount: row.completed_count,
    overdueCount: row.overdue_count,
    avgCompletion: row.avg_completion,        // null when no plans assigned
    lastActivityAt: row.last_activity_at,
    // Only present when ?planId= was sent (used by the Assign modal)
    ...(row.assigned_to_plan !== undefined && { assignedToPlan: row.assigned_to_plan }),
  };
}

// GET /api/trainees?search=&departmentId=&planId=&page=&pageSize=
//   planId   adds assignedToPlan: true/false for that plan
//   → { trainees, pagination }   overdue first, then by name
router.get('/', async (req, res) => {
  const q = req.query;
  const paging = parsePagination(q);

  const where = [];
  const params = [];
  const param = (value) => { params.push(value); return `$${params.length}`; };

  if (q.search !== undefined && String(q.search).trim()) {
    const search = String(q.search).trim();
    if (search.length > 100) throw new HttpError(400, 'VALIDATION', 'Search text is too long.');
    const p = param(likePattern(search));
    where.push(`(u.full_name ILIKE ${p} OR u.email ILIKE ${p})`);
  }
  if (q.departmentId) where.push(`u.dept_id = ${param(requireUuid(q.departmentId, 'department'))}`);

  const filter = where.length ? `AND ${where.join(' AND ')}` : '';
  const listSql = `${TRAINEE_SELECT} ${filter}`;
  const count = await db.query(`SELECT COUNT(*)::int AS matched FROM (${listSql}) list`, params);

  // planId only adds a column, so it joins the parameters after the count.
  let assignedColumn = '';
  if (q.planId) {
    const p = param(requireUuid(q.planId, 'plan id'));
    assignedColumn = `, EXISTS (SELECT 1 FROM plan_assignments pa
                                 WHERE pa.plan_id = ${p} AND pa.trainee_id = list.user_id) AS assigned_to_plan`;
  }
  const page = await db.query(
    `SELECT list.* ${assignedColumn}
       FROM (${listSql}) list
      ORDER BY list.overdue_count > 0 DESC, list.full_name
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paging.pageSize, paging.offset]);

  res.json({
    trainees: page.rows.map(toTraineeDto),
    pagination: paginationDto(paging, count.rows[0].matched),
  });
});

// GET /api/trainees/:id/progress
//   → { trainee, plans: [{ planId, planName, dueDate, completionPct, overdue, status, courses: [...] }] }
router.get('/:id/progress', async (req, res) => {
  const id = requireUuid(req.params.id, 'trainee id');
  const { rows } = await db.query(`${TRAINEE_SELECT} AND u.user_id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'TRAINEE_NOT_FOUND', 'That trainee does not exist or is no longer active.');
  res.json({ trainee: toTraineeDto(rows[0]), plans: await traineeProgress(id) });
});

module.exports = router;
