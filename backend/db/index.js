// Shared PostgreSQL connection pool. Import this everywhere instead of
// creating new clients:  const db = require('./db');  await db.query(...)
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env and fill it in.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Runs fn(client) inside BEGIN/COMMIT, rolling back on any error.
//   const plan = await db.transaction(async (client) => { ...client.query(...) });
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  transaction,
  pool,
};
