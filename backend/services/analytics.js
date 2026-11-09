// Phase 7: the numbers behind Trainer Overview and Analytics & ROI.
//
// Everything is computed from the database on each request, like FR9
// progress, so the screens can never show stale totals. Completion, overdue
// and status come from services/progress.js (PROGRESS_CTE), so a trainer sees
// the same numbers here as on Training Plans and My Trainees. Deactivated
// users are left out everywhere (their history stays in the database).
//
// Definitions (each one is used by exactly one place below):
//
//   cohort completion   average completion of assignments whose plan has
//                       started (an upcoming plan is 0% by nature, so it
//                       would only pull the average down)
//   at risk             a trainee with an overdue plan, or with a started
//                       plan due within AT_RISK_DAYS that is under
//                       AT_RISK_BELOW_PCT complete
//   sentiment           AI score of the comment (services/sentiment.js),
//                       bucketed positive / neutral / negative; the
//                       "NPS-style" score is % positive − % negative
//   knowledge gap       a course that many of its trainees asked the AI
//                       Assistant about in the last GAP_WINDOW_DAYS. The
//                       chatbot links each answer to related courses
//                       (chat_messages.related_course_ids, migration 004).
//                       Trainees asking about a course they are studying is
//                       a sign the material leaves them unsure; questions the
//                       SOPs could not answer weigh more. No question text is
//                       shown, only counts and the SOP sections cited.
//   ROI and costs       services/roiModel.js (stated demo assumptions)
const db = require('../db');
const { PROGRESS_CTE, PLAN_STATS_CTE, toStatsDto } = require('./progress');
const { POSITIVE_FROM, NEGATIVE_UPTO } = require('./sentiment');
const roiModel = require('./roiModel');

const AT_RISK_DAYS = 14;
const AT_RISK_BELOW_PCT = 50;
const GAP_WINDOW_DAYS = 30;
const GAP_MIN_TRAINEES = 2;          // one person asking is not a pattern
const GAP_LIMIT = 5;
const ATTENTION_LIMIT = 6;

// Use after PROGRESS_CTE, with training_plans joined as tp.
const BEHIND_SQL = `(ap.status <> 'completed' AND NOT ap.overdue
  AND tp.start_date <= CURRENT_DATE
  AND ap.end_date - CURRENT_DATE <= ${AT_RISK_DAYS}
  AND ap.completion_pct < ${AT_RISK_BELOW_PCT})`;

// Only active users' feedback, like progress.
const ACTIVE_FEEDBACK = `
  feedback f
  JOIN users fu ON fu.user_id = f.trainee_id AND fu.is_active`;

// Sentiment counts over the rows of ACTIVE_FEEDBACK. $1 = positive from, $2 = negative up to.
const SENTIMENT_COUNTS = `
  COUNT(f.sentiment_score)::int                                           AS scored,
  COUNT(*) FILTER (WHERE f.sentiment_score >= $1)::int                    AS positive,
  COUNT(*) FILTER (WHERE f.sentiment_score <= $2)::int                    AS negative,
  COUNT(*) FILTER (WHERE f.comment IS NOT NULL AND f.sentiment_score IS NULL)::int AS pending`;
const SENTIMENT_PARAMS = [POSITIVE_FROM, NEGATIVE_UPTO];

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : null);
const round1 = n => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10);

function toSentimentDto(row) {
  const neutral = row.scored - row.positive - row.negative;
  const positivePct = pct(row.positive, row.scored);
  const negativePct = pct(row.negative, row.scored);
  return {
    responses: row.scored,                 // comments with a score
    pending: row.pending,                  // comments still waiting for the AI
    positivePct,
    neutralPct: pct(neutral, row.scored),
    negativePct,
    // −100 … +100, like an NPS: share of happy minus share of unhappy
    score: row.scored > 0 ? positivePct - negativePct : null,
  };
}

