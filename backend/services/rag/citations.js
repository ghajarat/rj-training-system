// FR11: turns the model's [n] markers into citations the UI can show.
//
//   mapCitations('Check the gauge [2]. Tag it U/S [2][7].', chunks)
//   → { text: 'Check the gauge [1]. Tag it U/S [1].',
//       citations: [{ n: 1, docId, title, section, page, excerpt, similarity }] }
//
// The model was shown chunks numbered 1..k. Any number outside that range
// does not point at a real source, so it is removed (NFR18 output check).
// The numbers that remain are renumbered 1, 2, 3 in order of first use, so
// the chips under an answer always read [1] [2] [3].
const EXCERPT_MAX = 700;

// "[1, 2]", "[1,2]" and "[1-3]" → "[1][2]" / "[1][2][3]"
function normaliseMarkers(text) {
  return text
    .replace(/\[(\d+)\s*[-–]\s*(\d+)\]/g, (m, a, b) => {
      const from = Number(a);
      const to = Number(b);
      if (to < from || to - from > 10) return m;
      return Array.from({ length: to - from + 1 }, (_, i) => `[${from + i}]`).join('');
    })
    .replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (m, list) => list.split(',').map(n => `[${n.trim()}]`).join(''));
}

function excerptOf(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX).replace(/\s+\S*$/, '')}…` : clean;
}

function mapCitations(rawText, chunks) {
  const text = normaliseMarkers(rawText);
  const newNumber = new Map(); // model's number → number shown to the user

  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= chunks.length && !newNumber.has(n)) newNumber.set(n, newNumber.size + 1);
  }

  const mapped = text
    .replace(/\[(\d+)\]/g, (m, n) => (newNumber.has(Number(n)) ? `[${newNumber.get(Number(n))}]` : ''))
    .replace(/(\[\d+\])(?:\1)+/g, '$1')       // "[1][1]" → "[1]"
    .replace(/[ \t]+([.,;:!?])/g, '$1')       // space left before punctuation
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const citations = [...newNumber.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([original, n]) => {
      const c = chunks[original - 1];
      return {
        n,
        docId: c.docId,
        title: c.title,
        section: c.section,
        page: c.page,
        excerpt: excerptOf(c.text),
        similarity: Math.round(c.similarity * 1000) / 1000,
      };
    });

  return { text: mapped, citations };
}

// Removes [n] markers, e.g. from earlier answers sent back as history.
function stripMarkers(text) {
  return text.replace(/\s?\[\d+\]/g, '');
}

module.exports = { mapCitations, normaliseMarkers, stripMarkers };
