// Training material files on local disk (FR7).
//
// Files live in backend/uploads/materials/ (gitignored) under a random name
// we generate: "<uuid>.<ext>". The user's original filename is never used as
// a path, so it cannot point outside the folder or overwrite another file.
//
// courses.material_url (GP1 column) holds one of:
//   NULL                    no material yet
//   "https://..."           a web link
//   "upload:<uuid>.<ext>"   a file stored here
//
// The type shown in the UI (pdf, docx, pptx, mp4, link) is derived from that
// value, so no extra column is needed.
const fs = require('fs');
const path = require('path');

const MATERIALS_DIR = path.join(__dirname, '..', 'uploads', 'materials');
const STORED_PREFIX = 'upload:';
const STORED_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|pptx|mp4)$/;

// Allowed upload types. The extension decides the type; the first bytes of
// the file must then match it. The browser's Content-Type header is not
// trusted: it is only a claim made by the client.
//   PDF        starts with "%PDF-"
//   DOCX/PPTX  are ZIP archives: start with "PK\x03\x04"
//   MP4        has "ftyp" at byte 4
const FILE_TYPES = {
  pdf:  { label: 'PDF',        matches: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  docx: { label: 'Word',       matches: isZip },
  pptx: { label: 'PowerPoint', matches: isZip },
  mp4:  { label: 'Video',      matches: b => b.subarray(4, 8).toString('latin1') === 'ftyp' },
};

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// "Report.PDF" → "pdf" when allowed, otherwise null.
function allowedExtension(originalName) {
  const ext = path.extname(String(originalName || '')).slice(1).toLowerCase();
  return FILE_TYPES[ext] ? ext : null;
}

// Reads the first bytes of an uploaded file and checks them against its type.
async function hasValidSignature(filePath, ext) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    return FILE_TYPES[ext].matches(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function isStoredFile(materialUrl) {
  return typeof materialUrl === 'string' && materialUrl.startsWith(STORED_PREFIX);
}

function toMaterialUrl(storedName) {
  return `${STORED_PREFIX}${storedName}`;
}

// Absolute path for a stored material, or null if the value is not one of
// our generated names (defence in depth: a hand-edited DB row still cannot
// make us read a file outside MATERIALS_DIR).
function pathFor(materialUrl) {
  if (!isStoredFile(materialUrl)) return null;
  const name = materialUrl.slice(STORED_PREFIX.length);
  return STORED_NAME_RE.test(name) ? path.join(MATERIALS_DIR, name) : null;
}

// { type, label, url } for the frontend. `url` is only set for web links;
// stored files are fetched through GET /api/courses/:id/material.
function describe(materialUrl) {
  if (!materialUrl) return null;
  if (isStoredFile(materialUrl)) {
    const ext = path.extname(materialUrl).slice(1);
    return { type: ext, label: FILE_TYPES[ext]?.label || ext.toUpperCase(), url: null };
  }
  return { type: 'link', label: 'Web link', url: materialUrl };
}

// Deletes a file that is no longer referenced. Called only AFTER the database
// change has committed: if the commit failed we must still have the file.
// A failure here leaves an orphan file on disk (logged), never a course row
// pointing at a missing file.
async function removeStored(materialUrl) {
  const filePath = pathFor(materialUrl);
  if (filePath) await removePath(filePath);
}

async function removePath(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not delete material file ${filePath}: ${err.message}`);
  }
}

function ensureDir() {
  fs.mkdirSync(MATERIALS_DIR, { recursive: true });
}

// Used by db/seed.js: the seed wipes every course, so their files go too.
async function removeAllStored() {
  if (!fs.existsSync(MATERIALS_DIR)) return;
  for (const name of await fs.promises.readdir(MATERIALS_DIR)) {
    if (STORED_NAME_RE.test(name)) await removePath(path.join(MATERIALS_DIR, name));
  }
}

module.exports = {
  MATERIALS_DIR,
  FILE_TYPES,
  allowedExtension,
  hasValidSignature,
  isStoredFile,
  toMaterialUrl,
  pathFor,
  describe,
  removeStored,
  removePath,
  ensureDir,
  removeAllStored,
};
