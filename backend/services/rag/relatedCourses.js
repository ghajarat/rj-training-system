// "Related courses" in the AI Assistant side panel: up to 3 courses closest
// in meaning to the question.
//
// Courses have no description of their own and no link to documents (GP1),
// so "<course name> — <plan name>" is what we can match on. Each course's
// text is embedded once and kept in memory; the question's vector is the one
// already made for SOP retrieval. So a question costs no extra AI call, and
// "my smoke hood indicator is pink" can still find "Fire Fighting On Board"
// even though they share no words (keyword search could not).
//
// The cache is rebuilt after a restart, and a course is re-embedded when its
// name or plan changes. A Trainee only sees courses from plans assigned to
// them, with their own progress; Trainers and Admins see any course.
const db = require('../../db');
const { embed, EMBEDDING_MODEL } = require('../ai/embeddings');

// Course names are short, so their scores run lower than SOP chunks'.
const MIN_SCORE = { 'text-embedding-ada-002': 0.75, 'fake-hash-1536': 0.08 }[EMBEDDING_MODEL] ?? 0.25;

const cache = new Map(); // course_id → { text, vector }

function courseText(row) {
  return `${row.course_name} — ${row.plan_name}`;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

async function vectorsFor(rows) {
  const stale = rows.filter(r => cache.get(r.course_id)?.text !== courseText(r));
  if (stale.length) {
    const vectors = await embed(stale.map(courseText));
    stale.forEach((r, i) => cache.set(r.course_id, { text: courseText(r), vector: vectors[i] }));
  }
  return rows.map(r => cache.get(r.course_id).vector);
}

// null for staff; the trainee's id limits the search to their plans.
function traineeIdOf(user) {
  return user.role === 'Trainee' ? user.id : null;
}

async function findRelatedCourseIds(queryVector, user, limit = 3) {
  try {
    const { rows } = await db.query(
      `SELECT c.course_id, c.course_name, p.plan_name
         FROM courses c
         JOIN training_plans p ON p.plan_id = c.plan_id
        WHERE $1::uuid IS NULL OR EXISTS (
              SELECT 1 FROM plan_assignments a WHERE a.plan_id = c.plan_id AND a.trainee_id = $1)`,
      [traineeIdOf(user)],
    );
    if (!rows.length) return [];
    const vectors = await vectorsFor(rows);
    return rows
      .map((r, i) => ({ id: r.course_id, score: cosine(queryVector, vectors[i]) }))
      .filter(r => r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.id);
  } catch (err) {
    // Suggestions are a nice-to-have: never fail an answer because of them.
    console.error(`Related courses skipped: ${err.message}`);
    return [];
  }
}

// Fresh names (and, for trainees, progress) for stored course ids. Courses
// deleted since, or no longer in the trainee's plans, are left out.
async function loadCourses(ids, user) {
  if (!ids.length) return [];
  const traineeId = traineeIdOf(user);
  const { rows } = await db.query(
    `SELECT c.course_id, c.course_name, c.plan_id, p.plan_name, pr.completion_pct
       FROM courses c
       JOIN training_plans p ON p.plan_id = c.plan_id
       LEFT JOIN progress pr ON pr.course_id = c.course_id AND pr.trainee_id = $2
      WHERE c.course_id = ANY($1::uuid[])
        AND ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM plan_assignments a WHERE a.plan_id = c.plan_id AND a.trainee_id = $2))`,
    [ids, traineeId],
  );
  const byId = new Map(rows.map(r => [r.course_id, r]));
  return ids.filter(id => byId.has(id)).map((id) => {
    const r = byId.get(id);
    return {
      id: r.course_id,
      name: r.course_name,
      planId: r.plan_id,
      planName: r.plan_name,
      completionPct: traineeId ? (r.completion_pct ?? 0) : null,
    };
  });
}

module.exports = { findRelatedCourseIds, loadCourses, cosine };
