// Shared SQL and the one course shape sent to the frontend (FR7).
// Used by /api/courses and by /api/plans/:id (the plan's course list).
const db = require('../db');
const materialFiles = require('./materialFiles');

// Dates are formatted in SQL as 'YYYY-MM-DD'. Returned as a JS Date, a DATE
// column becomes local midnight and then a UTC timestamp in JSON, which can
// show as the previous day in the browser.
//
// started_count: trainees with any progress on this course. A course with
// progress cannot be deleted (it would erase that history).
const COURSE_SELECT = `
  SELECT c.course_id, c.plan_id, c.course_name, c.material_url, c.duration, c.sequence_order,
         tp.plan_name, to_char(tp.end_date, 'YYYY-MM-DD') AS plan_due_date,
         (SELECT COUNT(*)::int FROM progress pr
           WHERE pr.course_id = c.course_id AND pr.completion_pct > 0) AS started_count,
         (SELECT COUNT(*)::int FROM plan_assignments pa
           WHERE pa.plan_id = c.plan_id) AS assigned_count
    FROM courses c
    JOIN training_plans tp ON tp.plan_id = c.plan_id`;

function toCourseDto(row) {
  return {
    id: row.course_id,
    planId: row.plan_id,
    planName: row.plan_name,
    planDueDate: row.plan_due_date,
    name: row.course_name,
    durationMinutes: row.duration,
    position: row.sequence_order,
    material: materialFiles.describe(row.material_url),   // null | { type, label, url }
    startedCount: row.started_count,
    assignedCount: row.assigned_count,
  };
}

async function findCourseById(id, queryable = db) {
  const { rows } = await queryable.query(`${COURSE_SELECT} WHERE c.course_id = $1`, [id]);
  return rows[0] || null;
}

async function findCoursesByPlan(planId, queryable = db) {
  const { rows } = await queryable.query(
    `${COURSE_SELECT} WHERE c.plan_id = $1 ORDER BY c.sequence_order`, [planId]);
  return rows;
}

module.exports = { COURSE_SELECT, toCourseDto, findCourseById, findCoursesByPlan };
