// Shared SQL and the one training-plan shape sent to the frontend (FR8).
const db = require('../db');
const HttpError = require('../utils/httpError');
const { PROGRESS_CTE, PLAN_STATS_CTE, toStatsDto } = require('./progress');

// A plan with its course count, total minutes and progress totals.
// Use as `${PLAN_SELECT} WHERE ...`; the WITH clause is part of it.
const PLAN_SELECT = `
  WITH ${PROGRESS_CTE}, ${PLAN_STATS_CTE}
  SELECT tp.plan_id, tp.plan_name, tp.description,
         to_char(tp.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(tp.end_date, 'YYYY-MM-DD')   AS due_date,
         (tp.end_date < CURRENT_DATE)          AS past_due,
         tp.created_by, cu.full_name           AS created_by_name,
         (SELECT COUNT(*)::int FROM courses c WHERE c.plan_id = tp.plan_id)                  AS course_count,
         (SELECT COALESCE(SUM(c.duration), 0)::int FROM courses c WHERE c.plan_id = tp.plan_id) AS total_minutes,
         s.assigned_count, s.completed_count, s.overdue_count, s.not_started_count, s.avg_completion
    FROM training_plans tp
    LEFT JOIN users cu      ON cu.user_id = tp.created_by
    LEFT JOIN plan_stats s  ON s.plan_id = tp.plan_id`;

function toPlanDto(row) {
  return {
    id: row.plan_id,
    name: row.plan_name,
    description: row.description,
    startDate: row.start_date,
    dueDate: row.due_date,
    pastDue: row.past_due,
    createdBy: row.created_by ? { id: row.created_by, fullName: row.created_by_name } : null,
    courseCount: row.course_count,
    totalMinutes: row.total_minutes,
    ...toStatsDto(row),
  };
}

async function findPlanById(id, queryable = db) {
  const { rows } = await queryable.query(`${PLAN_SELECT} WHERE tp.plan_id = $1`, [id]);
  return rows[0] || null;
}

// Locks a plan row for the rest of the transaction, or throws.
//
// Every change that touches a plan's courses or assignments takes this lock
// first, so two requests cannot pick the same next course position, or
// reorder while a course is being removed. Always plan first, then course:
// the same order everywhere means two transactions cannot deadlock.
//
// asInput: the id came from the request body (→ 400) rather than the URL (→ 404).
async function lockPlan(client, planId, { asInput = false } = {}) {
  const { rows } = await client.query(
    `SELECT plan_id, plan_name, description,
            to_char(start_date, 'YYYY-MM-DD') AS start_date,
            to_char(end_date, 'YYYY-MM-DD')   AS due_date,
            (end_date < CURRENT_DATE)          AS past_due
       FROM training_plans WHERE plan_id = $1 FOR UPDATE`,
    [planId]);
  if (!rows[0]) {
    if (asInput) throw new HttpError(400, 'VALIDATION', 'That training plan does not exist.');
    throw new HttpError(404, 'PLAN_NOT_FOUND', 'That training plan does not exist.');
  }
  return rows[0];
}

module.exports = { PLAN_SELECT, toPlanDto, findPlanById, lockPlan };
