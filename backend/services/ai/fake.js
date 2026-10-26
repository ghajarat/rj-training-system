// Offline stand-ins for the AI services, used when AI_FAKE=1.
//
// They make the whole pipeline run with no API keys and no cost, which is
// what the automated tests need. They say NOTHING about answer quality.
//
//   fakeEmbed(text)    hashing-trick vector: each word and word pair bumps one
//                      of the 1536 dimensions, so texts sharing words are
//                      "similar". Crude keyword overlap, but deterministic.
//   fakeGenerate(...)  quotes the first two sentences of excerpt [1].
//   fakeModerate(text) flags nothing, except the test marker below.
const crypto = require('crypto');

const DIMS = 1536;
// Common words are ignored, otherwise every English sentence would look
// "similar" to every other one just by sharing "the", "what" and "is".
const STOP_WORDS = new Set(('a an and are as at be by can do does for from has have how i if in is it '
  + 'its me my of on or should that the their them there these they this to was we what when where '
  + 'which who why will with you your').split(' '));
// Lets the API tests exercise the moderation path without a real classifier.
const FAKE_FLAG_MARKER = 'FAKE_FLAGGED_CONTENT';

function fakeEmbed(text) {
  const v = new Array(DIMS).fill(0);
  const words = (String(text).toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => !STOP_WORDS.has(w));
  const terms = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  for (const t of terms) {
    const h = crypto.createHash('md5').update(t).digest();
    v[h.readUInt32LE(0) % DIMS] += h[4] & 1 ? 1 : -1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map(x => x / norm);
}

function fakeGenerate(lastUserMessage, notFoundToken) {
  const m = lastUserMessage.match(/<excerpt id="1"[^>]*>\s*([\s\S]*?)<\/excerpt>/);
  if (!m) return notFoundToken;
  const sentences = m[1].trim().match(/[^.!?]+[.!?]+/g) || [m[1].trim()];
  return `${sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim()} [1]`;
}

function fakeModerate(text) {
  return String(text).includes(FAKE_FLAG_MARKER);
}

module.exports = { fakeEmbed, fakeGenerate, fakeModerate, FAKE_FLAG_MARKER, DIMS };
