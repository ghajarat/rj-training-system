// Ask one question against whatever has been ingested.
//
//   npm run rag:ask -- "What do I do if a smoke hood seal is broken?"
//   npm run rag:ask -- --debug "..."      (also prints the retrieved chunks)
const db = require('../../db');
const { answer, MIN_SIMILARITY } = require('./rag');
const { EMBEDDING_MODEL, CHAT_MODEL } = require('./providers');

async function main() {
  const args = process.argv.slice(2);
  const debug = args.includes('--debug');
  const question = args.filter(a => a !== '--debug').join(' ').trim();
  if (!question) throw new Error('Usage: npm run rag:ask -- "your question"');

  const r = await answer(question);

  console.log(`\nQ: ${r.question}\n`);
  console.log(r.answer);
  if (r.sources.length) {
    console.log('\nSources:');
    for (const s of r.sources) console.log(`  [${s.n}] ${s.doc} — ${s.section} (similarity ${s.similarity.toFixed(3)})`);
  }

  if (debug) {
    console.log(`\nRetrieved (${EMBEDDING_MODEL}, floor ${MIN_SIMILARITY}):`);
    r.hits.forEach((h, i) => {
      const mark = h.similarity >= MIN_SIMILARITY ? '✓' : '✗';
      console.log(`  ${mark} ${i + 1}. ${h.similarity.toFixed(3)}  ${h.section}`);
    });
  }
  console.log(`\n${CHAT_MODEL} · retrieval ${r.timings.retrieveMs} ms · total ${r.timings.totalMs} ms`);
}

main()
  .catch(err => {
    console.error('Ask failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
