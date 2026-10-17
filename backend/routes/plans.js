// /api/plans — training plans, assignments and progress (FR8, FR9).
// Trainers and Admins only (NFR07).
//
//   GET    /api/plans                               list with progress totals
//   POST   /api/plans                               create                     FR8
//   GET    /api/plans/:id                           plan + its courses in order
//   PATCH  /api/plans/:id                           edit name, description, dates
//   PUT    /api/plans/:id/order                     reorder the plan's courses  FR8
//   DELETE /api/plans/:id                           delete (refused if in use)
//   POST   /api/plans/:id/assignments               assign trainees or a department FR8
//   DELETE /api/plans/:id/assignments/:traineeId    unassign one trainee
//   GET    /api/plans/:id/progress                  per-trainee progress         FR9
//
// A plan is an ordered list of courses (courses.sequence_order) with a due
// date (training_plans.end_date). Courses are added with POST /api/courses.
// Every change writes an audit row in the same transaction (FR2).
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const audit = require('../services/audit');
const materialFiles = require('../services/materialFiles');
const { toCourseDto, findCoursesByPlan } = require('../services/courses');
const { PLAN_SELECT, toPlanDto, findPlanById, lockPlan } = require('../services/plans');
const { planProgress, syncAssignmentStatus } = require('../services/progress');
const {
  isUuid, isDate, requireUuid, parsePagination, paginationDto, likePattern, readText,
} = require('../utils/validate');

const MAX_TRAINEES_PER_REQUEST = 500;

const router = express.Router();

router.use(authenticate, authorize('Trainer', 'Admin'));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function readName(value) {
  return readText(value, 'Plan name', { min: 3, max: 150 });
}

// Optional; '' or null clears it.
function readDescription(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.length > 2000) throw new HttpError(400, 'VALIDATION', 'Description must be at most 2000 characters.');
  return text || null;
}

function readDate(value, label) {
  if (!isDate(value)) throw new HttpError(400, 'VALIDATION', `${label} must be a date (YYYY-MM-DD).`);
  return value;
}

// 'YYYY-MM-DD' strings compare correctly as text.
function assertDateOrder(startDate, dueDate) {
  if (dueDate < startDate) {
    throw new HttpError(400, 'VALIDATION', 'The due date cannot be before the start date.');
  }
}

// ---------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------

// GET /api/plans?search=&page=&pageSize=
//   → { plans, pagination }   soonest due date first
router.get('/', async (req, res) => {
  const q = req.query;
  const paging = parsePagination(q);

  const params = [];
  let filter = 'TRUE';
  if (q.search !== undefined && String(q.search).trim()) {
    const search = String(q.search).trim();
    if (search.length > 100) throw new HttpError(400, 'VALIDATION', 'Search text is too long.');
    params.push(likePattern(search));
    filter = `tp.plan_name ILIKE $1`;
  }

  const count = await db.query(
    `SELECT COUNT(*)::int AS matched FROM training_plans tp WHERE ${filter}`, params);
  const page = await db.query(
    `${PLAN_SELECT}
      WHERE ${filter}
      ORDER BY (tp.end_date < CURRENT_DATE), tp.end_date, tp.plan_name
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paging.pageSize, paging.offset]);

  res.json({
    plans: page.rows.map(toPlanDto),
    pagination: paginationDto(paging, count.rows[0].matched),
  });
});

// POST /api/plans   { name, description?, startDate, dueDate }  →  201 { plan }   FR8
router.post('/', async (req, res) => {
  const body = req.body || {};
  const name = readName(body.name);
  const description = readDescription(body.description);
  const startDate = readDate(body.startDate, 'Start date');
  const dueDate = readDate(body.dueDate, 'Due date');
  assertDateOrder(startDate, dueDate);

  const plan = await db.transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO training_plans (created_by, plan_name, description, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING plan_id`,
      [req.user.id, name, description, startDate, dueDate]);
    const planId = rows[0].plan_id;
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.PLAN_CREATED,
      details: { planId, planName: name, dueDate },
    });
    return findPlanById(planId, client);
  });

  res.status(201).json({ plan: toPlanDto(plan) });
});

