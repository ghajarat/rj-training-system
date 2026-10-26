// Creates the OpenAI and Anthropic SDK clients once, on first use.
//
// Both SDKs retry 408/409/429/5xx and dropped connections themselves, with
// exponential backoff (maxRetries below), so no retry loop of our own is
// needed. The keys come from config (.env) and are never logged.
const OpenAI = require('openai');
const AnthropicSdk = require('@anthropic-ai/sdk');
const config = require('../../config');
const HttpError = require('../../utils/httpError');

const Anthropic = AnthropicSdk.default || AnthropicSdk;
const MAX_RETRIES = 3;

let openai;
let anthropic;

function notConfigured(keyName) {
  return new HttpError(503, 'AI_NOT_CONFIGURED',
    `The AI assistant is not set up on this server yet (${keyName} is missing). Please tell your administrator.`);
}

function openaiClient() {
  if (!config.ai.openaiKey) throw notConfigured('OPENAI_API_KEY');
  openai ||= new OpenAI({ apiKey: config.ai.openaiKey, maxRetries: MAX_RETRIES, timeout: config.ai.timeoutMs });
  return openai;
}

function anthropicClient() {
  if (!config.ai.anthropicKey) throw notConfigured('ANTHROPIC_API_KEY');
  anthropic ||= new Anthropic({ apiKey: config.ai.anthropicKey, maxRetries: MAX_RETRIES, timeout: config.ai.timeoutMs });
  return anthropic;
}

// Turns an SDK failure (after its retries) into a clear 503 for the user.
// The SDK's own message is logged for the developer; it never contains the key.
function unavailable(service, err) {
  if (err instanceof HttpError) return err;
  console.error(`${service} request failed: ${err.status || ''} ${err.message}`);
  return new HttpError(503, 'AI_UNAVAILABLE',
    'The AI service is not responding right now. Please try again in a minute.');
}

module.exports = { openaiClient, anthropicClient, unavailable, Anthropic };
