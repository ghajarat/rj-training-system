// FR13: splits an SOP into overlapping chunks for embedding.
//
//   chunkDocument(pages, { maxChars: 3200, overlapChars: 400 })
//   → [{ index: 0, text, section: '5.3 Smoke hoods', page: 4 }, ...]
//
// Rules, in order:
//   1. A heading starts a new section. Chunks never cross a section, so a
//      citation's section title is always right.
//   2. Inside a section, whole paragraphs are packed into a chunk until the
//      next one would push it past maxChars (~800 tokens; English text
//      averages about 4 characters per token).
//   3. A paragraph longer than maxChars is cut at sentence ends (and, as a
//      last resort, at a word boundary).
//   4. Each chunk starts with the tail of the previous one (up to
//      overlapChars, ~100 tokens), so an answer that falls on a boundary is
//      still found in one piece.
//   5. A chunk's page is the page its new text starts on (PDFs only).
const SECTION_MAX = 255; // embeddings.section is VARCHAR(255)

// "## 5.1 Oxygen", "5.1 Oxygen bottles" (numbered, no full stop, as PDFs
// lose Markdown), or a short ALL-CAPS line like "EMERGENCY EQUIPMENT".
function headingOf(line) {
  const md = line.match(/^#{1,6}\s+(.+)$/);
  if (md) return md[1].trim();
  const t = line.trim();
  if (t.length > 80) return null;
  if (/^\d+(\.\d+)*\.?\s+[A-Z][^.]*$/.test(t)) return t;
  if (/^[A-Z][A-Z0-9 &/,()-]{3,59}$/.test(t) && /[A-Z]{3}/.test(t) && t.includes(' ')) return t;
  return null;
}

// pages → [{ text, section, page }] paragraphs, in reading order.
function toParagraphs(pages) {
  const paragraphs = [];
  let section = null;
  for (const { num, text } of pages) {
    let lines = [];
    const flush = () => {
      const joined = lines.join('\n').trim();
      if (joined) paragraphs.push({ text: joined, section, page: num ?? null });
      lines = [];
    };
    for (const line of text.split('\n')) {
      const heading = headingOf(line);
      if (heading) {
        flush();
        section = heading.slice(0, SECTION_MAX);
      } else if (!line.trim()) {
        flush();
      } else {
        lines.push(line.trim());
      }
    }
    flush();
  }
  return paragraphs;
}

function sentencesOf(text) {
  return text.match(/[^.!?]+[.!?]+["')\]]*(\s+|$)|[^.!?]+$/g) || [text];
}

// Cuts text into pieces of at most maxChars: at sentence ends where
// possible, otherwise at the last space before the limit.
function splitLong(text, maxChars) {
  const pieces = [];
  let buf = '';
  const push = () => { if (buf.trim()) pieces.push(buf.trim()); buf = ''; };
  for (let sentence of sentencesOf(text)) {
    while (sentence.length > maxChars) {
      push();
      const cut = sentence.lastIndexOf(' ', maxChars) > maxChars / 2 ? sentence.lastIndexOf(' ', maxChars) : maxChars;
      pieces.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut);
    }
    if (buf && buf.length + sentence.length > maxChars) push();
    buf += sentence;
  }
  push();
  return pieces;
}

// The end of the previous chunk, carried into the next one.
function overlapFrom(paragraphs, overlapChars) {
  const carried = [];
  let size = 0;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    if (size + p.text.length > overlapChars) {
      if (!carried.length) {
        // The last paragraph alone is too long: carry its final sentences.
        let tail = '';
        for (const s of sentencesOf(p.text).reverse()) {
          if (tail.length + s.length > overlapChars) break;
          tail = s + tail;
        }
        if (tail.trim()) carried.unshift({ ...p, text: tail.trim(), overlap: true });
      }
      break;
    }
    carried.unshift({ ...p, overlap: true });
    size += p.text.length + 2;
  }
  return carried;
}

function chunkDocument(pages, { maxChars = 3200, overlapChars = 400 } = {}) {
  const paragraphs = toParagraphs(pages).flatMap(p => (p.text.length > maxChars
    ? splitLong(p.text, maxChars).map(text => ({ ...p, text }))
    : [p]));

  const chunks = [];
  const emit = (parts) => {
    const fresh = parts.find(p => !p.overlap);
    if (!fresh) return;
    chunks.push({
      index: chunks.length,
      text: parts.map(p => p.text).join('\n\n'),
      section: fresh.section,
      page: fresh.page,
    });
  };

  let current = [];
  let size = 0;
  for (const p of paragraphs) {
    const sameSection = !current.length || current[0].section === p.section;
    if (!sameSection) {
      emit(current);
      current = [];
      size = 0;
    } else if (current.some(c => !c.overlap) && size + p.text.length > maxChars) {
      emit(current);
      current = overlapFrom(current, overlapChars);
      size = current.reduce((n, c) => n + c.text.length + 2, 0);
    }
    current.push(p);
    size += p.text.length + 2;
  }
  emit(current);
  return chunks;
}

module.exports = { chunkDocument, headingOf, splitLong };
