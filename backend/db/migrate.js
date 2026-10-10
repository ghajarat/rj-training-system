// Applies schema.sql to the database in DATABASE_URL.
//
//   npm run db:migrate   → create anything that's missing (safe to re-run)
//   npm run db:reset     → DROP every table, recreate, then seed (dev only!)
//
// Runs through Node rather than psql, so it works on Windows without
// psql on the PATH.
const fs = require('fs');
const path = require('path');
const db = require('./index');

const TABLES = [
  'notifications', 'kpis', 'chat_messages', 'chat_sessions', 'embeddings',
  'documents', 'feedback', 'progress', 'courses', 'plan_assignments',
  'training_plans', 'users', 'departments', 'roles',
];

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

  const { rows } = await db.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`);
  console.log(`Schema applied — ${rows.length} tables: ${rows.map(r => r.table_name).join(', ')}`);
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
