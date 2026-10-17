// Thin wrappers around the two AI APIs the pipeline needs:
//   embed(texts)        → OpenAI embeddings, one 1536-dim vector per text
//   generate(sys, user) → Claude answer text
//
// Uses Node's built-in fetch, so no SDKs to install.
//
// Set RAG_FAKE=1 to run the whole pipeline offline with deterministic stand-ins
// (a hashing embedder and an extractive "answer"). Useful for testing the
// database side without spending API credit; it says nothing about answer
// quality.
require('dotenv').config();
const crypto = require('crypto');

const DIMS = 1536; // must match VECTOR(1536) in db/schema.sql
const FAKE = process.env.RAG_FAKE === '1';

const EMBEDDING_MODEL = FAKE
  ? 'fake-hash-1536'
  : process.env.RAG_EMBEDDING_MODEL || 'text-embedding-ada-002';
const CHAT_MODEL = FAKE ? 'fake-extractive' : process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

async function embed(texts) {
  if (FAKE) return texts.map(fakeEmbed);

  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in backend/.env (or run with RAG_FAKE=1).');

  const out = [];
  // The endpoint takes an array; batching keeps a 30-chunk SOP to one request.
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${body.error?.message || res.statusText}`);

    for (const item of body.data.sort((a, b) => a.index - b.index)) {
      if (item.embedding.length !== DIMS) {
        throw new Error(`${EMBEDDING_MODEL} returned ${item.embedding.length} dims; the embeddings table needs ${DIMS}.`);
      }
      out.push(item.embedding);
    }
  }
  return out;
}

// Hashing-trick embedding: each word and word pair bumps one dimension.
// Gives crude keyword overlap similarity, which is enough to exercise pgvector.
function fakeEmbed(text) {
  const v = new Array(DIMS).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const terms = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  for (const t of terms) {
    const h = crypto.createHash('md5').update(t).digest();
    v[h.readUInt32LE(0) % DIMS] += h[4] & 1 ? 1 : -1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map(x => x / norm);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

async function generate(system, user) {
  if (FAKE) return fakeGenerate(user);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in backend/.env (or run with RAG_FAKE=1).');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 1024,
      // Low effort keeps chat replies quick (NFR target: chatbot < 5 s).
      output_config: { effort: process.env.ANTHROPIC_EFFORT || 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body.error?.message || res.statusText}`);

  // The reply may include thinking blocks; only the text blocks are the answer.
  return body.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// Offline stand-in: quote the first two sentences of excerpt [1].
function fakeGenerate(user) {
  const m = user.match(/<excerpt id="1"[^>]*>\s*([\s\S]*?)<\/excerpt>/);
  if (!m) return NOT_FOUND;
  const body = m[1].replace(/^(Document|Section):.*$/gm, '').trim();
  const sentences = body.match(/[^.!?]+[.!?]+/g) || [body];
  return `${sentences.slice(0, 2).join(' ').trim()} [1]`;
}

const NOT_FOUND = "I couldn't find this in the uploaded SOPs. Please check with your trainer.";

module.exports = { embed, generate, EMBEDDING_MODEL, CHAT_MODEL, FAKE, DIMS, NOT_FOUND };
