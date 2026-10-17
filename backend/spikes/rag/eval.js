// Accuracy + latency check over a fixed question set. This is the seed of the
// Phase 10 "chatbot accuracy eval".
//
//   npm run rag:eval
//   npm run rag:eval -- path/to/questions.json
//
// For each question it records:
//   retrieval hit  — the expected section is among the top-k chunks
//   answer correct — the answer contains every expected phrase
//   refusal        — out-of-scope questions get the "couldn't find" reply
//   latency        — retrieval and end-to-end time (target < 5 s)
// Results are printed and saved to spikes/rag/last-eval.json.
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { answer, TOP_K, MIN_SIMILARITY } = require('./rag');
const { EMBEDDING_MODEL, CHAT_MODEL } = require('./providers');

const norm = s => s.toLowerCase().replace(/,/g, '');

function pct(n, d) {
  return d ? `${Math.round((100 * n) / d)}%` : 'n/a';
}

async function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, 'eval-questions.json'));
  const { questions } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const results = [];

  for (const item of questions) {
    const r = await answer(item.q);
    const top = r.hits[0]?.similarity ?? 0;
    const row = { q: item.q, outOfScope: !!item.outOfScope, topSimilarity: top, ms: r.timings.totalMs, answer: r.answer };

    if (item.outOfScope) {
      row.pass = r.refused;
    } else {
      row.retrievalHit = r.hits.some(h => h.section === item.section);
      row.answerCorrect = !r.refused && item.expect.every(e => norm(r.answer).includes(norm(e)));
      row.cited = r.sources.length > 0;
      row.pass = row.answerCorrect && row.cited;
    }
    results.push(row);

    const flag = row.pass ? 'PASS' : 'FAIL';
    const extra = item.outOfScope ? 'out-of-scope' : `retrieval ${row.retrievalHit ? 'hit' : 'MISS'}`;
    console.log(`${flag}  ${top.toFixed(3)}  ${String(r.timings.totalMs).padStart(5)} ms  ${extra.padEnd(13)} ${item.q}`);
    if (!row.pass) console.log(`        → ${r.answer.replace(/\s+/g, ' ').slice(0, 160)}`);
  }

  const inScope = results.filter(r => !r.outOfScope);
  const outScope = results.filter(r => r.outOfScope);
  const times = results.map(r => r.ms).sort((a, b) => a - b);
  const p95 = times[Math.min(times.length - 1, Math.ceil(0.95 * times.length) - 1)];
  const minIn = Math.min(...inScope.map(r => r.topSimilarity));
  const maxOut = Math.max(...outScope.map(r => r.topSimilarity));

  const summary = {
    embeddingModel: EMBEDDING_MODEL,
    chatModel: CHAT_MODEL,
    topK: TOP_K,
    minSimilarity: MIN_SIMILARITY,
    retrievalHitRate: pct(inScope.filter(r => r.retrievalHit).length, inScope.length),
    answerAccuracy: pct(inScope.filter(r => r.pass).length, inScope.length),
    refusalRate: pct(outScope.filter(r => r.pass).length, outScope.length),
    avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    p95Ms: p95,
    lowestInScopeTopScore: Number(minIn.toFixed(3)),
    highestOutOfScopeTopScore: Number(maxOut.toFixed(3)),
  };

  console.log('\n', summary);
  if (maxOut >= minIn) {
    console.log('\nNote: some out-of-scope questions score as high as in-scope ones, so the');
    console.log('similarity floor alone cannot separate them — refusals rely on the prompt.');
  } else {
    console.log(`\nA similarity floor between ${maxOut.toFixed(3)} and ${minIn.toFixed(3)} separates in- from out-of-scope here.`);
  }

  fs.writeFileSync(path.join(__dirname, 'last-eval.json'), JSON.stringify({ ranAt: new Date().toISOString(), summary, results }, null, 2));
}

main()
  .catch(err => {
    console.error('Eval failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
