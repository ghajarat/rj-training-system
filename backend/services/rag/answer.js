// FR10 / FR11 / NFR18: one question in, one grounded answer out.
//
//   1. rule check (safety.js)           greeting → canned reply; injection,
//                                       harmful, off-topic → polite refusal
//   2. moderation + embed the question  run in parallel to save time
//   3. retrieve top-k chunks            nothing above the floor → "not found",
//                                       and the LLM is never called
//   4. generate                          grounded prompt with ~6 turns history
//   5. map citations                     drop [n] that match no chunk; an
//                                       answer citing nothing is not trusted
//   6. moderation on the answer
//   7. related courses (0–3), by meaning, from the question's vector
//
// Returns { text, outcome, citations, relatedCourseIds, timings }. Saving is
// the caller's job (routes/chat.js), so a failed AI call saves nothing.
const config = require('../../config');
const { checkQuestion, REPLIES } = require('./safety');
const { moderate } = require('../ai/moderation');
const { embed } = require('../ai/embeddings');
const { generate } = require('../ai/llm');
const { retrieve } = require('./retrieve');
const { SYSTEM_PROMPT, NOT_FOUND_TOKEN, buildMessages, retrievalQuery, isNotFound } = require('./prompt');
const { mapCitations } = require('./citations');
const { findRelatedCourseIds } = require('./relatedCourses');

const NOT_FOUND_REPLY = "I couldn't find this in the company SOPs. Try asking in a different way, or check with your trainer.";

function timer() {
  const start = Date.now();
  let last = start;
  const marks = {};
  return {
    mark(name) {
      const now = Date.now();
      marks[name] = now - last;
      last = now;
    },
    done() {
      return { ...marks, totalMs: Date.now() - start };
    },
  };
}

function reply(outcome, text, extra = {}) {
  return { outcome, text, citations: [], relatedCourseIds: [], ...extra };
}

async function answerQuestion({ question, history, user }) {
  const t = timer();

  const rule = checkQuestion(question);
  t.mark('rulesMs');
  if (rule?.kind === 'greeting') return { ...reply('answered', rule.reply), timings: t.done() };
  if (rule) return { ...reply('refused', rule.reply), reason: rule.reason, timings: t.done() };

  const [inputCheck, [queryVector]] = await Promise.all([
    moderate(question),
    embed([retrievalQuery(question, history)]),
  ]);
  t.mark('moderateAndEmbedMs');
  if (inputCheck.flagged) return { ...reply('refused', REPLIES.harmful), reason: 'moderation', timings: t.done() };

  const { used } = await retrieve(queryVector);
  t.mark('retrieveMs');

  let result;
  if (!used.length) {
    result = reply('not_found', NOT_FOUND_REPLY);
  } else {
    const generated = await generate({
      system: SYSTEM_PROMPT,
      messages: buildMessages({ history, question, chunks: used }),
      notFoundToken: NOT_FOUND_TOKEN,
    });
    t.mark('generateMs');

    const mapped = generated.refused ? null : mapCitations(generated.text, used);
    if (generated.refused) {
      result = { ...reply('refused', REPLIES.harmful), reason: 'model' };
    } else if (isNotFound(generated.text) || !mapped.citations.length) {
      // An answer that cites no excerpt is not grounded in the SOPs (FR11),
      // so it is treated as "not found" rather than shown.
      result = reply('not_found', NOT_FOUND_REPLY);
    } else {
      const outputCheck = await moderate(mapped.text);
      t.mark('outputCheckMs');
      result = outputCheck.flagged
        ? { ...reply('refused', REPLIES.harmful), reason: 'output_moderation' }
        : reply('answered', mapped.text, { citations: mapped.citations });
    }
  }

  if (result.outcome !== 'refused') {
    result.relatedCourseIds = await findRelatedCourseIds(queryVector, user);
    t.mark('relatedMs');
  }
  return { ...result, timings: t.done() };
}

// One line per question for checking the < 5 s target. No message text.
function logTimings(outcome, timings) {
  if (!config.chat.logTimings) return;
  const parts = Object.entries(timings).map(([k, v]) => `${k.replace(/Ms$/, '')}=${v}ms`);
  console.log(`[chat] ${outcome} ${parts.join(' ')}`);
}

module.exports = { answerQuestion, logTimings, NOT_FOUND_REPLY };
