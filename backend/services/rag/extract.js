// FR13: pulls the text out of an uploaded SOP, keeping what a citation needs.
//
//   const pages = await extractText(filePath, 'pdf');
//   → [{ num: 1, text: '...' }, { num: 2, text: '...' }]   PDF: one entry per page
//   → [{ num: null, text: '...' }]                         DOCX / TXT: no pages
//
// DOCX headings are turned into Markdown-style "## Heading" lines, so the
// chunker finds sections the same way in every file type.
const fs = require('fs');

class ExtractionError extends Error {
  constructor(userMessage) {
    super(userMessage);
    this.userMessage = userMessage;
  }
}

// Tidies whitespace without losing the paragraph structure the chunker
// relies on: blank lines separate paragraphs, single newlines are kept.
function cleanText(text) {
  return String(text)
    .replace(/^﻿/, '')                              // byte-order mark
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(filePath) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: await fs.promises.readFile(filePath) });
  try {
    const result = await parser.getText();
    return result.pages.map(p => ({ num: p.num, text: cleanText(p.text) }));
  } catch (err) {
    if (err.name === 'PasswordException') {
      throw new ExtractionError('This PDF is password-protected. Remove the password and upload it again.');
    }
    throw new ExtractionError('This PDF could not be read. It may be damaged. Try saving it again and re-uploading.');
  } finally {
    await parser.destroy();
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m);
}

// mammoth turns Word styles into HTML (Heading 1 → <h1>, lists → <li>, ...).
// That HTML is then flattened to text with the headings marked.
async function extractDocx(filePath) {
  const mammoth = require('mammoth');
  let html;
  try {
    ({ value: html } = await mammoth.convertToHtml({ path: filePath }));
  } catch {
    throw new ExtractionError('This Word file could not be read. It may be damaged. Try saving it again as .docx.');
  }
  const text = html
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (m, inner) => `\n\n## ${inner.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|li|tr|table|ul|ol)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return [{ num: null, text: cleanText(decodeEntities(text)) }];
}

async function extractTxt(filePath) {
  return [{ num: null, text: cleanText(await fs.promises.readFile(filePath, 'utf8')) }];
}

const EXTRACTORS = { pdf: extractPdf, docx: extractDocx, txt: extractTxt };

async function extractText(filePath, ext) {
  const extractor = EXTRACTORS[ext];
  if (!extractor) throw new ExtractionError(`.${ext} files cannot be indexed.`);
  return extractor(filePath);
}

module.exports = { extractText, cleanText, ExtractionError };
