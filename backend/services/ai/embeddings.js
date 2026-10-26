// Text → 1536-number vectors with OpenAI text-embedding-ada-002 (FR13, FR10).
//
//   const [vector] = await embed(['How do I check a smoke hood?']);
//
// Many texts go in one request (the API takes an array), BATCH_SIZE at a
// time, so a 60-chunk SOP is a single call. Rate-limit (429) and server
// (5xx) errors are retried with backoff by the SDK (see clients.js).
const config = require('../../config');
const { openaiClient, unavailable } = require('./clients');
const { fakeEmbed, DIMS } = require('./fake');

const BATCH_SIZE = 100;

// The name stored in documents.embedding_model. Retrieval only compares
// vectors made by the same model.
const EMBEDDING_MODEL = config.ai.fake ? 'fake-hash-1536' : config.ai.embeddingModel;

async function embed(texts) {
  if (config.ai.fake) return texts.map(fakeEmbed);

  const client = openaiClient();
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let response;
    try {
      response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    } catch (err) {
      throw unavailable('OpenAI embeddings', err);
    }
    // The API may return items out of order; `index` says which input each is.
    for (const item of [...response.data].sort((a, b) => a.index - b.index)) {
      if (item.embedding.length !== DIMS) {
        throw new Error(`${EMBEDDING_MODEL} returned ${item.embedding.length} numbers; embeddings.vector_data needs ${DIMS}.`);
      }
      vectors.push(item.embedding);
    }
  }
  return vectors;
}

// pgvector accepts a vector as the text '[0.1,0.2,...]'. Passing it as a
// normal $n parameter keeps the query parameterised.
function toVectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}

module.exports = { embed, toVectorLiteral, EMBEDDING_MODEL };
