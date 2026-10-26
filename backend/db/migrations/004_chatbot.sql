-- =====================================================================
-- 004 — AI Chatbot (Phase 5: FR10–FR13)
-- Deviations from GP1 are explained in docs/schema-changes.md.
-- Runs once, inside a transaction, via db/migrate.js.
--
-- The HNSW cosine index on embeddings.vector_data is already in schema.sql,
-- so retrieval needs nothing new here.
-- =====================================================================

-- FR13: an uploaded SOP is indexed in the background, so the admin screen
-- needs to know where it stands:
--   processing → text is being extracted and embedded
--   ready      → its chunks are searchable
--   failed     → indexing stopped; error_message says why, in plain words
-- embedding_model records which model made the vectors. Vectors from two
-- different models cannot be compared, so retrieval only searches documents
-- embedded with the model currently configured.
ALTER TABLE documents
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'processing',
    ADD COLUMN error_message VARCHAR(500) NULL,
    ADD COLUMN embedding_model VARCHAR(100) NULL,
    ADD CONSTRAINT chk_document_status CHECK (status IN ('processing', 'ready', 'failed'));

-- Rows from before this migration (the Phase 3 spike) already have their
-- chunks. Their model is unknown, so they stay out of search until an admin
-- re-indexes them.
UPDATE documents SET status = 'ready';

-- FR11: a citation shows where in the SOP an answer came from. GP1 stores
-- only the chunk text, so the section title, page and position are added.
--   chunk_index  0, 1, 2 ... order of the chunk inside its document
--   section      heading the chunk sits under (NULL if the file has none)
--   page         PDF page the chunk starts on (NULL for DOCX / TXT)
ALTER TABLE embeddings
    ADD COLUMN chunk_index INT NULL,
    ADD COLUMN section VARCHAR(255) NULL,
    ADD COLUMN page INT NULL;

UPDATE embeddings e
   SET chunk_index = numbered.n
  FROM (SELECT embed_id, ROW_NUMBER() OVER (PARTITION BY doc_id ORDER BY embed_id) - 1 AS n
          FROM embeddings) AS numbered
 WHERE numbered.embed_id = e.embed_id;

-- The unique constraint's index also serves "all chunks of a document",
-- so the old single-column index is no longer needed.
ALTER TABLE embeddings
    ALTER COLUMN chunk_index SET NOT NULL,
    ADD CONSTRAINT chk_embedding_chunk_index CHECK (chunk_index >= 0),
    ADD CONSTRAINT chk_embedding_page CHECK (page IS NULL OR page >= 1),
    ADD CONSTRAINT uq_embedding_doc_chunk UNIQUE (doc_id, chunk_index);

DROP INDEX IF EXISTS idx_embeddings_doc;

-- FR11 + FR12: the history must show each answer WITH its sources.
--   citations           snapshot of the sources an answer cites (document id
--                       and title, section, page, excerpt, similarity). A copy
--                       rather than a foreign key, so an old answer keeps its
--                       sources after the SOP is re-indexed or deleted.
--   outcome             bot messages only: answered / not_found / refused.
--                       Replaces the spike's string match on a fixed sentence.
--   related_course_ids  up to 3 courses suggested with the answer. Names and
--                       progress are looked up fresh when the history is read.
ALTER TABLE chat_messages
    ADD COLUMN citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN outcome VARCHAR(20) NULL,
    ADD COLUMN related_course_ids UUID[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT chk_chat_outcome
        CHECK (outcome IS NULL OR outcome IN ('answered', 'not_found', 'refused'));