// ---------------------------------------------------------------------
// Trainer Overview
// ---------------------------------------------------------------------

async function cohortSummary() {
  const { rows: [r] } = await db.query(
    `WITH ${PROGRESS_CTE},
     per_trainee AS (
       SELECT ap.trainee_id,
              BOOL_OR(ap.overdue)     AS overdue,
              BOOL_OR(${BEHIND_SQL})  AS behind,
              MIN(ap.assigned_date)   AS first_assigned
         FROM ap JOIN training_plans tp ON tp.plan_id = ap.plan_id
        GROUP BY ap.trainee_id
     )
     SELECT
       (SELECT COUNT(*) FROM per_trainee)::int                                      AS active_trainees,
       (SELECT COUNT(*) FROM per_trainee WHERE first_assigned > CURRENT_DATE - 7)::int AS new_this_week,
       (SELECT COUNT(*) FROM per_trainee WHERE overdue OR behind)::int              AS at_risk,
       (SELECT COUNT(*) FROM per_trainee WHERE overdue)::int                        AS overdue_trainees,
       (SELECT FLOOR(AVG(ap.completion_pct)) FROM ap
          JOIN training_plans tp ON tp.plan_id = ap.plan_id
         WHERE tp.start_date <= CURRENT_DATE)::int                                  AS avg_completion,
       (SELECT COUNT(*) FROM ap WHERE ap.status = 'completed')::int                 AS completed_assignments,
       (SELECT COUNT(*) FROM ap)::int                                               AS assignments`);
  return r;
}

