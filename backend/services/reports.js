// Phase 8 (FR17): training reports that Trainers and Admins generate and
// export as PDF (and CSV for spreadsheets).
//
// Every report is built the same way, by a function in REPORTS below, into
// one plain shape that the preview screen, the PDF writer and the CSV writer
// all read. So the three can never disagree:
//
//   {
//     id, title, description,
//     generatedAt,                       ISO time
//     filters: [{ label, value }],       the filters applied, in words
//     summary: [{ label, value, type }], headline figures
//     sections: [{ title, columns: [{ key, label, type }], rows, empty }],
//     notes: [string],                   definitions and assumptions
//   }
//
// Column `type` tells the writers how to show a value:
//   text | int | pct | date | datetime | rating | money | score | change | status
//   (score = signed number, change = signed percentage)
//
// The numbers come from the same SQL as the dashboards (services/progress.js
// and services/analytics.js), so a report matches what the screens show.
// Deactivated users are left out, like everywhere else. Reports are read-only.
const db = require('../db');
const HttpError = require('../utils/httpError');
const { requireUuid, isDate } = require('../utils/validate');
const { PROGRESS_CTE, PLAN_STATS_CTE } = require('./progress');
const analytics = require('./analytics');
const roiModel = require('./roiModel');

const STATUSES = ['not_started', 'in_progress', 'overdue', 'completed'];
const STATUS_LABELS = {
  not_started: 'Not started', in_progress: 'In progress', overdue: 'Overdue', completed: 'Completed',
};
const AI_DEFAULT_DAYS = 30;
const AI_MAX_DAYS = 366;

// ---------------------------------------------------------------------
// Filters. Each report lists the ones it accepts; anything else in the
// query string is ignored. Every filter is checked, and ids must exist, so
// the report's header can name what was filtered.
// ---------------------------------------------------------------------

async function readPlan(value) {
  const id = requireUuid(value, 'plan id');
  const { rows } = await db.query('SELECT plan_name FROM training_plans WHERE plan_id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'PLAN_NOT_FOUND', 'That training plan does not exist.');
  return { id, label: rows[0].plan_name };
}

async function readDepartment(value) {
  const id = requireUuid(value, 'department id');
  const { rows } = await db.query('SELECT dept_name FROM departments WHERE dept_id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'DEPARTMENT_NOT_FOUND', 'That department does not exist.');
  return { id, label: rows[0].dept_name };
}

function readStatus(value) {
  if (!STATUSES.includes(value)) {
    throw new HttpError(400, 'VALIDATION', `status must be one of: ${STATUSES.join(', ')}.`);
  }
  return { id: value, label: STATUS_LABELS[value] };
}

function readDate(value, name) {
  if (!isDate(value)) throw new HttpError(400, 'VALIDATION', `${name} must be a date in YYYY-MM-DD form.`);
  return value;
}

const isoDay = d => d.toISOString().slice(0, 10);

// from/to for the AI usage report: default the last 30 days, at most a year.
function readPeriod(query) {
  const today = new Date();
  const to = query.to ? readDate(query.to, 'to') : isoDay(today);
  const from = query.from
    ? readDate(query.from, 'from')
    : isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - (AI_DEFAULT_DAYS - 1) * 86400000));
  if (from > to) throw new HttpError(400, 'VALIDATION', 'The start date must be on or before the end date.');
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days > AI_MAX_DAYS) throw new HttpError(400, 'VALIDATION', `The period can be at most ${AI_MAX_DAYS} days.`);
  return { from, to };
}

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : null);

// ---------------------------------------------------------------------
// 1. Cohort progress — one row per trainee per plan (FR9 numbers)
// ---------------------------------------------------------------------

