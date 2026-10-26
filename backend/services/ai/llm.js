// The language model behind the chatbot (FR10), behind one small function so
// the provider can be swapped in .env without touching the chat code:
//
//   LLM_PROVIDER=anthropic   LLM_MODEL=claude-haiku-5-5   (default)
//   LLM_PROVIDER=openai      LLM_MODEL=<an OpenAI chat model>
//
//   const { text, refused } = await generate({ system, messages });
//   messages = [{ role: 'user' | 'assistant', content: '...' }, ...]
//
// Short answers and a 5-second target (NFR) → small max_tokens and, on
// Claude, low effort (Claude Haiku 5.5 thinks adaptively; low effort keeps
// that thinking short).
const config = require('../../config');
const { openaiClient, anthropicClient, unavailable } = require('./clients');
const { fakeGenerate } = require('./fake');

const MAX_TOKENS = 1024;
const DEFAULT_MODELS = { anthropic: 'claude-haiku-5-5' };

const PROVIDER = config.ai.fake ? 'fake' : config.ai.llmProvider;
const MODEL = config.ai.fake ? 'fake-extractive' : (config.ai.llmModel || DEFAULT_MODELS[PROVIDER] || '');

if (!['fake', 'anthropic', 'openai'].includes(PROVIDER)) {
  throw new Error(`LLM_PROVIDER must be "anthropic" or "openai", not "${PROVIDER}".`);
}
if (PROVIDER === 'openai' && !MODEL) {
  throw new Error('LLM_PROVIDER=openai needs LLM_MODEL set to an OpenAI chat model name.');
}

async function generateAnthropic({ system, messages }) {
  const response = await anthropicClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: process.env.LLM_EFFORT || 'low' },
    system,
    messages,
  });
  // A safety decline arrives as a normal response with stop_reason "refusal".
  if (response.stop_reason === 'refusal') return { text: '', refused: true };
  // Thinking blocks are not part of the answer; only the text blocks are.
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return { text, refused: false };
}

async function generateOpenAI({ system, messages }) {
  const response = await openaiClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  const choice = response.choices[0];
  if (choice.message.refusal) return { text: '', refused: true };
  return { text: (choice.message.content || '').trim(), refused: false };
}

async function generate({ system, messages, notFoundToken }) {
  if (PROVIDER === 'fake') {
    return { text: fakeGenerate(messages[messages.length - 1].content, notFoundToken), refused: false };
  }
  try {
    return PROVIDER === 'anthropic'
      ? await generateAnthropic({ system, messages })
      : await generateOpenAI({ system, messages });
  } catch (err) {
    throw unavailable(`${PROVIDER} generation`, err);
  }
}

module.exports = { generate, PROVIDER, MODEL };
