// Trainee progress (FR9). All the maths lives here so every screen (Plan
// progress, My Trainees, and later Trainer Overview / Analytics in Phase 7)
// uses the same definitions:
//
//   completion %   average of the plan's courses for that trainee; a course
//                  with no progress row counts as 0%. FLOOR, not ROUND, so
//                  100% means every course is finished (99.7% stays 99%).
//   last activity  newest progress.last_accessed on the plan's courses
//   overdue        the plan's due date (end_date) has passed and the
//                  trainee is under 100%
//   status         completed | overdue | in_progress | not_started
//
// Per course, for one trainee (FR5, Phase 4c):
//   not_started    no progress row, or 0% and never opened
//   started        0%, but opened (last_accessed is set)
//   in_progress    1–99%
//   completed      100%
//
// Nothing is stored: it is computed from progress on every request, so it
// can never drift out of date. Deactivated trainees are left out (their rows
// stay in the database; FR19 keeps history). The one stored copy is GP1's
// plan_assignments.status, kept in step by syncAssignmentStatus below.
const db = require('../db');
const materialFiles = require('./materialFiles');

// Course status from a LEFT JOIN of progress aliased "pr".
const COURSE_STATUS_SQL = `
  CASE
    WHEN pr.completion_pct = 100            THEN 'completed'
    WHEN pr.completion_pct > 0              THEN 'in_progress'
    WHEN pr.last_accessed IS NOT NULL       THEN 'started'
    ELSE 'not_started'
  END`;

// Two CTEs. Use as:  WITH ${PROGRESS_CTE} SELECT ... FROM ap ...
//   ap_raw  one row per assignment, with the numbers
//   ap      the same rows plus overdue and status
const PROGRESS_CTE = `
  ap_raw AS (
    SELECT pa.assign_id, pa.plan_id, pa.trainee_id, pa.assigned_date, tp.end_date,
           COUNT(c.course_id)::int AS total_courses,
           COUNT(pr.progress_id) FILTER (WHERE pr.completion_pct = 100)::int AS completed_courses,
           COALESCE(FLOOR(AVG(COALESCE(pr.completion_pct, 0)) FILTER (WHERE c.course_id IS NOT NULL)), 0)::int
             AS completion_pct,
           MAX(pr.last_accessed) AS last_activity_at
      FROM plan_assignments pa
      JOIN users u           ON u.user_id = pa.trainee_id AND u.is_active
      JOIN training_plans tp ON tp.plan_id = pa.plan_id
      LEFT JOIN courses c    ON c.plan_id = pa.plan_id
      LEFT JOIN progress pr  ON pr.course_id = c.course_id AND pr.trainee_id = pa.trainee_id
     GROUP BY pa.assign_id, tp.plan_id
  ),
  ap AS (
    SELECT ap_raw.*,
           (total_courses > 0 AND completed_courses < total_courses AND end_date < CURRENT_DATE) AS overdue,
           CASE
             WHEN total_courses > 0 AND completed_courses = total_courses THEN 'completed'
             WHEN total_courses > 0 AND end_date < CURRENT_DATE           THEN 'overdue'
             WHEN completion_pct = 0 AND last_activity_at IS NULL          THEN 'not_started'
             ELSE 'in_progress'
           END AS status
      FROM ap_raw
  )`;

// Per-plan totals. Use after PROGRESS_CTE:  WITH ${PROGRESS_CTE}, ${PLAN_STATS_CTE} ...
const PLAN_STATS_CTE = `
  plan_stats AS (
    SELECT plan_id,
           COUNT(*)::int                                          AS assigned_count,
           COUNT(*) FILTER (WHERE status = 'completed')::int      AS completed_count,
           COUNT(*) FILTER (WHERE overdue)::int                   AS overdue_count,
           COUNT(*) FILTER (WHERE status = 'not_started')::int    AS not_started_count,
           FLOOR(AVG(completion_pct))::int                        AS avg_completion
      FROM ap
     GROUP BY plan_id
  )`;

function toStatsDto(row) {
  return {
    assignedCount: row.assigned_count ?? 0,
    completedCount: row.completed_count ?? 0,
    overdueCount: row.overdue_count ?? 0,
    notStartedCount: row.not_started_count ?? 0,
    // null when nobody is assigned, so the UI shows "—" instead of a fake 0%
    avgCompletion: row.avg_completion ?? null,
  };
}

function toAssignmentProgressDto(row) {
  return {
    completionPct: row.completion_pct,
    completedCourses: row.completed_courses,
    totalCourses: row.total_courses,
    lastActivityAt: row.last_activity_at,
    overdue: row.overdue,
    status: row.status,
  };
}

