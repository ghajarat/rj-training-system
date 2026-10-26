// Central place for settings read from .env, validated once at startup so a
// missing secret fails loudly instead of surfacing as a confusing 500 later.
require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is not set — copy .env.example to .env and fill it in.`);
  }
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

module.exports = {
  port: Number(process.env.PORT) || 5000,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  jwt: {
    secret: process.env.JWT_SECRET,
    // Token lifetime. "Remember this device" only changes where the browser
    // keeps the token; the server-side expiry is the same for everyone.
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    issuer: 'rj-training-system',
  },

  // Login State Transition Diagram (GP1 Fig. 22): Authentication Failed →
  // Account Locked once the maximum number of attempts is reached.
  login: {
    maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS) || 5,
    lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES) || 15,
  },

  // FR1: how long an invitation / password-reset link stays valid.
  setup: {
    expiresHours: Number(process.env.INVITE_EXPIRES_HOURS) || 72,
  },

  // FR7: largest training material a trainer may upload, in megabytes.
  materials: {
    maxMb: Number(process.env.MATERIAL_MAX_MB) || 100,
  },

  // FR13: largest SOP an admin may upload, in megabytes.
  sops: {
    maxMb: Number(process.env.SOP_MAX_MB) || 20,
  },

  // Phase 5 AI services. Keys are read here and nowhere else, and are never
  // logged. AI_FAKE=1 swaps every AI call for an offline stand-in (tests,
  // and team members without API keys).
  ai: {
    fake: process.env.AI_FAKE === '1',
    openaiKey: process.env.OPENAI_API_KEY || '',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
    moderationModel: process.env.MODERATION_MODEL || 'omni-moderation-latest',
    llmProvider: (process.env.LLM_PROVIDER || 'anthropic').toLowerCase(),
    llmModel: process.env.LLM_MODEL || '',
    // One request to an AI service may take this long before it is retried.
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 20000,
  },

  // FR10 retrieval settings. See services/rag/retrieve.js.
  rag: {
    topK: Number(process.env.RAG_TOP_K) || 5,
    // Empty = pick a floor that suits the embedding model (retrieve.js).
    minSimilarity: process.env.RAG_MIN_SIMILARITY ? Number(process.env.RAG_MIN_SIMILARITY) : null,
    chunkTokens: Number(process.env.RAG_CHUNK_TOKENS) || 800,
    overlapTokens: Number(process.env.RAG_CHUNK_OVERLAP_TOKENS) || 100,
  },

  chat: {
    rateLimitPerMinute: Number(process.env.CHAT_RATE_LIMIT_PER_MIN) || 20,
    logTimings: process.env.CHAT_LOG_TIMINGS !== '0',
  },
};