async function cohortProgress(query) {
  const plan = query.planId ? await readPlan(query.planId) : null;
  const dept = query.departmentId ? await readDepartment(query.departmentId) : null;
  const status = query.status ? readStatus(query.status) : null;

  const { rows } = await db.query(
    `WITH ${PROGRESS_CTE}
     SELECT u.full_name, u.email, d.dept_name, tp.plan_name,
            to_char(ap.assigned_date, 'YYYY-MM-DD') AS assigned_date,
            to_char(ap.end_date, 'YYYY-MM-DD')      AS due_date,
            ap.completed_courses, ap.total_courses, ap.completion_pct,
            ap.status, ap.overdue, ap.last_activity_at
       FROM ap
       JOIN users u            ON u.user_id = ap.trainee_id
       JOIN training_plans tp  ON tp.plan_id = ap.plan_id
       LEFT JOIN departments d ON d.dept_id = u.dept_id
      WHERE ($1::uuid IS NULL OR ap.plan_id = $1)
        AND ($2::uuid IS NULL OR u.dept_id = $2)
        AND ($3::text IS NULL OR ap.status = $3)
      ORDER BY ap.overdue DESC, d.dept_name NULLS LAST, u.full_name, tp.end_date`,
    [plan?.id ?? null, dept?.id ?? null, status?.id ?? null]);

  const trainees = new Set(rows.map(r => r.email)).size;
  const avg = rows.length ? Math.floor(rows.reduce((s, r) => s + r.completion_pct, 0) / rows.length) : null;

  return {
    filters: [
      plan && { label: 'Plan', value: plan.label },
      dept && { label: 'Department', value: dept.label },
      status && { label: 'Status', value: status.label },
    ],
    summary: [
      { label: 'Trainees', value: trainees, type: 'int' },
      { label: 'Plan assignments', value: rows.length, type: 'int' },
      { label: 'Average completion', value: avg, type: 'pct' },
      { label: 'Completed', value: rows.filter(r => r.status === 'completed').length, type: 'int' },
      { label: 'Overdue', value: rows.filter(r => r.overdue).length, type: 'int' },
    ],
    sections: [{
      title: 'Progress by trainee and plan',
      columns: [
        { key: 'trainee', label: 'Trainee', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'plan', label: 'Plan', type: 'text' },
        { key: 'assigned', label: 'Assigned', type: 'date' },
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'courses', label: 'Courses done', type: 'text' },
        { key: 'completion', label: 'Completion', type: 'pct' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'lastActivity', label: 'Last activity', type: 'date' },
      ],
      rows: rows.map(r => ({
        trainee: r.full_name,
        department: r.dept_name,
        plan: r.plan_name,
        assigned: r.assigned_date,
        due: r.due_date,
        courses: `${r.completed_courses} / ${r.total_courses}`,
        completion: r.completion_pct,
        status: STATUS_LABELS[r.status],
        lastActivity: r.last_activity_at ? isoDay(r.last_activity_at) : null,
      })),
      empty: 'No plan assignments match these filters.',
    }],
    notes: [
      'Completion is the average of the plan\'s courses for the trainee (a course not opened counts as 0%), rounded down.',
      'Overdue: the plan\'s due date has passed and not every course is complete.',
      'Deactivated users are not included.',
    ],
  };
}

// ---------------------------------------------------------------------
// 2. Plan completion summary — one row per plan
// ---------------------------------------------------------------------

async function planSummary() {
  const { rows } = await db.query(
    `WITH ${PROGRESS_CTE}, ${PLAN_STATS_CTE},
     plan_courses AS (
       SELECT plan_id, COUNT(*)::int AS courses, COALESCE(SUM(duration), 0)::int AS minutes
         FROM courses GROUP BY plan_id
     ),
     plan_ratings AS (
       SELECT c.plan_id, AVG(f.rating) AS avg_rating, COUNT(*)::int AS ratings
         FROM ${analytics.ACTIVE_FEEDBACK}
         JOIN courses c ON c.course_id = f.course_id
        GROUP BY c.plan_id
     )
     SELECT tp.plan_name,
            to_char(tp.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(tp.end_date, 'YYYY-MM-DD')   AS due_date,
            COALESCE(pc.courses, 0) AS courses, COALESCE(pc.minutes, 0) AS minutes,
            COALESCE(ps.assigned_count, 0)    AS assigned,
            COALESCE(ps.completed_count, 0)   AS completed,
            COALESCE(ps.overdue_count, 0)     AS overdue,
            COALESCE(ps.not_started_count, 0) AS not_started,
            ps.avg_completion, pr.avg_rating
       FROM training_plans tp
       LEFT JOIN plan_stats ps   ON ps.plan_id = tp.plan_id
       LEFT JOIN plan_courses pc ON pc.plan_id = tp.plan_id
       LEFT JOIN plan_ratings pr ON pr.plan_id = tp.plan_id
      ORDER BY tp.end_date, tp.plan_name`);

  const assigned = rows.reduce((s, r) => s + r.assigned, 0);
  const completed = rows.reduce((s, r) => s + r.completed, 0);

  return {
    filters: [],
    summary: [
      { label: 'Training plans', value: rows.length, type: 'int' },
      { label: 'Assignments', value: assigned, type: 'int' },
      { label: 'Completed', value: completed, type: 'int' },
      { label: 'Completion rate', value: pct(completed, assigned), type: 'pct' },
      { label: 'Overdue', value: rows.reduce((s, r) => s + r.overdue, 0), type: 'int' },
    ],
    sections: [{
      title: 'Completion by plan',
      columns: [
        { key: 'plan', label: 'Plan', type: 'text' },
        { key: 'start', label: 'Start', type: 'date' },
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'courses', label: 'Courses', type: 'int' },
        { key: 'hours', label: 'Hours', type: 'text' },
        { key: 'assigned', label: 'Assigned', type: 'int' },
        { key: 'completed', label: 'Completed', type: 'int' },
        { key: 'overdue', label: 'Overdue', type: 'int' },
        { key: 'notStarted', label: 'Not started', type: 'int' },
        { key: 'avgCompletion', label: 'Avg. completion', type: 'pct' },
        { key: 'avgRating', label: 'Avg. rating', type: 'rating' },
      ],
      rows: rows.map(r => ({
        plan: r.plan_name,
        start: r.start_date,
        due: r.due_date,
        courses: r.courses,
        hours: (r.minutes / 60).toFixed(1),
        assigned: r.assigned,
        completed: r.completed,
        overdue: r.overdue,
        notStarted: r.not_started,
        avgCompletion: r.avg_completion,
        avgRating: analytics.round1(r.avg_rating),
      })),
      empty: 'There are no training plans yet.',
    }],
    notes: [
      'Completion rate: completed plan assignments out of all plan assignments.',
      'Average completion and ratings count active trainees only.',
    ],
  };
}

