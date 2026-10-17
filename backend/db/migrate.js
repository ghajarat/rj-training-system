// Brings the database in DATABASE_URL up to date.
//
//   npm run db:migrate   → apply schema.sql, then any new files in migrations/
//   npm run db:reset     → DROP every table, recreate, then seed (dev only!)
//
// schema.sql is the GP1 baseline and is idempotent (IF NOT EXISTS), so it is
// applied every time. Approved changes live in numbered files in
// db/migrations/ (001_*.sql, 002_*.sql, ...). Each file runs exactly once, in
// filename order, inside its own transaction; the schema_migrations table
// records which files have already run.
//
// Runs through Node rather than psql, so it works on Windows without
// psql on the PATH.
const fs = require('fs');
const path = require('path');
const db = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Dropped by --reset. Children first, although CASCADE makes order safe.
const TABLES = [
  'schema_migrations', 'audit_logs',
  'notifications', 'kpis', 'chat_messages', 'chat_sessions', 'embeddings',
  'documents', 'feedback', 'progress', 'courses', 'plan_assignments',
  'training_plans', 'users', 'departments', 'roles',
];

async function applyMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )`);

  const { rows } = await db.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort()
    : [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await db.getClient();
    try {
      // The file and its bookkeeping row commit together, so a failed
      // migration leaves no half-applied changes and is retried next run.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      err.message = `${file}: ${err.message}`;
      throw err;
    } finally {
      client.release();
    }
  }
}

async function main() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to reset a production database.');
    }
    console.log('Dropping all tables...');
    await db.query(`DROP TABLE IF EXISTS ${TABLES.join(', ')} CASCADE`);
  }

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
  await applyMigrations();

  const { rows } = await db.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`);
  console.log(`Schema up to date — ${rows.length} tables: ${rows.map(r => r.table_name).join(', ')}`);
}

main()
  .catch(err => {
    console.error('Migration failed:', err.message);
    if (/extension "vector"/.test(err.message)) {
      console.error('→ pgvector is not installed for this PostgreSQL instance.');
    }
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