// GET /api/plans/:id  →  { plan, courses }   courses in plan order
router.get('/:id', async (req, res) => {
  const id = requireUuid(req.params.id, 'plan id');
  const plan = await findPlanById(id);
  if (!plan) throw new HttpError(404, 'PLAN_NOT_FOUND', 'That training plan does not exist.');
  const courses = await findCoursesByPlan(id);
  res.json({ plan: toPlanDto(plan), courses: courses.map(toCourseDto) });
});

// PATCH /api/plans/:id   { name?, description?, startDate?, dueDate? }  →  { plan }
router.patch('/:id', async (req, res) => {
  const id = requireUuid(req.params.id, 'plan id');
  const body = req.body || {};
  const fields = ['name', 'description', 'startDate', 'dueDate'].filter(f => body[f] !== undefined);
  if (fields.length === 0) {
    throw new HttpError(400, 'VALIDATION', 'Nothing to update. Send name, description, startDate or dueDate.');
  }
  const input = {
    name: body.name !== undefined ? readName(body.name) : undefined,
    description: body.description !== undefined ? readDescription(body.description) : undefined,
    startDate: body.startDate !== undefined ? readDate(body.startDate, 'Start date') : undefined,
    dueDate: body.dueDate !== undefined ? readDate(body.dueDate, 'Due date') : undefined,
  };

  const plan = await db.transaction(async (client) => {
    const current = await lockPlan(client, id);
    const next = {
      name: input.name ?? current.plan_name,
      description: input.description !== undefined ? input.description : current.description,
      startDate: input.startDate ?? current.start_date,
      dueDate: input.dueDate ?? current.due_date,
    };
    assertDateOrder(next.startDate, next.dueDate);

    const before = {
      name: current.plan_name, description: current.description,
      startDate: current.start_date, dueDate: current.due_date,
    };
    const changes = {};
    for (const field of Object.keys(next)) {
      if (next[field] !== before[field]) changes[field] = { from: before[field], to: next[field] };
    }
    // The full description can be long; the log only notes that it changed.
    if (changes.description) changes.description = { changed: true };

    if (Object.keys(changes).length > 0) {
      await client.query(
        `UPDATE training_plans
            SET plan_name = $1, description = $2, start_date = $3, end_date = $4
          WHERE plan_id = $5`,
        [next.name, next.description, next.startDate, next.dueDate, id]);
      await audit.record(client, {
        actorId: req.user.id,
        action: audit.ACTIONS.PLAN_UPDATED,
        details: { planId: id, planName: next.name, changes },
      });
    }
    return findPlanById(id, client);
  });

  res.json({ plan: toPlanDto(plan) });
});

// PUT /api/plans/:id/order   { courseIds: [every course of the plan, new order] }
//   → { courses }                                                         FR8
// One UPDATE sets every position. The deferrable unique constraint
// (migration 002) is checked at the end of that statement, so swapping two
// positions does not collide halfway.
router.put('/:id/order', async (req, res) => {
  const id = requireUuid(req.params.id, 'plan id');
  const courseIds = req.body?.courseIds;
  if (!Array.isArray(courseIds) || !courseIds.every(isUuid)) {
    throw new HttpError(400, 'VALIDATION', 'courseIds must be a list of course ids.');
  }

  const courses = await db.transaction(async (client) => {
    const plan = await lockPlan(client, id);
    const { rows } = await client.query(
      'SELECT course_id, course_name FROM courses WHERE plan_id = $1', [id]);
    const current = new Set(rows.map(r => r.course_id));
    const sameSet = courseIds.length === current.size
      && new Set(courseIds).size === courseIds.length
      && courseIds.every(cid => current.has(cid));
    if (!sameSet) {
      throw new HttpError(400, 'VALIDATION',
        'Send every course of this plan exactly once. The plan may have changed; reload and try again.');
    }

    await client.query(
      `UPDATE courses c
          SET sequence_order = o.position
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(course_id, position)
        WHERE c.course_id = o.course_id`,
      [courseIds]);

    const names = new Map(rows.map(r => [r.course_id, r.course_name]));
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.PLAN_UPDATED,
      details: { planId: id, planName: plan.plan_name, reordered: courseIds.map(cid => names.get(cid)) },
    });
    return findCoursesByPlan(id, client);
  });

  res.json({ courses: courses.map(toCourseDto) });
});

