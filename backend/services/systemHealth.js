// Phase 8: System Health for Admins (sidebar "System Health").
//
// One call that answers "is everything working?" without opening a terminal.
// Each check returns { status: 'ok' | 'warning' | 'error', ...facts }, and the
// overall status is the worst of them. Checks only read; nothing is changed
// and no AI service is called (a health page must not cost money).
//
// Secrets are never returned: for API keys the page only learns whether one
// is set.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const llm = require('./ai/llm');
const materialFiles = require('./materialFiles');
const sopFiles = require('./sopFiles');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const SLOW_DB_MS = 500;                 // a simple query slower than this is a warning
const FAILED_LOGINS_WARNING = 10;       // failed sign-ins in 24 h worth a look
const SENTIMENT_BACKLOG_WARNING = 25;   // comments waiting for a score
const STARTED_AT = new Date();

const RANK = { ok: 0, warning: 1, error: 2 };
const worst = statuses => statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');

async function database() {
  try {
    const { rows: [r] } = await db.query(
      `SELECT current_setting('server_version') AS version,
              (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector,
              pg_database_size(current_database()) AS size_bytes`);
    // Round trip of the smallest query, timed after the first one so it does
    // not include opening a new connection.
    const started = process.hrtime.bigint();
    await db.query('SELECT 1');
    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      status: !r.pgvector ? 'error' : (latencyMs > SLOW_DB_MS ? 'warning' : 'ok'),
      latencyMs: Math.round(latencyMs * 10) / 10,
      version: r.version,
      pgvector: r.pgvector,
      sizeBytes: Number(r.size_bytes),
      message: !r.pgvector ? 'The pgvector extension is not installed: the AI Assistant cannot search SOPs.' : null,
    };
  } catch (err) {
    console.error('System health: database check failed:', err.message);
    return { status: 'error', message: 'The database is not answering.' };
  }
}

async function migrations() {
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort()
    : [];
  const { rows } = await db.query('SELECT filename, applied_at FROM schema_migrations ORDER BY filename');
  const applied = new Set(rows.map(r => r.filename));
  const pending = files.filter(f => !applied.has(f));
  return {
    status: pending.length ? 'error' : 'ok',
    applied: rows.length,
    pending,
    latest: rows.length ? rows[rows.length - 1].filename : null,
    message: pending.length ? 'Some database migrations have not run. Run "npm run db:migrate".' : null,
  };
}

async function sopIndex() {
  const { rows } = await db.query(
    `SELECT d.status, COUNT(*)::int AS n FROM documents d GROUP BY d.status`);
  const count = s => rows.find(r => r.status === s)?.n ?? 0;
  const { rows: [chunks] } = await db.query('SELECT COUNT(*)::int AS n FROM embeddings');
  const { rows: failedDocs } = await db.query(
    `SELECT doc_name AS title, error_message FROM documents WHERE status = 'failed' ORDER BY doc_name LIMIT 10`);
  const ready = count('ready');
  const failed = count('failed');
  let status = 'ok';
  let message = null;
  if (failed > 0) {
    status = 'warning';
    message = `${failed} SOP(s) could not be indexed. Open the SOP Library to retry or replace them.`;
  } else if (ready === 0) {
    status = 'warning';
    message = 'No SOP is ready: the AI Assistant has nothing to answer from.';
  }
  return {
    status,
    ready,
    processing: count('processing'),
    failed,
    passages: chunks.n,
    failedDocuments: failedDocs.map(d => ({ title: d.title, reason: d.error_message })),
    message,
  };
}

function ai() {
  const fake = config.ai.fake;
  const needsAnthropic = llm.PROVIDER === 'anthropic';
  const keys = {
    openai: Boolean(config.ai.openaiKey),
    anthropic: Boolean(config.ai.anthropicKey),
  };
  const missing = fake ? [] : [
    !keys.openai && 'OPENAI_API_KEY (embeddings and moderation)',
    needsAnthropic && !keys.anthropic && 'ANTHROPIC_API_KEY (answers)',
    !needsAnthropic && !keys.openai && 'OPENAI_API_KEY (answers)',
  ].filter(Boolean);
  return {
    status: fake ? 'warning' : (missing.length ? 'error' : 'ok'),
    mode: fake ? 'offline stand-in (AI_FAKE=1)' : 'live',
    llmProvider: llm.PROVIDER,
    llmModel: llm.MODEL,
    embeddingModel: fake ? 'fake' : config.ai.embeddingModel,
    keysSet: keys,
    message: fake
      ? 'AI_FAKE=1: answers, embeddings and sentiment use offline stand-ins, not real AI.'
      : (missing.length ? `Missing in .env: ${[...new Set(missing)].join(', ')}.` : null),
  };
}

