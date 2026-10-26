// /api/documents — the SOP library behind the chatbot (FR13).
//
//   GET    /api/documents               list with status and chunk count   Admin
//   POST   /api/documents               upload (multipart: file, title?)   Admin → 202
//   GET    /api/documents/:id           one document (poll while indexing) Admin
//   PUT    /api/documents/:id           new file (re-index) and/or title   Admin
//   POST   /api/documents/:id/reindex   index the stored file again        Admin
//   DELETE /api/documents/:id           delete it and its chunks           Admin
//   GET    /api/documents/:id/file      open the SOP from a citation       any signed-in user
//
// Upload and re-upload answer 202 Accepted with status 'processing'; the
// indexing runs in the background (services/rag/ingest.js). Every change
// writes an audit row in the same transaction (FR2). Files are deleted from
// disk only after the transaction commits.
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadSop, discardUpload } = require('../middleware/uploadSop');
const audit = require('../services/audit');
const sopFiles = require('../services/sopFiles');
const ingest = require('../services/rag/ingest');
const { EMBEDDING_MODEL } = require('../services/ai/embeddings');
const { requireUuid, readText } = require('../utils/validate');

const router = express.Router();

router.use(authenticate);
const adminOnly = authorize('Admin');

const DOCUMENT_SELECT = `
  SELECT d.doc_id, d.doc_name, d.file_url, d.upload_date, d.status, d.error_message,
         d.embedding_model, u.user_id AS uploader_id, u.full_name AS uploader_name,
         (SELECT COUNT(*) FROM embeddings e WHERE e.doc_id = d.doc_id)::int AS chunk_count
    FROM documents d
    JOIN users u ON u.user_id = d.uploaded_by`;

function toDocumentDto(row) {
  const fileType = sopFiles.typeOf(row.file_url);
  return {
    id: row.doc_id,
    title: row.doc_name,
    fileType,
    fileLabel: sopFiles.FILE_TYPES[fileType]?.label || null,
    status: row.status,
    error: row.error_message,
    chunkCount: row.chunk_count,
    uploadedAt: row.upload_date,
    uploadedBy: { id: row.uploader_id, name: row.uploader_name },
    // Ready, but embedded with another model (e.g. EMBEDDING_MODEL changed):
    // not searchable until it is re-indexed.
    needsReindex: row.status === 'ready' && row.embedding_model !== EMBEDDING_MODEL,
  };
}

async function findDocument(id, client = db) {
  const { rows } = await client.query(`${DOCUMENT_SELECT} WHERE d.doc_id = $1`, [id]);
  return rows[0] || null;
}

async function requireDocument(id, client = db) {
  const row = await findDocument(id, client);
  if (!row) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'That SOP does not exist. It may have been deleted.');
  return row;
}

