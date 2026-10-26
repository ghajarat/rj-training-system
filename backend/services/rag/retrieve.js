// FR10 retrieval: the k chunks closest in meaning to the question.
//
//   const { hits, used } = await retrieve(queryVector);
//   hits  the top k, with their cosine similarity (1 = same meaning)
//   used  the hits that clear MIN_SIMILARITY: the only ones the model sees
//
// `<=>` is pgvector's cosine DISTANCE (0 = identical), served by the HNSW
// index idx_embeddings_vector, so 1 - distance is the similarity.
//
// Searched: documents that are ready, plus documents being RE-indexed (their
// old chunks keep answering until the new ones replace them in one
// transaction). Only vectors from the current embedding model are compared.
const db = require('../../db');
const config = require('../../config');
const { toVectorLiteral, EMBEDDING_MODEL } = require('../ai/embeddings');

// Below this similarity a chunk is "not about the question". ada-002 scores
// sit in a high, narrow band (unrelated text still scores about 0.7), so its
// floor is high. Calibrate with real questions and set RAG_MIN_SIMILARITY.
const DEFAULT_FLOORS = { 'text-embedding-ada-002': 0.78, 'fake-hash-1536': 0.12 };
const MIN_SIMILARITY = config.rag.minSimilarity ?? DEFAULT_FLOORS[EMBEDDING_MODEL] ?? 0.3;

async function retrieve(queryVector, k = config.rag.topK) {
  const { rows } = await db.query(
    `SELECT e.embed_id, e.doc_id, d.doc_name, e.section, e.page, e.chunk_text,
            1 - (e.vector_data <=> $1::vector) AS similarity
       FROM embeddings e
       JOIN documents d ON d.doc_id = e.doc_id
      WHERE d.status IN ('ready', 'processing')
        AND d.embedding_model = $2
      ORDER BY e.vector_data <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(queryVector), EMBEDDING_MODEL, k],
  );
  const hits = rows.map(r => ({
    embedId: r.embed_id,
    docId: r.doc_id,
    title: r.doc_name,
    section: r.section,
    page: r.page,
    text: r.chunk_text,
    similarity: Number(r.similarity),
  }));
  return { hits, used: hits.filter(h => h.similarity >= MIN_SIMILARITY) };
}

module.exports = { retrieve, MIN_SIMILARITY };
