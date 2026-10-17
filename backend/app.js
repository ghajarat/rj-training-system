// Builds the Express app. Kept separate from server.js so tests can import
// the app without opening a port.
const express = require('express');
const cors = require('cors');
const config = require('./config');
const HttpError = require('./utils/httpError');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const departmentRoutes = require('./routes/departments');
const auditLogRoutes = require('./routes/auditLogs');
const courseRoutes = require('./routes/courses');
const planRoutes = require('./routes/plans');
const traineeRoutes = require('./routes/trainees');

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/trainees', traineeRoutes);

// Unknown API route
app.use('/api', (req, res, next) => {
  next(new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
});

// Every error ends up here (Express 5 forwards rejected async handlers too).
// Responses always look like { error: { code, message } } so the frontend can
// show error.message directly (NFR12).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error(err);
  return res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' },
  });
});

module.exports = app;
