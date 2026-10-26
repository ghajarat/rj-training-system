// /api/chat — the AI Assistant (FR10, FR11, FR12, NFR18). Every role may use
// it; each user only ever sees their own conversations.
//
//   GET    /api/chat/sessions                 my sessions, newest first, + SOP count
//   POST   /api/chat/sessions                 start an empty session
//   GET    /api/chat/sessions/:id/messages    history with citations         FR12
//   DELETE /api/chat/sessions/:id             delete a session and its messages
//   POST   /api/chat/sessions/:id/messages    { text } → grounded answer     FR10/FR11
//
// The user is always req.user.id (from the verified token), never the URL
// or body. A session id that is not mine answers 404 SESSION_NOT_FOUND.
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const config = require('../config');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const { requireUuid } = require('../utils/validate');
const history = require('../services/chatHistory');
const { answerQuestion, logTimings } = require('../services/rag/answer');

const router = express.Router();

const QUESTION_MAX = 2000;

router.use(authenticate, authorize('Trainee', 'Trainer', 'Admin'));

// Each question costs API calls, so each user may ask at most
// CHAT_RATE_LIMIT_PER_MIN per minute. Counted per user (not per IP, which
// a whole office may share). In memory: resets when the server restarts.
const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.chat.rateLimitPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: req => req.user.id,
  handler: (req, res, next) => next(new HttpError(429, 'RATE_LIMITED',
    'You are sending questions too quickly. Please wait a minute and try again.')),
});

function readQuestion(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, 'VALIDATION', 'Type a question first.');
  if (text.length > QUESTION_MAX) {
    throw new HttpError(400, 'VALIDATION', `Questions can be at most ${QUESTION_MAX} characters. Please shorten it.`);
  }
  return text;
}

router.get('/sessions', async (req, res) => {
  const [sessions, documentCount] = await Promise.all([
    history.listSessions(req.user.id),
    history.countSearchableDocuments(),
  ]);
  res.json({ sessions, documentCount });
});

router.post('/sessions', async (req, res) => {
  res.status(201).json({ session: await history.createSession(req.user.id) });
});

router.get('/sessions/:id/messages', async (req, res) => {
  const sessionId = requireUuid(req.params.id, 'conversation id');
  const session = await history.findOwnSession(sessionId, req.user.id);
  res.json({ session, messages: await history.listMessages(sessionId, req.user) });
});

router.delete('/sessions/:id', async (req, res) => {
  await history.deleteSession(requireUuid(req.params.id, 'conversation id'), req.user.id);
  res.status(204).end();
});

router.post('/sessions/:id/messages', askLimiter, async (req, res) => {
  const sessionId = requireUuid(req.params.id, 'conversation id');
  const question = readQuestion(req.body);
  await history.findOwnSession(sessionId, req.user.id);

  const result = await answerQuestion({
    question,
    history: await history.recentRows(sessionId),
    user: req.user,
  });

  const { userRow, botRow } = await history.saveExchange(sessionId, question, result);
  const [userMessage, message] = await history.toMessageDtos([userRow, botRow], req.user);
  logTimings(result.outcome, result.timings);

  res.status(201).json({
    userMessage,
    message,
    citations: message.citations,
    relatedCourses: message.relatedCourses,
    session: await history.findOwnSession(sessionId, req.user.id),
    timings: result.timings,
  });
});

module.exports = router;
