// Reads an SOP file and splits it into overlapping, section-aware chunks.
//
// Strategy (deliberately simple — tune it in Phase 5 if the eval says so):
//   1. Split the text into sections at Markdown headings ("#", "##", ...).
//   2. Inside each section, pack whole paragraphs into chunks of up to
//      MAX_CHARS (~350 tokens). Paragraphs longer than that are split at
//      sentence boundaries.
//   3. Each new chunk repeats the last paragraph of the previous one
//      (if it's short) so an answer that straddles a boundary is still found.
//   4. Every chunk is prefixed with "Document:" and "Section:" lines. That
//      context gets embedded too, which helps retrieval, and it's what we
//      show as the citation.
const fs = require('fs');
const path = require('path');

const MAX_CHARS = Number(process.env.RAG_CHUNK_CHARS) || 1500;
const OVERLAP_MAX_CHARS = 400;

async function readDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8');
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  throw new Error(`Unsupported file type "${ext}". Use .pdf, .txt or .md.`);
}

// A heading is either Markdown ("## 5.1 Oxygen") or, for text pulled out of a
// PDF, a short numbered line with no full stop at the end ("5.1 Oxygen bottles").
function headingOf(line) {
  const md = line.match(/^#{1,6}\s+(.*)$/);
  if (md) return md[1].trim();
  const t = line.trim();
  if (t.length <= 80 && /^\d+(\.\d+)*\.?\s+[A-Z][^.]*$/.test(t)) return t;
  return null;
}

function splitSections(text) {
  const sections = [];
  let current = { heading: 'Introduction', lines: [] };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = headingOf(line);
    if (heading) {
      if (current.lines.join('').trim()) sections.push(current);
      current = { heading, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push(current);
  return sections;
}

function splitLongParagraph(p) {
  const sentences = p.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [p];
  const parts = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && buf.length + s.length > MAX_CHARS) {
      parts.push(buf.trim());
      buf = '';
    }
    buf += s;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function chunkText(text, docName) {
  const chunks = [];
  for (const { heading, lines } of splitSections(text)) {
    const paragraphs = lines
      .join('\n')
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean)
      .flatMap(p => (p.length > MAX_CHARS ? splitLongParagraph(p) : [p]));

    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      chunks.push({ section: heading, text: `Document: ${docName}\nSection: ${heading}\n\n${buf.join('\n\n')}` });
      const last = buf[buf.length - 1];
      buf = last.length <= OVERLAP_MAX_CHARS && buf.length > 1 ? [last] : [];
    };

    for (const p of paragraphs) {
      const size = buf.reduce((n, x) => n + x.length + 2, 0);
      if (buf.length && size + p.length > MAX_CHARS) flush();
      buf.push(p);
    }
    // Don't emit a chunk that is only the overlap carried from the last one.
    if (buf.length && !(chunks.length && chunks[chunks.length - 1].text.endsWith(buf.join('\n\n')))) {
      flush();
    }
  }
  return chunks;
}

module.exports = { readDocument, chunkText, MAX_CHARS };
