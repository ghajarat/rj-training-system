// SOP files on local disk (FR13). Same approach as training materials
// (services/materialFiles.js), in a separate folder with its own types.
//
// Files live in backend/uploads/sops/ (gitignored) under a random name we
// generate: "<uuid>.<ext>". documents.file_url holds "upload:<uuid>.<ext>".
// The admin's original file name is never used as a path.
const fs = require('fs');
const path = require('path');
const HttpError = require('../utils/httpError');

const SOPS_DIR = path.join(__dirname, '..', 'uploads', 'sops');
const STORED_PREFIX = 'upload:';
const STORED_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|txt)$/;

// Allowed types. The extension decides the type and the content must match:
//   PDF   starts with "%PDF-"
//   DOCX  is a ZIP archive: starts with "PK\x03\x04"
//   TXT   has no signature, so the whole file must be valid UTF-8 text with
//         no NUL bytes (a binary file renamed to .txt fails this)
const FILE_TYPES = {
  pdf:  { label: 'PDF',  contentType: 'application/pdf' },
  docx: { label: 'Word', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  txt:  { label: 'Text', contentType: 'text/plain; charset=utf-8' },
};

function allowedExtension(originalName) {
  const ext = path.extname(String(originalName || '')).slice(1).toLowerCase();
  return FILE_TYPES[ext] ? ext : null;
}

async function isUtf8Text(filePath) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stream = fs.createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      if (chunk.includes(0)) return false;
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  } finally {
    stream.destroy();
  }
}

async function hasValidSignature(filePath, ext) {
  if (ext === 'txt') return isUtf8Text(filePath);
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, 8, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (ext === 'pdf') return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  } finally {
    await handle.close();
  }
}

function toFileUrl(storedName) {
  return `${STORED_PREFIX}${storedName}`;
}

// Absolute path for a stored SOP, or null if the value is not one of our
// generated names (a hand-edited row still cannot point outside SOPS_DIR).
function pathFor(fileUrl) {
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith(STORED_PREFIX)) return null;
  const name = fileUrl.slice(STORED_PREFIX.length);
  return STORED_NAME_RE.test(name) ? path.join(SOPS_DIR, name) : null;
}

// "pdf" / "docx" / "txt", or null for rows that are not our uploads.
function typeOf(fileUrl) {
  const filePath = pathFor(fileUrl);
  return filePath ? path.extname(filePath).slice(1) : null;
}

async function removePath(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not delete SOP file ${filePath}: ${err.message}`);
  }
}

// Called only AFTER the database change has committed.
async function removeStored(fileUrl) {
  const filePath = pathFor(fileUrl);
  if (filePath) await removePath(filePath);
}

function ensureDir() {
  fs.mkdirSync(SOPS_DIR, { recursive: true });
}

// Used by db/seed.js, which wipes every document row.
async function removeAllStored() {
  if (!fs.existsSync(SOPS_DIR)) return;
  for (const name of await fs.promises.readdir(SOPS_DIR)) {
    if (STORED_NAME_RE.test(name)) await removePath(path.join(SOPS_DIR, name));
  }
}

function downloadName(title, ext) {
  const base = title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'sop';
  return `${base}.${ext}`;
}

// GET /api/documents/:id/file. PDFs open in the browser's viewer ("inline"),
// the others download.
async function sendSopFile(res, { doc_name: title, file_url: fileUrl }) {
  const filePath = pathFor(fileUrl);
  try {
    if (!filePath) throw new Error('not stored');
    await fs.promises.access(filePath);
  } catch {
    throw new HttpError(404, 'FILE_MISSING', 'The file for this SOP could not be found on the server. An admin needs to upload it again.');
  }
  const ext = typeOf(fileUrl);
  res.type(FILE_TYPES[ext].contentType);
  res.attachment(downloadName(title, ext));
  if (ext === 'pdf') res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
  res.sendFile(filePath);
}


module.exports = {
  SOPS_DIR, FILE_TYPES, allowedExtension, hasValidSignature, toFileUrl, pathFor, typeOf,
  removePath, removeStored, ensureDir, removeAllStored, sendSopFile,
};