// DELETE /api/plans/:id  →  204
// Refused while trainees are assigned, or once anyone has progress on its
// courses: the GP1 foreign keys would cascade and erase that history.
router.delete('/:id', async (req, res) => {
  const id = requireUuid(req.params.id, 'plan id');

  const materialUrls = await db.transaction(async (client) => {
    const plan = await lockPlan(client, id);
    const { rows: [usage] } = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM plan_assignments WHERE plan_id = $1) AS assigned,
              (SELECT COUNT(*)::int FROM progress pr JOIN courses c ON c.course_id = pr.course_id
                WHERE c.plan_id = $1 AND pr.completion_pct > 0) AS started`,
      [id]);
    if (usage.assigned > 0) {
      throw new HttpError(409, 'PLAN_HAS_ASSIGNMENTS',
        `${usage.assigned} trainee(s) are assigned to this plan. Unassign them before deleting it.`);
    }
    if (usage.started > 0) {
      throw new HttpError(409, 'PLAN_HAS_PROGRESS',
        'Trainees have progress on this plan’s courses, so deleting it would erase their history.');
    }

    const { rows: courses } = await client.query(
      'SELECT material_url FROM courses WHERE plan_id = $1', [id]);
    // courses cascade (GP1: courses.plan_id ON DELETE CASCADE)
    await client.query('DELETE FROM training_plans WHERE plan_id = $1', [id]);
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.PLAN_DELETED,
      details: { planId: id, planName: plan.plan_name, courseCount: courses.length },
    });
    return courses.map(c => c.material_url);
  });

  for (const url of materialUrls) await materialFiles.removeStored(url);
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Assignments (FR8)
// ---------------------------------------------------------------------

// POST /api/plans/:id/assignments   { traineeIds: [...] }  or  { departmentId }
//   → { assigned: [{ id, fullName }], alreadyAssigned: [{ id, fullName }] }
//
// A department ("group") is expanded to its active trainees at this moment;
// people who join the department later are not added automatically.
// Duplicates are skipped by the unique constraint (ON CONFLICT DO NOTHING),
// so assigning the same department twice is safe.
router.post('/:id/assignments', async (req, res) => {
  const id = requireUuid(req.params.id, 'plan id');
  const body = req.body || {};
  const byDepartment = body.departmentId !== undefined;
  if (byDepartment === (body.traineeIds !== undefined)) {
    throw new HttpError(400, 'VALIDATION', 'Send either traineeIds or departmentId.');
  }

  let traineeIds = null;
  if (!byDepartment) {
    if (!Array.isArray(body.traineeIds) || body.traineeIds.length === 0 || !body.traineeIds.every(isUuid)) {
      throw new HttpError(400, 'VALIDATION', 'Choose at least one trainee.');
    }
    traineeIds = [...new Set(body.traineeIds)];
    if (traineeIds.length > MAX_TRAINEES_PER_REQUEST) {
      throw new HttpError(400, 'VALIDATION', `Assign at most ${MAX_TRAINEES_PER_REQUEST} trainees at a time.`);
    }
  } else if (!isUuid(body.departmentId)) {
    throw new HttpError(400, 'VALIDATION', 'Please choose a valid department.');
  }

  const result = await db.transaction(async (client) => {
    const plan = await lockPlan(client, id);
    if (plan.past_due) {
      throw new HttpError(409, 'PLAN_PAST_DUE',
        'This plan’s due date has passed. Move the due date before assigning anyone.');
    }

    // Who will be assigned: active Trainee accounts only.
    let trainees;
    let department = null;
    if (byDepartment) {
      const dept = await client.query('SELECT dept_name FROM departments WHERE dept_id = $1', [body.departmentId]);
      if (!dept.rows[0]) throw new HttpError(400, 'VALIDATION', 'That department does not exist.');
      department = dept.rows[0].dept_name;
      ({ rows: trainees } = await client.query(
        `SELECT u.user_id, u.full_name FROM users u JOIN roles r ON r.role_id = u.role_id
          WHERE u.dept_id = $1 AND r.role_name = 'Trainee' AND u.is_active
          ORDER BY u.full_name`,
        [body.departmentId]));
      if (trainees.length === 0) {
        throw new HttpError(400, 'NO_TRAINEES', `${department} has no active trainees to assign.`);
      }
    } else {
      ({ rows: trainees } = await client.query(
        `SELECT u.user_id, u.full_name FROM users u JOIN roles r ON r.role_id = u.role_id
          WHERE u.user_id = ANY($1::uuid[]) AND r.role_name = 'Trainee' AND u.is_active
          ORDER BY u.full_name`,
        [traineeIds]));
      if (trainees.length !== traineeIds.length) {
        throw new HttpError(400, 'INVALID_TRAINEES',
          'Some of the selected people are not active trainees. Reload the list and try again.');
      }
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO plan_assignments (plan_id, trainee_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT (plan_id, trainee_id) DO NOTHING
       RETURNING trainee_id`,
      [id, trainees.map(t => t.user_id)]);
    const newIds = new Set(inserted.map(r => r.trainee_id));
    // Someone re-assigned a plan they had already finished keeps "completed".
    for (const traineeId of newIds) await syncAssignmentStatus(client, id, traineeId);

    // One audit row per trainee, so the Audit Log's user filter shows it.
    for (const t of trainees.filter(tr => newIds.has(tr.user_id))) {
      await audit.record(client, {
        actorId: req.user.id,
        action: audit.ACTIONS.PLAN_ASSIGNED,
        targetUserId: t.user_id,
        details: { planId: id, planName: plan.plan_name, via: byDepartment ? 'department' : 'individual', department },
      });
    }

    const dto = t => ({ id: t.user_id, fullName: t.full_name });
    return {
      assigned: trainees.filter(t => newIds.has(t.user_id)).map(dto),
      alreadyAssigned: trainees.filter(t => !newIds.has(t.user_id)).map(dto),
    };
  });

  res.json(result);
});