async function feedbackSummary() {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*)::int AS ratings, AVG(f.rating) AS avg_rating, ${SENTIMENT_COUNTS}
       FROM ${ACTIVE_FEEDBACK}`,
    SENTIMENT_PARAMS);

  // Best and worst rated course, among courses with at least 2 ratings.
  const { rows: courses } = await db.query(
    `SELECT c.course_id, c.course_name, tp.plan_name,
            AVG(f.rating) AS avg_rating, COUNT(*)::int AS ratings
       FROM ${ACTIVE_FEEDBACK}
       JOIN courses c         ON c.course_id = f.course_id
       JOIN training_plans tp ON tp.plan_id = c.plan_id
      GROUP BY c.course_id, tp.plan_id
     HAVING COUNT(*) >= 2
      ORDER BY AVG(f.rating), COUNT(*) DESC, c.course_name`);
  const courseDto = c => (c ? {
    courseId: c.course_id, courseName: c.course_name, planName: c.plan_name,
    avgRating: round1(c.avg_rating), ratings: c.ratings,
  } : null);

  return {
    ratings: r.ratings,
    avgRating: round1(r.avg_rating),
    sentiment: toSentimentDto(r),
    lowestRated: courseDto(courses[0]),
    highestRated: courses.length > 1 ? courseDto(courses[courses.length - 1]) : null,
  };
}

async function planCompletion() {
  const { rows } = await db.query(
    `WITH ${PROGRESS_CTE}, ${PLAN_STATS_CTE}
     SELECT tp.plan_id, tp.plan_name,
            to_char(tp.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(tp.end_date, 'YYYY-MM-DD')   AS due_date,
            (tp.start_date > CURRENT_DATE)       AS upcoming,
            ps.*
       FROM training_plans tp
       JOIN plan_stats ps ON ps.plan_id = tp.plan_id
      ORDER BY (tp.start_date > CURRENT_DATE), ps.avg_completion DESC, tp.plan_name`);
  return rows.map(r => ({
    planId: r.plan_id,
    planName: r.plan_name,
    startDate: r.start_date,
    dueDate: r.due_date,
    upcoming: r.upcoming,
    ...toStatsDto(r),
  }));
}

// Bot replies to trainees in the window, one row per related course.
const ASKED_CTE = `
  asked AS (
    SELECT s.user_id, m.outcome, m.citations, unnest(m.related_course_ids) AS course_id
      FROM chat_messages m
      JOIN chat_sessions s ON s.session_id = m.session_id
      JOIN users u         ON u.user_id = s.user_id AND u.is_active
      JOIN roles r         ON r.role_id = u.role_id AND r.role_name = 'Trainee'
     WHERE m.sender_role = 'bot'
       AND m.created_at > NOW() - make_interval(days => $1)
  )`;

function gapSeverity(askRate, unanswered) {
  if ((askRate ?? 0) >= 0.3 || unanswered >= 3) return 'high';
  if ((askRate ?? 0) >= 0.15 || unanswered >= 1) return 'medium';
  return 'low';
}

async function knowledgeGaps() {
  const { rows } = await db.query(
    `WITH ${PROGRESS_CTE}, ${ASKED_CTE},
     per_course AS (
       SELECT course_id,
              COUNT(DISTINCT user_id)::int                         AS trainees_asked,
              COUNT(*)::int                                        AS questions,
              COUNT(*) FILTER (WHERE outcome <> 'answered')::int   AS unanswered
         FROM asked GROUP BY course_id
     ),
     assigned AS (
       SELECT c.course_id, COUNT(ap.trainee_id)::int AS assigned
         FROM courses c JOIN ap ON ap.plan_id = c.plan_id
        GROUP BY c.course_id
     )
     SELECT pc.*, c.course_name, tp.plan_id, tp.plan_name, COALESCE(a.assigned, 0) AS assigned
       FROM per_course pc
       JOIN courses c         ON c.course_id = pc.course_id
       JOIN training_plans tp ON tp.plan_id = c.plan_id
       LEFT JOIN assigned a   ON a.course_id = pc.course_id
      WHERE pc.trainees_asked >= $2`,
    [GAP_WINDOW_DAYS, GAP_MIN_TRAINEES]);

  // The SOP section cited most often in those answers names the topic.
  const { rows: sections } = await db.query(
    `WITH ${ASKED_CTE}
     SELECT asked.course_id, cite->>'title' AS title, cite->>'section' AS section, COUNT(*)::int AS n
       FROM asked
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(asked.citations, '[]'::jsonb)) AS cite
      GROUP BY asked.course_id, cite->>'title', cite->>'section'
      ORDER BY n DESC, section`,
    [GAP_WINDOW_DAYS]);

  const { rows: [unanswered] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM chat_messages
      WHERE sender_role = 'bot' AND outcome = 'not_found'
        AND created_at > NOW() - make_interval(days => $1)`,
    [GAP_WINDOW_DAYS]);

  const gaps = rows.map((r) => {
    const top = sections.find(s => s.course_id === r.course_id);
    const askRate = r.assigned > 0 ? Math.min(1, r.trainees_asked / r.assigned) : null;
    return {
      courseId: r.course_id,
      courseName: r.course_name,
      planId: r.plan_id,
      planName: r.plan_name,
      traineesAsked: r.trainees_asked,
      traineesAssigned: r.assigned,
      askRatePct: askRate === null ? null : Math.round(askRate * 100),
      questions: r.questions,
      unanswered: r.unanswered,
      topSource: top ? { title: top.title, section: top.section } : null,
      severity: gapSeverity(askRate, r.unanswered),
    };
  });
  const ORDER = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]
    || (b.askRatePct ?? 0) - (a.askRatePct ?? 0) || b.questions - a.questions);

  return {
    windowDays: GAP_WINDOW_DAYS,
    unansweredQuestions: unanswered.n,
    gaps: gaps.slice(0, GAP_LIMIT),
  };
}

