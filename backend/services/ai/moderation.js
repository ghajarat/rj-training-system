// NFR18: OpenAI's moderation endpoint (free) checks a text for harmful
// content (violence, self-harm, hate, sexual content, ...). Used on the
// user's question and again on the bot's answer.
//
//   const { flagged } = await moderate(text);
//
// If the moderation service itself is down, the check "fails open": the
// message continues, and our rule layer (services/rag/safety.js) plus the
// grounded prompt still apply. Blocking every question because a safety
// service is slow would make the assistant unusable; the failure is logged.
const config = require('../../config');
const { openaiClient } = require('./clients');
const { fakeModerate } = require('./fake');

async function moderate(text) {
  if (config.ai.fake) return { flagged: fakeModerate(text), checked: true };
  try {
    const response = await openaiClient().moderations.create({ model: config.ai.moderationModel, input: text });
    const result = response.results[0];
    const categories = Object.keys(result.categories).filter(c => result.categories[c]);
    return { flagged: result.flagged, categories, checked: true };
  } catch (err) {
    console.error(`Moderation check skipped: ${err.status || ''} ${err.message}`);
    return { flagged: false, checked: false };
  }
}

module.exports = { moderate };