// ---------------------------------------------------------------------
// 3. Course feedback and sentiment — one row per course (FR6 data)
// ---------------------------------------------------------------------

async function feedbackReport(query) {
  const plan = query.planId ? await readPlan(query.planId) : null;
  const params = [...analytics.SENTIMENT_PARAMS, plan?.id ?? null];

  const { rows } = await db.query(
    `SELECT tp.plan_name, c.course_name, c.sequence_order,
            COUNT(*)::int AS ratings, AVG(f.rating) AS avg_rating,
            COUNT(f.comment)::int AS comments,
            ${analytics.SENTIMENT_COUNTS}
       FROM ${analytics.ACTIVE_FEEDBACK}
       JOIN courses c         ON c.course_id = f.course_id
       JOIN training_plans tp ON tp.plan_id = c.plan_id
      WHERE ($3::uuid IS NULL OR tp.plan_id = $3)
      GROUP BY tp.plan_id, c.course_id
      ORDER BY tp.plan_name, c.sequence_order`,
    params);

  const { rows: [all] } = await db.query(
    `SELECT COUNT(*)::int AS ratings, AVG(f.rating) AS avg_rating, ${analytics.SENTIMENT_COUNTS}
       FROM ${analytics.ACTIVE_FEEDBACK}
       JOIN courses c ON c.course_id = f.course_id
      WHERE ($3::uuid IS NULL OR c.plan_id = $3)`,
    params);
  const overall = analytics.toSentimentDto(all);

  return {
    filters: [plan && { label: 'Plan', value: plan.label }],
    summary: [
      { label: 'Ratings', value: all.ratings, type: 'int' },
      { label: 'Average rating', value: analytics.round1(all.avg_rating), type: 'rating' },
      { label: 'Positive comments', value: overall.positivePct, type: 'pct' },
      { label: 'Negative comments', value: overall.negativePct, type: 'pct' },
      { label: 'Sentiment score', value: overall.score, type: 'score' },
    ],
    sections: [{
      title: 'Feedback by course',
      columns: [
        { key: 'plan', label: 'Plan', type: 'text' },
        { key: 'course', label: 'Course', type: 'text' },
        { key: 'ratings', label: 'Ratings', type: 'int' },
        { key: 'avgRating', label: 'Avg. rating', type: 'rating' },
        { key: 'comments', label: 'Comments', type: 'int' },
        { key: 'positive', label: 'Positive', type: 'pct' },
        { key: 'neutral', label: 'Neutral', type: 'pct' },
        { key: 'negative', label: 'Negative', type: 'pct' },
        { key: 'score', label: 'Sentiment', type: 'score' },
      ],
      rows: rows.map((r) => {
        const s = analytics.toSentimentDto(r);
        return {
          plan: r.plan_name,
          course: r.course_name,
          ratings: r.ratings,
          avgRating: analytics.round1(r.avg_rating),
          comments: r.comments,
          positive: s.positivePct,
          neutral: s.neutralPct,
          negative: s.negativePct,
          score: s.score,
        };
      }),
      empty: 'No feedback has been given yet.',
    }],
    notes: [
      'Sentiment is scored by the AI from the comment text (not the stars), from -1 to +1; '
        + '+0.25 and above is positive, -0.25 and below is negative.',
      'Sentiment score = % positive minus % negative (-100 to +100).',
      overall.pending > 0
        ? `${overall.pending} comment(s) are still waiting for an AI score and are not in the percentages.`
        : null,
      'Comment text is not printed in reports, so trainees can write freely.',
    ],
  };
}