// One plan: a row per assigned (active) trainee, overdue first.
//   → { summary, trainees: [{ id, fullName, email, department, assignedDate, ...progress }] }
async function planProgress(planId, queryable = db) {
  const { rows } = await queryable.query(
    `WITH ${PROGRESS_CTE}
     SELECT ap.*, to_char(ap.assigned_date, 'YYYY-MM-DD') AS assigned_on,
            u.full_name, u.email, d.dept_name
       FROM ap
       JOIN users u ON u.user_id = ap.trainee_id
       LEFT JOIN departments d ON d.dept_id = u.dept_id
      WHERE ap.plan_id = $1
      ORDER BY ap.overdue DESC, ap.completion_pct, u.full_name`,
    [planId]);

  const trainees = rows.map(r => ({
    id: r.trainee_id,
    fullName: r.full_name,
    email: r.email,
    department: r.dept_name,
    assignedDate: r.assigned_on,
    ...toAssignmentProgressDto(r),
  }));

  // Same SQL as the plan list, so the two screens can never disagree.
  const stats = await queryable.query(
    `WITH ${PROGRESS_CTE}, ${PLAN_STATS_CTE} SELECT * FROM plan_stats WHERE plan_id = $1`, [planId]);

  return { summary: toStatsDto(stats.rows[0] || {}), trainees };
}

// One trainee: every plan they are assigned, with per-course detail.
//   → [{ planId, planName, dueDate, ...progress, courses: [...] }]
//
// Used by the trainer's view of a trainee (/api/trainees/:id/progress) and by
// the trainee's own view (/api/me/plans), so the two always agree. Only the
// trainee's own view passes { withFeedback: true } (their rating and comment).
async function traineeProgress(traineeId, queryable = db, { withFeedback = false } = {}) {
  const plans = await queryable.query(
    `WITH ${PROGRESS_CTE}
     SELECT ap.*, tp.plan_name, tp.description,
            to_char(tp.start_date, 'YYYY-MM-DD') AS start_date,
            (tp.start_date > CURRENT_DATE) AS upcoming,
            to_char(tp.end_date, 'YYYY-MM-DD') AS due_date,
            to_char(ap.assigned_date, 'YYYY-MM-DD') AS assigned_on
       FROM ap
       JOIN training_plans tp ON tp.plan_id = ap.plan_id
      WHERE ap.trainee_id = $1
      ORDER BY tp.end_date, tp.plan_name`,
    [traineeId]);

  const courses = await queryable.query(
    `SELECT c.plan_id, c.course_id, c.course_name, c.sequence_order, c.duration, c.material_url,
            COALESCE(pr.completion_pct, 0) AS completion_pct, pr.last_accessed,
            ${COURSE_STATUS_SQL} AS course_status,
            fb.rating, fb.comment
       FROM plan_assignments pa
       JOIN courses c        ON c.plan_id = pa.plan_id
       LEFT JOIN progress pr ON pr.course_id = c.course_id AND pr.trainee_id = pa.trainee_id
       LEFT JOIN feedback fb ON fb.course_id = c.course_id AND fb.trainee_id = pa.trainee_id
      WHERE pa.trainee_id = $1
      ORDER BY c.plan_id, c.sequence_order`,
    [traineeId]);

  return plans.rows.map(p => ({
    planId: p.plan_id,
    planName: p.plan_name,
    description: p.description,
    startDate: p.start_date,
    upcoming: p.upcoming,               // start date still in the future
    dueDate: p.due_date,
    assignedDate: p.assigned_on,
    ...toAssignmentProgressDto(p),
    courses: courses.rows
      .filter(c => c.plan_id === p.plan_id)
      .map(c => ({
        id: c.course_id,
        name: c.course_name,
        position: c.sequence_order,
        durationMinutes: c.duration,
        completionPct: c.completion_pct,
        lastAccessedAt: c.last_accessed,
        status: c.course_status,
        material: materialFiles.describe(c.material_url),   // null | { type, label, url }
        ...(withFeedback && {
          feedback: c.rating === null ? null : { rating: c.rating, comment: c.comment },
        }),
      })),
  }));
}

// plan_assignments.status (GP1: 'active' | 'completed') is the one stored
// copy of plan completion. It is recomputed whenever something can change it,
// inside the same transaction as that change:
//   - a trainee updates progress           (traineeId given)
//   - a trainer adds or deletes a course   (every trainee of the plan)
//   - a trainee is assigned                (they may already have progress)
// A plan with no courses stays 'active': there is nothing to complete.
async function syncAssignmentStatus(client, planId, traineeId = null) {
  await client.query(
    `UPDATE plan_assignments pa
        SET status = CASE WHEN s.total_courses > 0 AND s.completed_courses = s.total_courses
                          THEN 'completed' ELSE 'active' END
       FROM (SELECT a.assign_id,
                    COUNT(c.course_id) AS total_courses,
                    COUNT(pr.progress_id) FILTER (WHERE pr.completion_pct = 100) AS completed_courses
               FROM plan_assignments a
               LEFT JOIN courses c   ON c.plan_id = a.plan_id
               LEFT JOIN progress pr ON pr.course_id = c.course_id AND pr.trainee_id = a.trainee_id
              WHERE a.plan_id = $1 AND ($2::uuid IS NULL OR a.trainee_id = $2)
              GROUP BY a.assign_id) s
      WHERE pa.assign_id = s.assign_id`,
    [planId, traineeId]);
}

module.exports = {
  PROGRESS_CTE, PLAN_STATS_CTE, COURSE_STATUS_SQL, toStatsDto, planProgress, traineeProgress,
  syncAssignmentStatus,
};
