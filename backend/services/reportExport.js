// Phase 8 (FR17): turns a report (services/reports.js) into a file.
//
//   toPdf(report, { generatedBy })  → Promise<Buffer>   A4 landscape, RJ colours
//   toCsv(report)                   → string            for Excel / Sheets
//   fileName(report, ext)           → "rj-cohort-progress-2026-11-14.pdf"
//
// Both writers only read the report object, so a PDF, a CSV and the preview
// on screen always show the same numbers.
const PDFDocument = require('pdfkit');

// The locked design palette (frontend/src/styles/tokens.css). A PDF cannot
// read CSS variables, so the same values are repeated here, once.
const COLORS = {
  primary: '#5F6367',   // Flint Gray
  accent: '#A8854A',    // Prom Gold
  text: '#2A2D2F',      // Dark Slate
  muted: '#6B6F73',
  page: '#F2F2F2',      // Light Gray
  border: '#DADCE0',
  white: '#FFFFFF',
};

const NUMERIC = new Set(['int', 'pct', 'rating', 'money', 'score', 'change']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-14" → "14 Nov 2026"
function readableDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function readableDateTime(iso) {
  const t = new Date(iso);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${readableDate(t.toISOString())}, ${hh}:${mm} UTC`;
}

// One value as people read it (PDF and preview). Empty → "-".
function formatValue(value, type) {
  if (value === null || value === undefined || value === '') return '-';
  switch (type) {
    case 'int':
    case 'money': return Number(value).toLocaleString('en-US');
    case 'pct': return `${value}%`;
    case 'rating': return `${Number(value).toFixed(1)} / 5`;
    case 'score': return value > 0 ? `+${value}` : String(value);
    case 'change': return value > 0 ? `+${value}%` : `${value}%`;
    case 'date': return readableDate(value);
    case 'datetime': return readableDateTime(value);
    default: return String(value);
  }
}

function fileName(report, ext) {
  return `rj-${report.id}-${report.generatedAt.slice(0, 10)}.${ext}`;
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

// A cell that starts with = + - @ (or a tab / carriage return) can run as a
// formula when the file is opened in Excel ("CSV injection"). Text cells like
// that get a leading apostrophe. Real numbers are left alone, so -12 stays a
// number.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvLine = cells => cells.map(csvCell).join(',');

// Raw values (numbers as numbers, dates as YYYY-MM-DD) so a spreadsheet can
// sort and sum them. Sections follow each other with a blank line between.
function toCsv(report) {
  const lines = [
    csvLine(['Report', report.title]),
    csvLine(['Generated (UTC)', report.generatedAt.slice(0, 16).replace('T', ' ')]),
    ...report.filters.map(f => csvLine([f.label, f.value])),
    '',
    csvLine(['Summary', 'Value']),
    ...report.summary.map(s => csvLine([s.label, s.value])),
  ];
  for (const section of report.sections) {
    lines.push('', csvLine([section.title]));
    lines.push(csvLine(section.columns.map(c => c.label)));
    for (const row of section.rows) lines.push(csvLine(section.columns.map(c => row[c.key])));
  }
  if (report.notes.length) {
    lines.push('', csvLine(['Notes']), ...report.notes.map(n => csvLine([n])));
  }
  // The BOM tells Excel the file is UTF-8 (otherwise accented names break).
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------

// The built-in PDF fonts (Helvetica) only cover Western European characters.
// Anything else would print as garbage, so it is swapped for a close match
// or "?". Embedding a Unicode font would lift this limit (e.g. Arabic names).
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function pdfText(value) {
  return String(value)
    .replace(/[−]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, ch => (WIN_ANSI_EXTRAS.includes(ch) ? ch : '?'));
}

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const CELL_PAD = 5;
const TABLE_FONT_SIZE = 8;

function bottomOf(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc, height) {
  if (doc.y + height > bottomOf(doc)) doc.addPage();
}

function drawHeader(doc, report, generatedBy) {
  const { left } = doc.page.margins;
  const width = doc.page.width - left - doc.page.margins.right;

  doc.rect(left, doc.y, 4, 46).fill(COLORS.accent);
  const top = doc.y;
  doc.fillColor(COLORS.accent).font(FONT_BOLD).fontSize(8)
    .text('ROYAL JORDANIAN  |  TRAINING SYSTEM', left + 12, top, { characterSpacing: 1 });
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(20).text(pdfText(report.title), left + 12, top + 12);
  doc.fillColor(COLORS.muted).font(FONT).fontSize(9)
    .text(pdfText(report.description), left + 12, doc.y + 2, { width: width - 12 });

  const meta = [`Generated ${readableDateTime(report.generatedAt)}`];
  if (generatedBy) meta.push(`by ${generatedBy}`);
  const filters = report.filters.length
    ? report.filters.map(f => `${f.label}: ${f.value}`).join('   |   ')
    : 'No filters (all data)';
  doc.moveDown(0.6);
  doc.fillColor(COLORS.primary).fontSize(8.5)
    .text(pdfText(`${meta.join(' ')}     ${filters}`), left, doc.y, { width });
  doc.moveDown(1);
}

function drawSummary(doc, summary) {
  if (!summary.length) return;
  const { left } = doc.page.margins;
  const width = doc.page.width - left - doc.page.margins.right;
  const gap = 10;
  const perRow = Math.min(summary.length, 5);
  const boxW = (width - gap * (perRow - 1)) / perRow;
  const boxH = 48;

  for (let i = 0; i < summary.length; i += perRow) {
    ensureSpace(doc, boxH + 10);
    const y = doc.y;
    summary.slice(i, i + perRow).forEach((item, j) => {
      const x = left + j * (boxW + gap);
      doc.roundedRect(x, y, boxW, boxH, 6).fillAndStroke(COLORS.page, COLORS.border);
      doc.fillColor(COLORS.muted).font(FONT).fontSize(8)
        .text(pdfText(item.label), x + 10, y + 9, { width: boxW - 20, lineBreak: false, ellipsis: true });
      doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(16)
        .text(pdfText(formatValue(item.value, item.type)), x + 10, y + 22, { width: boxW - 20, lineBreak: false });
    });
    doc.x = left;
    doc.y = y + boxH + 10;
  }
  doc.moveDown(0.6);
}

// Column widths: each column asks for the width of its longest cell (capped),
// then all are scaled to fill the page.
function columnWidths(doc, columns, cells, width) {
  doc.fontSize(TABLE_FONT_SIZE);
  const wanted = columns.map((col, i) => {
    doc.font(FONT_BOLD);
    let w = doc.widthOfString(pdfText(col.label));
    doc.font(FONT);
    for (const row of cells) w = Math.max(w, doc.widthOfString(row[i]));
    return Math.min(Math.max(w, 30), 220) + CELL_PAD * 2;
  });
  const total = wanted.reduce((a, b) => a + b, 0);
  return wanted.map(w => (w / total) * width);
}

function drawRow(doc, texts, widths, columns, { header = false, shade = false } = {}) {
  const { left } = doc.page.margins;
  doc.font(header ? FONT_BOLD : FONT).fontSize(TABLE_FONT_SIZE);
  const height = Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: widths[i] - CELL_PAD * 2 })))
    + CELL_PAD * 2;
  const y = doc.y;
  const totalWidth = widths.reduce((a, b) => a + b, 0);

  if (header) doc.rect(left, y, totalWidth, height).fill(COLORS.primary);
  else if (shade) doc.rect(left, y, totalWidth, height).fill(COLORS.page);

  let x = left;
  texts.forEach((t, i) => {
    doc.fillColor(header ? COLORS.white : COLORS.text)
      .text(t, x + CELL_PAD, y + CELL_PAD, {
        width: widths[i] - CELL_PAD * 2,
        align: NUMERIC.has(columns[i].type) ? 'right' : 'left',
      });
    x += widths[i];
  });
  if (!header) {
    doc.moveTo(left, y + height).lineTo(left + totalWidth, y + height).lineWidth(0.5).stroke(COLORS.border);
  }
  doc.x = left;
  doc.y = y + height;
  return height;
}

function drawSection(doc, section) {
  const { left } = doc.page.margins;
  const width = doc.page.width - left - doc.page.margins.right;

  ensureSpace(doc, 70);   // title + header + at least one row together
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(12).text(pdfText(section.title), left, doc.y);
  doc.moveDown(0.4);

  if (!section.rows.length) {
    doc.fillColor(COLORS.muted).font(FONT).fontSize(9).text(pdfText(section.empty || 'No data.'), left, doc.y);
    doc.moveDown(1.2);
    return;
  }

  const cells = section.rows.map(row => section.columns.map(c => pdfText(formatValue(row[c.key], c.type))));
  const widths = columnWidths(doc, section.columns, cells, width);
  const headerTexts = section.columns.map(c => pdfText(c.label));

  drawRow(doc, headerTexts, widths, section.columns, { header: true });
  cells.forEach((texts, i) => {
    doc.font(FONT).fontSize(TABLE_FONT_SIZE);
    const need = Math.max(...texts.map((t, j) => doc.heightOfString(t, { width: widths[j] - CELL_PAD * 2 })))
      + CELL_PAD * 2;
    if (doc.y + need > bottomOf(doc)) {
      doc.addPage();
      drawRow(doc, headerTexts, widths, section.columns, { header: true });   // repeat the header
    }
    drawRow(doc, texts, widths, section.columns, { shade: i % 2 === 1 });
  });
  doc.moveDown(1.2);
}

function drawNotes(doc, notes) {
  if (!notes.length) return;
  const { left } = doc.page.margins;
  const width = doc.page.width - left - doc.page.margins.right;
  ensureSpace(doc, 40);
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text('Notes', left, doc.y);
  doc.moveDown(0.3);
  doc.fillColor(COLORS.muted).font(FONT).fontSize(8.5);
  for (const note of notes) doc.text(pdfText(`-  ${note}`), left, doc.y, { width });
}

// Footer on every page, written last so "Page x of y" knows y.
function drawFooters(doc, report) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const { left, right } = doc.page.margins;
    const width = doc.page.width - left - right;
    const y = doc.page.height - 32;
    // Writing inside the bottom margin would otherwise start a new page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(left, y - 6).lineTo(left + width, y - 6).lineWidth(0.5).stroke(COLORS.border);
    doc.fillColor(COLORS.muted).font(FONT).fontSize(7.5)
      .text(pdfText(`RJ Training System  |  ${report.title}  |  Internal use only`), left, y, { width, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, y, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

function toPdf(report, { generatedBy = null } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 50, left: 40, right: 40 },
      bufferPages: true,
      info: {
        Title: report.title,
        Author: generatedBy || 'RJ Training System',
        Subject: report.description,
        Creator: 'RJ Training System',
      },
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawHeader(doc, report, generatedBy);
      drawSummary(doc, report.summary);
      report.sections.forEach(s => drawSection(doc, s));
      drawNotes(doc, report.notes);
      drawFooters(doc, report);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { toPdf, toCsv, fileName, formatValue, csvCell, pdfText };