// ---------------------------------------------------------------------
// 4. KPI and ROI — the Analytics & ROI numbers, with the working shown
// ---------------------------------------------------------------------

const num = n => Number(n).toLocaleString('en-US');

async function roiReport() {
  const r = await analytics.roi();
  const s = r.summary;
  const m = r.model;

  return {
    filters: [],
    summary: [
      { label: 'Training ROI', value: s.roiPct, type: 'pct' },
      { label: `Benefit (${m.currency})`, value: s.benefit, type: 'money' },
      { label: `Cost (${m.currency})`, value: s.cost, type: 'money' },
      { label: `Cost per trainee (${m.currency})`, value: s.costPerTrainee, type: 'money' },
      { label: 'Compliance coverage', value: s.compliance.pct, type: 'pct' },
    ],
    sections: [
      {
        title: 'Operational KPIs (before and after training)',
        columns: [
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'kpi', label: 'KPI', type: 'text' },
          { key: 'before', label: 'Before', type: 'text' },
          { key: 'after', label: 'After', type: 'text' },
          { key: 'change', label: 'Change', type: 'change' },
          { key: 'direction', label: 'Better when', type: 'text' },
          { key: 'units', label: 'Units improved', type: 'text' },
          { key: 'unitValue', label: `Value / unit (${m.currency})`, type: 'money' },
          { key: 'benefit', label: `Benefit (${m.currency})`, type: 'money' },
        ],
        rows: r.kpis.map(k => ({
          department: k.department,
          kpi: k.name,
          before: k.before === null ? null : String(k.before),
          after: k.after === null ? null : String(k.after),
          change: k.changePct,
          direction: k.lowerIsBetter === null ? 'Not valued' : (k.lowerIsBetter ? 'Lower' : 'Higher'),
          units: k.unitsImproved === null ? null : String(k.unitsImproved),
          unitValue: k.unitValue,
          benefit: k.benefit,
        })),
        empty: 'No KPIs have been recorded.',
      },
      {
        title: 'How ROI is calculated',
        columns: [
          { key: 'item', label: 'Item', type: 'text' },
          { key: 'value', label: 'Value', type: 'text' },
        ],
        rows: [
          { item: 'Training hours completed', value: num(s.trainingHours) },
          { item: `Cost per training hour (${m.currency})`, value: num(m.costPerTrainingHour) },
          { item: `Training cost (${m.currency})`, value: num(m.trainingCost) },
          { item: 'Trainees in training', value: num(s.traineesInTraining) },
          { item: `Platform cost per trainee (${m.currency})`, value: num(m.platformCostPerTrainee) },
          { item: `Platform cost (${m.currency})`, value: num(m.platformCost) },
          { item: `Total cost (${m.currency})`, value: num(s.cost) },
          { item: `Benefit from KPIs (${m.currency})`, value: num(s.benefit) },
          { item: 'ROI = (benefit - cost) / cost', value: s.roiPct === null ? '-' : `${s.roiPct}%` },
          {
            item: 'Time to competency (average days)',
            value: s.timeToCompetency.avgDays === null
              ? '-'
              : `${s.timeToCompetency.avgDays} (target ${s.timeToCompetency.targetDays}, ${s.timeToCompetency.completedPlans} completed plans)`,
          },
          { item: 'Compliance coverage', value: `${s.compliance.compliant} of ${s.compliance.total} trainees have no overdue plan` },
        ],
        empty: '',
      },
      {
        title: 'Feedback by plan',
        columns: [
          { key: 'plan', label: 'Plan', type: 'text' },
          { key: 'ratings', label: 'Ratings', type: 'int' },
          { key: 'avgRating', label: 'Avg. rating', type: 'rating' },
          { key: 'score', label: 'Sentiment', type: 'score' },
        ],
        rows: r.sentimentByPlan.map(p => ({
          plan: p.planName, ratings: p.ratings, avgRating: p.avgRating, score: p.score,
        })),
        empty: 'No feedback has been given yet.',
      },
    ],
    notes: [
      `Money values are demo assumptions (services/roiModel.js), not RJ Finance figures: `
        + `${m.costPerTrainingHour} ${m.currency} per training hour and ${m.platformCostPerTrainee} ${m.currency} `
        + 'platform cost per trainee. Replace them with real figures before using this report for decisions.',
      'A KPI with no value per unit is shown but adds nothing to the benefit.',
      `Time to competency: days from assignment to the last activity on a completed plan (target ${roiModel.COMPETENCY_TARGET_DAYS}).`,
    ],
  };
}