// DELETE /api/plans/:id/assignments/:traineeId  →  204
// The trainee's progress rows are kept (progress is per course, not per
// assignment), so re-assigning later picks up where they left off.
router.delete('/:id/assignments/:traineeId', async (req, res) => {
  const id = requireUuid(req.params.id, 'plan id');
  const traineeId = requireUuid(req.params.traineeId, 'trainee id');

  await db.transaction(async (client) => {
    const plan = await lockPlan(client, id);
    const { rowCount } = await client.query(
      'DELETE FROM plan_assignments WHERE plan_id = $1 AND trainee_id = $2', [id, traineeId]);
    if (rowCount === 0) {
      throw new HttpError(404, 'ASSIGNMENT_NOT_FOUND', 'That trainee is not assigned to this plan.');
    }
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.PLAN_UNASSIGNED,
      targetUserId: traineeId,
      details: { planId: id, planName: plan.plan_name },
    });
  });

  res.status(204).end();
});

// ---------------------------------------------------------------------
// Progress (FR9)
// ---------------------------------------------------------------------

// GET /api/plans/:id/progress
//   → { plan, summary, trainees: [{ id, fullName, email, department, assignedDate,
//        completionPct, completedCourses, totalCourses, lastActivityAt, overdue, status }] }
// The data comes from services/progress.js so Phase 7 (Trainer Overview,
// Analytics) can reuse it without going through HTTP.
router.get('/:id/progress', async (req, res) => {
  const id = requireUuid(req.params.id, 'plan id');
  const plan = await findPlanById(id);
  if (!plan) throw new HttpError(404, 'PLAN_NOT_FOUND', 'That training plan does not exist.');
  const { summary, trainees } = await planProgress(id);
  res.json({ plan: toPlanDto(plan), summary, trainees });
});

module.exports = router;
