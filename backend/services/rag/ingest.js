// FR13 indexing: SOP file → text → chunks → embeddings → database.
//
//   enqueue(docId)   index a document whose status is 'processing'
//   resumePending()  on server start, re-queue documents a restart interrupted
//   whenIdle()       resolves when the queue is empty (tests, scripts)
//
// Why in the background: a 20 MB PDF can take longer to embed than an HTTP
// request should stay open. The upload answers 202 at once with status
// 'processing'; the admin screen polls until it reads 'ready' or 'failed'.
//
// Why one at a time: a simple promise chain keeps us well under the
// embedding API's rate limits and is easy to reason about. SOP uploads are
// rare, so throughput does not matter.
//
// All-or-nothing: the new chunks and the switch to 'ready' are written in
// one transaction. If anything fails, nothing is written and the document is
// marked 'failed' with a plain-language reason.
const db = require('../../db');
const config = require('../../config');
const HttpError = require('../../utils/httpError');
const sopFiles = require('../sopFiles');
const { extractText, ExtractionError } = require('./extract');
const { chunkDocument } = require('./chunker');
const { embed, toVectorLiteral, EMBEDDING_MODEL } = require('../ai/embeddings');

const CHARS_PER_TOKEN = 4;
const MIN_TEXT_CHARS = 50;
const INSERT_BATCH = 100;

let tail = Promise.resolve();

function enqueue(docId) {
  tail = tail.then(() => indexDocument(docId)).catch((err) => {
    console.error(`Indexing ${docId} crashed: ${err.message}`);
  });
  return tail;
}

function whenIdle() {
  return tail;
}

async function resumePending() {
  const { rows } = await db.query("SELECT doc_id FROM documents WHERE status = 'processing' ORDER BY upload_date");
  rows.forEach(r => enqueue(r.doc_id));
  return rows.length;
}

// Title and section go into the embedded text (not the stored chunk): a
// question about "smoke hoods" then also matches a chunk that only says
// "the hood" under the heading "5.3 Smoke hoods".
function embeddingInput(title, chunk) {
  return `${title}${chunk.section ? ` — ${chunk.section}` : ''}\n\n${chunk.text}`;
}

function userMessageFor(err) {
  if (err instanceof ExtractionError) return err.userMessage;
  if (err instanceof HttpError) return err.message;
  return 'Indexing stopped because of an unexpected error. Try again, or upload the file again.';
}

async function insertChunks(client, docId, chunks, vectors) {
  for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
    const values = [];
    const params = [];
    chunks.slice(start, start + INSERT_BATCH).forEach((c, i) => {
      const p = params.length;
      values.push(`($${p + 1}, $${p + 2}, $${p + 3}::vector, $${p + 4}, $${p + 5}, $${p + 6})`);
      params.push(docId, c.index, toVectorLiteral(vectors[start + i]), c.text, c.section, c.page);
    });
    await client.query(
      `INSERT INTO embeddings (doc_id, chunk_index, vector_data, chunk_text, section, page)
       VALUES ${values.join(', ')}`,
      params,
    );
  }
}

async function indexDocument(docId) {
  const { rows } = await db.query(
    "SELECT doc_id, doc_name, file_url FROM documents WHERE doc_id = $1 AND status = 'processing'",
    [docId],
  );
  const doc = rows[0];
  if (!doc) return; // deleted, or already handled

  const started = Date.now();
  try {
    const filePath = sopFiles.pathFor(doc.file_url);
    if (!filePath) throw new ExtractionError('The uploaded file is missing on the server. Upload it again.');

    const pages = await extractText(filePath, sopFiles.typeOf(doc.file_url));
    const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
    if (totalChars < MIN_TEXT_CHARS) {
      throw new ExtractionError('No text could be read from this file. If it is a scanned PDF, it must be converted to text (OCR) before upload.');
    }

    const chunks = chunkDocument(pages, {
      maxChars: config.rag.chunkTokens * CHARS_PER_TOKEN,
      overlapChars: config.rag.overlapTokens * CHARS_PER_TOKEN,
    });
    const vectors = await embed(chunks.map(c => embeddingInput(doc.doc_name, c)));

    const stored = await db.transaction(async (client) => {
      // A re-upload or delete while we were embedding makes this run stale:
      // the newer request owns the document now.
      const { rows: current } = await client.query(
        'SELECT file_url FROM documents WHERE doc_id = $1 FOR UPDATE', [docId]);
      if (!current[0] || current[0].file_url !== doc.file_url) return false;

      await client.query('DELETE FROM embeddings WHERE doc_id = $1', [docId]);
      await insertChunks(client, docId, chunks, vectors);
      await client.query(
        `UPDATE documents SET status = 'ready', error_message = NULL, embedding_model = $2
          WHERE doc_id = $1`,
        [docId, EMBEDDING_MODEL],
      );
      return true;
    });
    if (stored) {
      console.log(`[sop] indexed ${docId}: ${chunks.length} chunks in ${Date.now() - started} ms`);
    }
  } catch (err) {
    // Logged without the document text.
    console.error(`[sop] indexing ${docId} failed: ${err.message}`);
    await db.query(
      `UPDATE documents SET status = 'failed', error_message = $2
        WHERE doc_id = $1 AND file_url = $3`,
      [docId, userMessageFor(err).slice(0, 500), doc.file_url],
    );
  }
}

module.exports = { enqueue, whenIdle, resumePending, indexDocument, embeddingInput };
