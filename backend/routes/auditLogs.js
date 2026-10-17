// /api/audit-logs — read the audit log (FR2). Admin only.
//
// GET /api/audit-logs?action=&userId=&search=&from=&to=&page=&pageSize=
//   action   one of services/audit.js ACTIONS
//   userId   entries where this user is the actor OR the target
//   search   matches the actor's or target's name / email
//   from,to  YYYY-MM-DD, both inclusive
//   → { entries, pagination, actions }
//
// Read-only: there is no endpoint to edit or delete audit rows.
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const { ACTION_VALUES } = require('../services/audit');
const {
  requireUuid, parsePagination, paginationDto, likePattern, isDate,
} = require('../utils/validate');

const router = express.Router();

router.use(authenticate, authorize('Admin'));

router.get('/', async (req, res) => {
  const q = req.query;
  const paging = parsePagination(q, { defaultSize: 25 });

  const where = [];
  const params = [];
  const param = (value) => { params.push(value); return `$${params.length}`; };

  if (q.action) {
    if (!ACTION_VALUES.includes(q.action)) {
      throw new HttpError(400, 'VALIDATION', 'That action type does not exist.');
    }
    where.push(`a.action = ${param(q.action)}`);
  }
  if (q.userId) {
    const p = param(requireUuid(q.userId, 'user id'));
    where.push(`(a.actor_id = ${p} OR a.target_user_id = ${p})`);
  }
  if (q.search !== undefined && String(q.search).trim()) {
    const search = String(q.search).trim();
    if (search.length > 100) throw new HttpError(400, 'VALIDATION', 'Search text is too long.');
    const p = param(likePattern(search));
    where.push(`(actor.full_name ILIKE ${p} OR actor.email ILIKE ${p}
                 OR target.full_name ILIKE ${p} OR target.email ILIKE ${p})`);
  }
  for (const key of ['from', 'to']) {
    if (q[key] !== undefined && q[key] !== '' && !isDate(q[key])) {
      throw new HttpError(400, 'VALIDATION', `"${key}" must be a date in the form YYYY-MM-DD.`);
    }
  }
  if (q.from && q.to && q.from > q.to) {
    throw new HttpError(400, 'VALIDATION', 'The start date must be on or before the end date.');
  }
  if (q.from) where.push(`a.created_at >= ${param(q.from)}::date`);
  // "to" is inclusive: everything before the start of the next day.
  if (q.to) where.push(`a.created_at < ${param(q.to)}::date + 1`);

  const from = `
    FROM audit_logs a
    LEFT JOIN users actor  ON actor.user_id  = a.actor_id
    LEFT JOIN users target ON target.user_id = a.target_user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  const count = await db.query(`SELECT COUNT(*)::int AS total ${from}`, params);
  const { rows } = await db.query(
    `SELECT a.log_id, a.action, a.details, a.created_at,
            actor.user_id  AS actor_id,  actor.full_name  AS actor_name,  actor.email  AS actor_email,
            target.user_id AS target_id, target.full_name AS target_name, target.email AS target_email
     ${from}
     ORDER BY a.created_at DESC, a.log_id
     LIMIT ${param(paging.pageSize)} OFFSET ${param(paging.offset)}`,
    params,
  );

  res.json({
    entries: rows.map(r => ({
      id: r.log_id,
      action: r.action,
      createdAt: r.created_at,
      details: r.details,
      actor: r.actor_id ? { id: r.actor_id, fullName: r.actor_name, email: r.actor_email } : null,
      target: r.target_id ? { id: r.target_id, fullName: r.target_name, email: r.target_email } : null,
    })),
    pagination: paginationDto(paging, count.rows[0].total),
    actions: ACTION_VALUES,
  });
});

module.exports = router;