// ---------------------------------------------------------------------
// 5. AI Assistant usage — counts only, never question text (FR10–FR12)
// ---------------------------------------------------------------------

// Bot replies in the period, from active users. One bot reply = one question.
const BOT_REPLIES = `
  bot AS (
    SELECT m.message_id, m.outcome, m.citations, m.related_course_ids, s.user_id, r.role_name
      FROM chat_messages m
      JOIN chat_sessions s ON s.session_id = m.session_id
      JOIN users u         ON u.user_id = s.user_id AND u.is_active
      JOIN roles r         ON r.role_id = u.role_id
     WHERE m.sender_role = 'bot'
       AND m.created_at >= $1::date
       AND m.created_at <  $2::date + 1
  )`;

async function aiUsage(query) {
  const { from, to } = readPeriod(query);
  const params = [from, to];

  const [byRole, courses, sources] = await Promise.all([
    db.query(
      `WITH ${BOT_REPLIES}
       SELECT r.role_name,
              COUNT(DISTINCT bot.user_id)::int                              AS users,
              COUNT(bot.message_id)::int                                    AS questions,
              COUNT(*) FILTER (WHERE bot.outcome = 'answered')::int         AS answered,
              COUNT(*) FILTER (WHERE bot.outcome = 'not_found')::int        AS not_found,
              COUNT(*) FILTER (WHERE bot.outcome = 'refused')::int          AS refused
         FROM roles r
         LEFT JOIN bot ON bot.role_name = r.role_name
        GROUP BY r.role_name
        ORDER BY CASE r.role_name WHEN 'Trainee' THEN 0 WHEN 'Trainer' THEN 1 ELSE 2 END`,
      params),
    // Courses that trainees' questions were linked to.
    db.query(
      `WITH ${BOT_REPLIES},
       asked AS (
         SELECT user_id, outcome, unnest(related_course_ids) AS course_id
           FROM bot WHERE role_name = 'Trainee'
       )
       SELECT c.course_name, tp.plan_name,
              COUNT(DISTINCT asked.user_id)::int                         AS trainees,
              COUNT(*)::int                                              AS questions,
              COUNT(*) FILTER (WHERE asked.outcome <> 'answered')::int   AS unanswered
         FROM asked
         JOIN courses c         ON c.course_id = asked.course_id
         JOIN training_plans tp ON tp.plan_id = c.plan_id
        GROUP BY c.course_id, tp.plan_id
        ORDER BY questions DESC, trainees DESC, c.course_name
        LIMIT 15`,
      params),
    // The SOPs answers cited most.
    db.query(
      `WITH ${BOT_REPLIES}
       SELECT cite->>'title' AS title, COALESCE(cite->>'section', '') AS section, COUNT(*)::int AS citations
         FROM bot
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bot.citations, '[]'::jsonb)) AS cite
        GROUP BY 1, 2
        ORDER BY citations DESC, title, section
        LIMIT 15`,
      params),
  ]);

  const totals = byRole.rows.reduce((t, r) => ({
    users: t.users + r.users,
    questions: t.questions + r.questions,
    answered: t.answered + r.answered,
    notFound: t.notFound + r.not_found,
    refused: t.refused + r.refused,
  }), { users: 0, questions: 0, answered: 0, notFound: 0, refused: 0 });

  return {
    filters: [{ label: 'Period', value: `${from} to ${to}` }],
    summary: [
      { label: 'Questions asked', value: totals.questions, type: 'int' },
      { label: 'People asking', value: totals.users, type: 'int' },
      { label: 'Answered from SOPs', value: pct(totals.answered, totals.questions), type: 'pct' },
      { label: 'Not found in SOPs', value: totals.notFound, type: 'int' },
      { label: 'Refused (safety)', value: totals.refused, type: 'int' },
    ],
    sections: [
      {
        title: 'Questions by role',
        columns: [
          { key: 'role', label: 'Role', type: 'text' },
          { key: 'users', label: 'People', type: 'int' },
          { key: 'questions', label: 'Questions', type: 'int' },
          { key: 'answered', label: 'Answered', type: 'int' },
          { key: 'notFound', label: 'Not found', type: 'int' },
          { key: 'refused', label: 'Refused', type: 'int' },
          { key: 'answeredPct', label: 'Answered %', type: 'pct' },
        ],
        rows: byRole.rows.map(r => ({
          role: r.role_name,
          users: r.users,
          questions: r.questions,
          answered: r.answered,
          notFound: r.not_found,
          refused: r.refused,
          answeredPct: pct(r.answered, r.questions),
        })),
        empty: '',
      },
      {
        title: 'Courses trainees asked about (possible knowledge gaps)',
        columns: [
          { key: 'course', label: 'Course', type: 'text' },
          { key: 'plan', label: 'Plan', type: 'text' },
          { key: 'trainees', label: 'Trainees', type: 'int' },
          { key: 'questions', label: 'Questions', type: 'int' },
          { key: 'unanswered', label: 'Not answered', type: 'int' },
        ],
        rows: courses.rows.map(r => ({
          course: r.course_name, plan: r.plan_name, trainees: r.trainees, questions: r.questions, unanswered: r.unanswered,
        })),
        empty: 'No trainee questions were linked to a course in this period.',
      },
      {
        title: 'Most cited SOPs',
        columns: [
          { key: 'title', label: 'SOP', type: 'text' },
          { key: 'section', label: 'Section', type: 'text' },
          { key: 'citations', label: 'Citations', type: 'int' },
        ],
        rows: sources.rows.map(r => ({ title: r.title, section: r.section || null, citations: r.citations })),
        empty: 'No answers cited an SOP in this period.',
      },
    ],
    notes: [
      'Counts only: the text of questions and answers is never included in reports.',
      'A question is linked to a course when the AI Assistant suggested that course as related.',
      'Not found: the SOP library had nothing relevant, so the assistant did not answer.',
    ],
  };
}

