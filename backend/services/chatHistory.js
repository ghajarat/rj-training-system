// FR12: chat sessions and their messages.
//
// A session belongs to one user (chat_sessions.user_id). Every query here
// takes that user's id, so "only the owner can read it" is part of the SQL,
// not a separate check that could be forgotten. Another user's session
// answers 404, as if it did not exist.
//
// No title column: a session's title is its first question, shortened
// (derived, like "last active" in Phase 4a).
const db = require('../db');
const HttpError = require('../utils/httpError');
const { loadCourses } = require('./rag/relatedCourses');

const TITLE_MAX = 60;
const PREVIEW_MAX = 90;

function shorten(text, max) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, '')}…` : clean;
}

const SESSION_SELECT = `
  SELECT s.session_id, s.started_at, first_q.message_text AS first_question,
         last_m.message_text AS last_text, last_m.created_at AS last_message_at,
         COALESCE(counts.n, 0)::int AS message_count
    FROM chat_sessions s
    LEFT JOIN LATERAL (SELECT message_text FROM chat_messages
                        WHERE session_id = s.session_id AND sender_role = 'user'
                        ORDER BY created_at LIMIT 1) first_q ON TRUE
    LEFT JOIN LATERAL (SELECT message_text, created_at FROM chat_messages
                        WHERE session_id = s.session_id
                        ORDER BY created_at DESC LIMIT 1) last_m ON TRUE
    LEFT JOIN LATERAL (SELECT COUNT(*) AS n FROM chat_messages
                        WHERE session_id = s.session_id) counts ON TRUE`;

function toSessionDto(row) {
  return {
    id: row.session_id,
    title: shorten(row.first_question, TITLE_MAX) || 'New conversation',
    preview: shorten(row.last_text?.replace(/\s?\[\d+\]/g, ''), PREVIEW_MAX),
    startedAt: row.started_at,
    lastMessageAt: row.last_message_at || row.started_at,
    messageCount: row.message_count,
  };
}

async function listSessions(userId) {
  const { rows } = await db.query(
    `${SESSION_SELECT}
      WHERE s.user_id = $1
      ORDER BY COALESCE(last_m.created_at, s.started_at) DESC`,
    [userId],
  );
  return rows.map(toSessionDto);
}

async function findOwnSession(sessionId, userId) {
  const { rows } = await db.query(`${SESSION_SELECT} WHERE s.session_id = $1 AND s.user_id = $2`, [sessionId, userId]);
  if (!rows[0]) throw new HttpError(404, 'SESSION_NOT_FOUND', 'This conversation was not found. It may have been deleted.');
  return toSessionDto(rows[0]);
}

async function createSession(userId) {
  const { rows } = await db.query('INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING session_id', [userId]);
  return findOwnSession(rows[0].session_id, userId);
}

async function deleteSession(sessionId, userId) {
  const { rowCount } = await db.query('DELETE FROM chat_sessions WHERE session_id = $1 AND user_id = $2', [sessionId, userId]);
  if (!rowCount) throw new HttpError(404, 'SESSION_NOT_FOUND', 'This conversation was not found. It may have been deleted.');
}

// Raw rows, oldest first, for the prompt's history (services/rag/prompt.js).
async function recentRows(sessionId, limit = 12) {
  const { rows } = await db.query(
    `SELECT sender_role, message_text, outcome FROM (
       SELECT sender_role, message_text, outcome, created_at FROM chat_messages
        WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2) recent
      ORDER BY created_at`,
    [sessionId, limit],
  );
  return rows;
}

function toMessageDto(row, coursesById = new Map()) {
  const isBot = row.sender_role === 'bot';
  return {
    id: row.message_id,
    role: isBot ? 'assistant' : 'user',
    text: row.message_text,
    createdAt: row.created_at,
    outcome: isBot ? row.outcome : null,
    citations: isBot ? row.citations : [],
    relatedCourses: isBot
      ? row.related_course_ids.map(id => coursesById.get(id)).filter(Boolean)
      : [],
  };
}

// Related-course details are fetched in one query for the whole history.
async function toMessageDtos(rows, user) {
  const ids = [...new Set(rows.flatMap(r => r.related_course_ids || []))];
  const courses = await loadCourses(ids, user);
  const byId = new Map(courses.map(c => [c.id, c]));
  return rows.map(r => toMessageDto(r, byId));
}

const MESSAGE_COLUMNS = 'message_id, sender_role, message_text, created_at, outcome, citations, related_course_ids';

async function listMessages(sessionId, user) {
  const { rows } = await db.query(
    `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE session_id = $1 ORDER BY created_at`,
    [sessionId],
  );
  return toMessageDtos(rows, user);
}

// The question and its answer are saved together, or not at all.
// clock_timestamp() (not NOW(), which is fixed for the whole transaction)
// gives the two rows different times, so they always sort question first.
async function saveExchange(sessionId, question, reply) {
  return db.transaction(async (client) => {
    const { rows: [userRow] } = await client.query(
      `INSERT INTO chat_messages (session_id, sender_role, message_text, created_at)
       VALUES ($1, 'user', $2, clock_timestamp()) RETURNING ${MESSAGE_COLUMNS}`,
      [sessionId, question],
    );
    const { rows: [botRow] } = await client.query(
      `INSERT INTO chat_messages (session_id, sender_role, message_text, created_at,
                                  outcome, citations, related_course_ids)
       VALUES ($1, 'bot', $2, clock_timestamp(), $3, $4, $5::uuid[]) RETURNING ${MESSAGE_COLUMNS}`,
      [sessionId, reply.text, reply.outcome, JSON.stringify(reply.citations), reply.relatedCourseIds],
    );
    return { userRow, botRow };
  });
}

async function countSearchableDocuments() {
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM documents WHERE status = 'ready'");
  return rows[0].n;
}

module.exports = {
  listSessions, findOwnSession, createSession, deleteSession, recentRows,
  listMessages, saveExchange, toMessageDtos, countSearchableDocuments,
};