// The trainees a trainer should look at first: overdue, then behind, then
// nearest due date. One row per trainee (their most urgent plan).
async function needsAttention() {
  const { rows } = await db.query(
    `WITH ${PROGRESS_CTE}
     SELECT * FROM (
       SELECT DISTINCT ON (ap.trainee_id)
              ap.trainee_id, u.full_name, d.dept_name, ap.plan_id, tp.plan_name,
              ap.completion_pct, ap.last_activity_at, ap.status, ap.overdue,
              ${BEHIND_SQL} AS behind, ap.end_date,
              to_char(ap.end_date, 'YYYY-MM-DD') AS due_date
         FROM ap
         JOIN users u            ON u.user_id = ap.trainee_id
         JOIN training_plans tp  ON tp.plan_id = ap.plan_id
         LEFT JOIN departments d ON d.dept_id = u.dept_id
        WHERE ap.status <> 'completed' AND tp.start_date <= CURRENT_DATE
        ORDER BY ap.trainee_id, ap.overdue DESC, ${BEHIND_SQL} DESC, ap.end_date, ap.completion_pct
     ) worst
     ORDER BY overdue DESC, behind DESC, end_date, completion_pct, full_name
     LIMIT $1`,
    [ATTENTION_LIMIT]);
  return rows.map(r => ({
    traineeId: r.trainee_id,
    fullName: r.full_name,
    department: r.dept_name,
    planId: r.plan_id,
    planName: r.plan_name,
    dueDate: r.due_date,
    completionPct: r.completion_pct,
    lastActivityAt: r.last_activity_at,
    status: r.status,
    atRisk: r.overdue || r.behind,
  }));
}

// GET /api/analytics/overview
async function overview() {
  const [cohort, feedback, plans, gaps, trainees] = await Promise.all([
    cohortSummary(), feedbackSummary(), planCompletion(), knowledgeGaps(), needsAttention(),
  ]);
  return {
    summary: {
      activeTrainees: cohort.active_trainees,
      newThisWeek: cohort.new_this_week,
      avgCompletion: cohort.avg_completion,
      completedAssignments: cohort.completed_assignments,
      assignments: cohort.assignments,
      atRisk: cohort.at_risk,
      overdueTrainees: cohort.overdue_trainees,
      avgRating: feedback.avgRating,
      ratings: feedback.ratings,
    },
    sentiment: {
      ...feedback.sentiment,
      lowestRated: feedback.lowestRated,
      highestRated: feedback.highestRated,
    },
    plans,
    knowledgeGaps: gaps,
    trainees,
    definitions: { atRiskDays: AT_RISK_DAYS, atRiskBelowPct: AT_RISK_BELOW_PCT },
  };
}

// ---------------------------------------------------------------------
// Analytics & ROI
// ---------------------------------------------------------------------

function toKpiDto(r) {
  const before = r.value_before === null ? null : Number(r.value_before);
  const after = r.value_after === null ? null : Number(r.value_after);
  const model = roiModel.kpiValue(r.kpi_name);
  const measured = before !== null && after !== null;
  // Units better than before (negative = worse), in the KPI's own unit.
  const unitsImproved = measured && model
    ? Math.round((model.lowerIsBetter ? before - after : after - before) * 100) / 100
    : null;
  return {
    id: r.kpi_id,
    name: r.kpi_name,
    department: r.dept_name,
    before,
    after,
    changePct: measured && before !== 0 ? Math.round(((after - before) / before) * 100) : null,
    lowerIsBetter: model ? model.lowerIsBetter : null,
    improved: unitsImproved === null ? null : unitsImproved > 0,
    unitsImproved,
    unitValue: model ? model.unitValue : null,
    benefit: unitsImproved === null ? null : Math.round(unitsImproved * model.unitValue),
  };
}