// ---------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------

const REPORTS = [
  {
    id: 'cohort-progress',
    title: 'Cohort Progress',
    description: 'Every trainee\'s progress on each assigned plan: completion, status, due date and last activity.',
    filters: ['planId', 'departmentId', 'status'],
    build: cohortProgress,
  },
  {
    id: 'plan-summary',
    title: 'Plan Completion Summary',
    description: 'One line per training plan: assignments, completions, overdue trainees and average rating.',
    filters: [],
    build: planSummary,
  },
  {
    id: 'feedback',
    title: 'Course Feedback & Sentiment',
    description: 'Ratings and AI-scored comment sentiment per course. Comment text is not included.',
    filters: ['planId'],
    build: feedbackReport,
  },
  {
    id: 'roi',
    title: 'KPI & Training ROI',
    description: 'KPI changes before and after training, costs, benefit and ROI, with the calculation shown.',
    filters: [],
    build: roiReport,
  },
  {
    id: 'ai-usage',
    title: 'AI Assistant Usage',
    description: 'Questions asked per role, answer outcomes, courses asked about and most cited SOPs, for a period.',
    filters: ['from', 'to'],
    build: aiUsage,
  },
];

function list() {
  return REPORTS.map(({ id, title, description, filters }) => ({ id, title, description, filters }));
}

function find(id) {
  const report = REPORTS.find(r => r.id === id);
  if (!report) throw new HttpError(404, 'REPORT_NOT_FOUND', 'That report does not exist.');
  return report;
}

// Only the filters this report accepts are read from the query string.
function pickFilters(report, query) {
  const out = {};
  for (const key of report.filters) {
    if (typeof query[key] === 'string' && query[key].trim() !== '') out[key] = query[key].trim();
  }
  return out;
}

// → the report object described at the top of this file.
async function build(id, query = {}) {
  const report = find(id);
  const applied = pickFilters(report, query);
  const result = await report.build(applied);
  return {
    id: report.id,
    title: report.title,
    description: report.description,
    generatedAt: new Date().toISOString(),
    filters: result.filters.filter(Boolean),
    summary: result.summary,
    sections: result.sections,
    notes: result.notes.filter(Boolean),
  };
}

module.exports = { list, build, find, STATUSES, AI_DEFAULT_DAYS, AI_MAX_DAYS };
