// Ingest half of the pipeline: SOP file → chunks → embeddings → database.
//
//   npm run rag:ingest -- path/to/sop.pdf
//   npm run rag:ingest                     (uses the bundled sample SOP)
//
// Re-running with the same file replaces its previous chunks, because
// deleting the documents row cascades to embeddings.
const path = require('path');
const db = require('../../db');
const { readDocument, chunkText, MAX_CHARS } = require('./chunker');
const { embed, EMBEDDING_MODEL } = require('./providers');
const { toVectorLiteral, modelTag } = require('./rag');

const DEFAULT_FILE = path.join(__dirname, 'samples', 'sample-sop-cabin-preflight.md');

async function main() {
  const file = path.resolve(process.argv[2] || DEFAULT_FILE);
  const docName = path.basename(file).replace(/\.[^.]+$/, '');

  const text = await readDocument(file);
  if (text.trim().length < 50) {
    throw new Error('Extracted almost no text. If this is a scanned PDF it needs OCR first.');
  }

  const chunks = chunkText(text, docName);
  const avg = Math.round(chunks.reduce((n, c) => n + c.text.length, 0) / chunks.length);
  console.log(`${docName}: ${text.length} chars → ${chunks.length} chunks (avg ${avg}, max ${MAX_CHARS})`);

  const t0 = Date.now();
  const vectors = await embed(chunks.map(c => c.text));
  console.log(`Embedded with ${EMBEDDING_MODEL} in ${Date.now() - t0} ms`);

  // documents.uploaded_by is NOT NULL; the spike files everything under the
  // seeded admin, which matches FR13 (admins upload SOPs).
  const { rows: admins } = await db.query(
    `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE r.role_name = 'Admin' ORDER BY u.email LIMIT 1`,
  );
  if (!admins.length) throw new Error('No Admin user found — run npm run db:seed first.');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE doc_name = $1', [docName]);
    const relPath = path.relative(process.cwd(), file).split(path.sep).join('/');
    const { rows } = await client.query(
      `INSERT INTO documents (uploaded_by, doc_name, file_url)
       VALUES ($1, $2, $3) RETURNING doc_id`,
      [admins[0].user_id, docName, `${relPath}${modelTag}`],
    );
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        'INSERT INTO embeddings (doc_id, vector_data, chunk_text) VALUES ($1, $2::vector, $3)',
        [rows[0].doc_id, toVectorLiteral(vectors[i]), chunks[i].text],
      );
    }
    await client.query('COMMIT');
    console.log(`Stored document ${rows[0].doc_id} with ${chunks.length} embeddings.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch(err => {
    console.error('Ingest failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