async function sentiment() {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE f.comment IS NOT NULL AND f.sentiment_score IS NULL)::int AS pending,
            COUNT(f.sentiment_score)::int AS scored
       FROM feedback f`);
  return {
    status: r.pending >= SENTIMENT_BACKLOG_WARNING ? 'warning' : 'ok',
    pending: r.pending,
    scored: r.scored,
    message: r.pending >= SENTIMENT_BACKLOG_WARNING
      ? `${r.pending} comments are waiting for a sentiment score. The AI may be unavailable; it retries every 10 minutes.`
      : null,
  };
}

async function folderUsage(dir) {
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const stat = await fs.promises.stat(path.join(dir, entry.name));
    files += 1;
    bytes += stat.size;
  }
  return { files, bytes };
}

async function storage() {
  const [materials, sops] = await Promise.all([
    folderUsage(materialFiles.MATERIALS_DIR),
    folderUsage(sopFiles.SOPS_DIR),
  ]);
  // Stored files the database points to but that are missing on disk.
  // (A stored name that fails the safe-name check counts as missing too.)
  const [courseFiles, sopRows] = await Promise.all([
    db.query(`SELECT material_url AS url FROM courses WHERE material_url LIKE 'upload:%'`),
    db.query(`SELECT file_url AS url FROM documents WHERE file_url LIKE 'upload:%'`),
  ]);
  const isMissing = p => !p || !fs.existsSync(p);
  const missing = courseFiles.rows.filter(r => isMissing(materialFiles.pathFor(r.url))).length
    + sopRows.rows.filter(r => isMissing(sopFiles.pathFor(r.url))).length;
  return {
    status: missing ? 'warning' : 'ok',
    materials,
    sops,
    missingFiles: missing,
    message: missing ? `${missing} uploaded file(s) are missing from the server's disk.` : null,
  };
}

async function accounts() {
  const { rows: [r] } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE is_active)::int                          AS active,
       (SELECT COUNT(*) FROM users WHERE NOT is_active)::int                      AS deactivated,
       (SELECT COUNT(*) FROM users
         WHERE is_active AND password_hash IS NULL
           AND setup_token_expires_at > NOW())::int                               AS pending_invites,
       (SELECT COUNT(*) FROM audit_logs
         WHERE action = 'LOGIN_FAILED' AND created_at > NOW() - INTERVAL '24 hours')::int AS failed_logins_24h,
       (SELECT COUNT(*) FROM audit_logs
         WHERE action = 'LOGIN' AND created_at > NOW() - INTERVAL '24 hours')::int AS logins_24h,
       (SELECT COUNT(*) FROM users u JOIN roles r ON r.role_id = u.role_id
         WHERE u.is_active AND r.role_name = 'Admin' AND u.password_hash IS NOT NULL)::int AS active_admins`);
  const many = r.failed_logins_24h >= FAILED_LOGINS_WARNING;
  return {
    status: many ? 'warning' : 'ok',
    active: r.active,
    deactivated: r.deactivated,
    pendingInvites: r.pending_invites,
    activeAdmins: r.active_admins,
    logins24h: r.logins_24h,
    failedLogins24h: r.failed_logins_24h,
    message: many ? `${r.failed_logins_24h} failed sign-ins in the last 24 hours. Check the Audit Log.` : null,
  };
}

function server() {
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    memoryMb: Math.round(mem.rss / 1024 / 1024),
    environment: process.env.NODE_ENV || 'development',
  };
}

// A failing check must not hide the others: each one is caught on its own.
async function safely(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`System health: ${name} check failed:`, err.message);
    return { status: 'error', message: `The ${name} check could not run.` };
  }
}

// GET /api/system/health
async function check() {
  const db1 = await database();
  // Everything else needs the database; skip it when the database is down.
  const dbDown = db1.status === 'error' && !db1.version;
  const skipped = { status: 'error', message: 'Skipped: the database is not answering.' };
  const [mig, sops, sent, store, acc] = dbDown
    ? [skipped, skipped, skipped, skipped, skipped]
    : await Promise.all([
      safely('migrations', migrations),
      safely('SOP index', sopIndex),
      safely('sentiment', sentiment),
      safely('storage', storage),
      safely('accounts', accounts),
    ]);

  const checks = {
    database: db1,
    migrations: mig,
    sopIndex: sops,
    ai: ai(),
    sentiment: sent,
    storage: store,
    accounts: acc,
    server: server(),
  };
  return {
    status: worst(Object.values(checks).map(c => c.status)),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

module.exports = { check, worst };
