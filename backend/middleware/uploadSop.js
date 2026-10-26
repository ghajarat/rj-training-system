// Accepts one SOP file in the multipart field "file" (FR13). Mirrors
// middleware/uploadMaterial.js (Phase 4b) with the SOP types and limit.
//
//   router.post('/', uploadSop, handler)   →  req.file (or undefined)
//
// Checks, cheapest first: extension (PDF, DOCX, TXT) before anything is
// written; size (SOP_MAX_MB) while streaming to disk; then the content must
// match the extension (services/sopFiles.js).
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const HttpError = require('../utils/httpError');
const sopFiles = require('../services/sopFiles');

const ALLOWED_LIST = 'PDF, DOCX or TXT';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      sopFiles.ensureDir();
      cb(null, sopFiles.SOPS_DIR);
    },
    filename: (req, file, cb) => {
      cb(null, `${crypto.randomUUID()}.${sopFiles.allowedExtension(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: config.sops.maxMb * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 4 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!sopFiles.allowedExtension(file.originalname)) {
      return cb(new HttpError(400, 'FILE_TYPE_NOT_ALLOWED', `Only ${ALLOWED_LIST} files can be uploaded as SOPs.`));
    }
    return cb(null, true);
  },
}).single('file');

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new HttpError(413, 'FILE_TOO_LARGE', `The file is larger than the ${config.sops.maxMb} MB limit.`);
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      return new HttpError(400, 'VALIDATION', 'Send one file, in the field named "file".');
    }
    return new HttpError(400, 'VALIDATION', 'The upload could not be read. Please try again.');
  }
  return err;
}

async function discardUpload(req) {
  if (req.file?.path) await sopFiles.removePath(req.file.path);
}

function uploadSop(req, res, next) {
  upload(req, res, async (err) => {
    if (err) return next(toHttpError(err));
    if (!req.file) return next();
    try {
      const ext = sopFiles.allowedExtension(req.file.originalname);
      if (!(await sopFiles.hasValidSignature(req.file.path, ext))) {
        await discardUpload(req);
        return next(new HttpError(400, 'FILE_CONTENT_MISMATCH', ext === 'txt'
          ? 'This file is not plain text (UTF-8). Save it as a .txt file and try again.'
          : `This file is not a real ${ext.toUpperCase()} file. Check the file and try again.`));
      }
      req.file.ext = ext;
      req.file.fileUrl = sopFiles.toFileUrl(req.file.filename);
      return next();
    } catch (checkErr) {
      await discardUpload(req);
      return next(checkErr);
    }
  });
}

module.exports = { uploadSop, discardUpload };