// GET /api/analytics/roi
async function roi() {
  const [kpiRows, cost, ttc, compliance, byPlan] = await Promise.all([
    db.query(
      `SELECT k.kpi_id, k.kpi_name, k.value_before, k.value_after, d.dept_name
         FROM kpis k JOIN departments d ON d.dept_id = k.dept_id
        ORDER BY d.dept_name, k.kpi_name`),
    db.query(
      `WITH ${PROGRESS_CTE}
       SELECT
         (SELECT COUNT(DISTINCT ap.trainee_id) FROM ap
            JOIN training_plans tp ON tp.plan_id = ap.plan_id
           WHERE tp.start_date <= CURRENT_DATE)::int AS trainees,
         (SELECT COALESCE(SUM(c.duration * pr.completion_pct / 100.0), 0)
            FROM progress pr
            JOIN courses c ON c.course_id = pr.course_id
            JOIN users u   ON u.user_id = pr.trainee_id AND u.is_active) AS minutes`),
    // Time-to-competency: days from assignment to the last step of a completed plan.
    db.query(
      `WITH ${PROGRESS_CTE}
       SELECT AVG(GREATEST(ap.last_activity_at::date - ap.assigned_date, 0)) AS avg_days,
              COUNT(*)::int AS completed
         FROM ap
        WHERE ap.status = 'completed' AND ap.last_activity_at IS NOT NULL`),
    // Compliance coverage: trainees with no overdue plan.
    db.query(
      `WITH ${PROGRESS_CTE}
       SELECT COUNT(*) FILTER (WHERE NOT has_overdue)::int AS compliant, COUNT(*)::int AS total
         FROM (SELECT trainee_id, BOOL_OR(overdue) AS has_overdue FROM ap GROUP BY trainee_id) t`),
    db.query(
      `SELECT tp.plan_id, tp.plan_name, COUNT(*)::int AS ratings, AVG(f.rating) AS avg_rating,
              ${SENTIMENT_COUNTS}
         FROM ${ACTIVE_FEEDBACK}
         JOIN courses c         ON c.course_id = f.course_id
         JOIN training_plans tp ON tp.plan_id = c.plan_id
        GROUP BY tp.plan_id
        ORDER BY tp.plan_name`,
      SENTIMENT_PARAMS),
  ]);

  const kpis = kpiRows.rows.map(toKpiDto);
  const benefit = kpis.reduce((sum, k) => sum + (k.benefit ?? 0), 0);

  const { trainees, minutes } = cost.rows[0];
  const hours = Number(minutes) / 60;
  const trainingCost = Math.round(hours * roiModel.COST_PER_TRAINING_HOUR);
  const platformCost = trainees * roiModel.PLATFORM_COST_PER_TRAINEE;
  const totalCost = trainingCost + platformCost;

  const t = ttc.rows[0];
  const c = compliance.rows[0];

  return {
    summary: {
      roiPct: totalCost > 0 ? Math.round(((benefit - totalCost) / totalCost) * 100) : null,
      benefit,
      cost: totalCost,
      costPerTrainee: trainees > 0 ? Math.round(totalCost / trainees) : null,
      traineesInTraining: trainees,
      trainingHours: Math.round(hours),
      timeToCompetency: {
        avgDays: t.completed > 0 ? Math.round(Number(t.avg_days)) : null,
        targetDays: roiModel.COMPETENCY_TARGET_DAYS,
        completedPlans: t.completed,
      },
      compliance: { pct: pct(c.compliant, c.total), compliant: c.compliant, total: c.total },
    },
    kpis,
    sentimentByPlan: byPlan.rows.map(r => ({
      planId: r.plan_id,
      planName: r.plan_name,
      ratings: r.ratings,
      avgRating: round1(r.avg_rating),
      ...toSentimentDto(r),
    })),
    model: {
      currency: roiModel.CURRENCY,
      costPerTrainingHour: roiModel.COST_PER_TRAINING_HOUR,
      platformCostPerTrainee: roiModel.PLATFORM_COST_PER_TRAINEE,
      trainingCost,
      platformCost,
    },
  };
}

module.exports = { overview, roi, gapSeverity, AT_RISK_DAYS, AT_RISK_BELOW_PCT, GAP_WINDOW_DAYS };
