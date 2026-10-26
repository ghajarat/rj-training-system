// Loads the fictional sample SOPs in samples/sops/ into the SOP library,
// using the same indexing code as an admin upload (FR13).
//
//   npm run sop:samples
//
// Needs OPENAI_API_KEY in .env (or AI_FAKE=1 for offline fake embeddings).
// Re-running replaces the samples: a document with the same title is
// deleted first. Files are filed under the first Admin account.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const sopFiles = require('../services/sopFiles');
const ingest = require('../services/rag/ingest');

const SAMPLES_DIR = path.join(__dirname, '..', 'samples', 'sops');

// "# Lavatory Smoke ..." on the first line is the title.
function titleOf(filePath) {
  const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
  return firstLine.replace(/^#+\s*/, '').trim();
}

async function main() {
  const { rows: admins } = await db.query(
    `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE r.role_name = 'Admin' AND u.is_active ORDER BY u.email LIMIT 1`,
  );
  if (!admins[0]) throw new Error('No active Admin user found. Run npm run db:seed first.');

  sopFiles.ensureDir();
  const files = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.txt')).sort();
  for (const file of files) {
    const source = path.join(SAMPLES_DIR, file);
    const title = titleOf(source);

    const { rows: old } = await db.query('DELETE FROM documents WHERE LOWER(doc_name) = LOWER($1) RETURNING file_url', [title]);
    for (const row of old) await sopFiles.removeStored(row.file_url);

    const storedName = `${crypto.randomUUID()}.txt`;
    fs.copyFileSync(source, path.join(sopFiles.SOPS_DIR, storedName));
    const { rows } = await db.query(
      `INSERT INTO documents (uploaded_by, doc_name, file_url, status)
       VALUES ($1, $2, $3, 'processing') RETURNING doc_id`,
      [admins[0].user_id, title, sopFiles.toFileUrl(storedName)],
    );
    await ingest.indexDocument(rows[0].doc_id);

    const { rows: [doc] } = await db.query(
      `SELECT status, error_message, (SELECT COUNT(*) FROM embeddings WHERE doc_id = $1)::int AS chunks
         FROM documents WHERE doc_id = $1`, [rows[0].doc_id]);
    console.log(`${doc.status.padEnd(6)} ${title} — ${doc.chunks} chunks${doc.error_message ? ` (${doc.error_message})` : ''}`);
  }
}

main()
  .catch((err) => {
    console.error('Loading sample SOPs failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