// Locks the row so two admins cannot change the same SOP at once.
async function lockDocument(client, id) {
  const { rows } = await client.query('SELECT doc_id FROM documents WHERE doc_id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'That SOP does not exist. It may have been deleted.');
  return requireDocument(id, client);
}

function readTitle(value) {
  return readText(value, 'Title', { min: 2, max: 255 });
}

// "Cabin_Preflight-Checks.v3.pdf" → "Cabin Preflight-Checks.v3"
function titleFromFileName(name) {
  return String(name).replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
}

// Two SOPs with the same title would be indistinguishable in citations.
async function assertTitleFree(client, title, exceptId = null) {
  const { rows } = await client.query(
    'SELECT 1 FROM documents WHERE LOWER(doc_name) = LOWER($1) AND ($2::uuid IS NULL OR doc_id <> $2)',
    [title, exceptId],
  );
  if (rows[0]) {
    throw new HttpError(409, 'DOCUMENT_EXISTS',
      `An SOP called "${title}" already exists. Re-upload it from the list to replace its file, or choose another title.`);
  }
}

// ---------------------------------------------------------------------

router.get('/', adminOnly, async (req, res) => {
  const { rows } = await db.query(`${DOCUMENT_SELECT} ORDER BY d.upload_date DESC, d.doc_name`);
  res.json({ documents: rows.map(toDocumentDto) });
});

router.post('/', adminOnly, uploadSop, async (req, res) => {
  try {
    if (!req.file) throw new HttpError(400, 'VALIDATION', 'Choose a PDF, DOCX or TXT file to upload.');
    const body = req.body || {};
    const title = readTitle(body.title?.trim() ? body.title : titleFromFileName(req.file.originalname));

    const doc = await db.transaction(async (client) => {
      await assertTitleFree(client, title);
      const { rows } = await client.query(
        `INSERT INTO documents (uploaded_by, doc_name, file_url, status)
         VALUES ($1, $2, $3, 'processing') RETURNING doc_id`,
        [req.user.id, title, req.file.fileUrl],
      );
      await audit.record(client, {
        actorId: req.user.id,
        action: audit.ACTIONS.SOP_UPLOADED,
        details: { docId: rows[0].doc_id, title, fileName: req.file.originalname },
      });
      return findDocument(rows[0].doc_id, client);
    });

    ingest.enqueue(doc.doc_id);
    res.status(202).json({ document: toDocumentDto(doc) });
  } catch (err) {
    await discardUpload(req);
    throw err;
  }
});

router.get('/:id', adminOnly, async (req, res) => {
  res.json({ document: toDocumentDto(await requireDocument(requireUuid(req.params.id, 'document id'))) });
});

// { title? } + file?   A new file replaces the old one and is re-indexed;
// until the new chunks are ready, the old ones keep answering questions.
router.put('/:id', adminOnly, uploadSop, async (req, res) => {
  let oldFileUrl = null;
  let doc;
  try {
    const id = requireUuid(req.params.id, 'document id');
    const body = req.body || {};
    const hasTitle = typeof body.title === 'string' && body.title.trim() !== '';
    if (!req.file && !hasTitle) {
      throw new HttpError(400, 'VALIDATION', 'Choose a new file, or enter a new title.');
    }

    doc = await db.transaction(async (client) => {
      const before = await lockDocument(client, id);
      const title = hasTitle ? readTitle(body.title) : before.doc_name;
      if (title.toLowerCase() !== before.doc_name.toLowerCase()) await assertTitleFree(client, title, id);

      if (req.file) {
        await client.query(
          `UPDATE documents SET doc_name = $2, file_url = $3, status = 'processing',
                                error_message = NULL, upload_date = NOW()
            WHERE doc_id = $1`,
          [id, title, req.file.fileUrl],
        );
        oldFileUrl = before.file_url;
      } else {
        await client.query('UPDATE documents SET doc_name = $2 WHERE doc_id = $1', [id, title]);
      }

      await audit.record(client, {
        actorId: req.user.id,
        action: audit.ACTIONS.SOP_UPDATED,
        details: {
          docId: id,
          title,
          ...(title !== before.doc_name && { previousTitle: before.doc_name }),
          ...(req.file && { fileName: req.file.originalname }),
        },
      });
      return findDocument(id, client);
    });
  } catch (err) {
    await discardUpload(req);
    throw err;
  }

  if (oldFileUrl) {
    await sopFiles.removeStored(oldFileUrl);
    ingest.enqueue(doc.doc_id);
  }
  res.status(req.file ? 202 : 200).json({ document: toDocumentDto(doc) });
});

// Index the stored file again, e.g. after a failure caused by a network
// problem, or after EMBEDDING_MODEL was changed.
router.post('/:id/reindex', adminOnly, async (req, res) => {
  const id = requireUuid(req.params.id, 'document id');
  const doc = await db.transaction(async (client) => {
    const before = await lockDocument(client, id);
    if (before.status === 'processing') {
      throw new HttpError(409, 'DOCUMENT_PROCESSING', 'This SOP is already being indexed. Please wait for it to finish.');
    }
    await client.query("UPDATE documents SET status = 'processing', error_message = NULL WHERE doc_id = $1", [id]);
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.SOP_REINDEXED,
      details: { docId: id, title: before.doc_name },
    });
    return findDocument(id, client);
  });
  ingest.enqueue(id);
  res.status(202).json({ document: toDocumentDto(doc) });
});

// Its chunks go too (ON DELETE CASCADE). Answers already given keep their
// citations: chat_messages.citations is a copy, not a reference.
router.delete('/:id', adminOnly, async (req, res) => {
  const id = requireUuid(req.params.id, 'document id');
  const removed = await db.transaction(async (client) => {
    const before = await lockDocument(client, id);
    await client.query('DELETE FROM documents WHERE doc_id = $1', [id]);
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.SOP_DELETED,
      details: { docId: id, title: before.doc_name, chunkCount: before.chunk_count },
    });
    return before;
  });
  await sopFiles.removeStored(removed.file_url);
  res.status(204).end();
});

// Any signed-in user may open an SOP that a citation points to. SOPs are
// company reference documents, already quoted in the chatbot's answers.
router.get('/:id/file', authorize('Trainee', 'Trainer', 'Admin'), async (req, res) => {
  const doc = await requireDocument(requireUuid(req.params.id, 'document id'));
  await sopFiles.sendSopFile(res, doc);
});

module.exports = router;
