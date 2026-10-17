// Accepts one training-material file in the multipart field "file" (FR7).
//
//   router.post('/', uploadMaterial, handler)   →  req.file (or undefined)
//
// Three checks, cheapest first:
//   1. extension must be pdf, docx, pptx or mp4 (before anything is written)
//   2. size limit MATERIAL_MAX_MB (multer stops reading and deletes the part)
//   3. the first bytes of the saved file must match the extension, so a
//      renamed .exe cannot pass as a .pdf
//
// The file is saved straight to uploads/materials/ under a random name, so a
// 100 MB video never sits in memory. If the request fails later, the route
// calls discardUpload(req) so no orphan file is left behind.
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const HttpError = require('../utils/httpError');
const materialFiles = require('../services/materialFiles');

const ALLOWED_LIST = 'PDF, DOCX, PPTX or MP4';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      materialFiles.ensureDir();
      cb(null, materialFiles.MATERIALS_DIR);
    },
    filename: (req, file, cb) => {
      cb(null, `${crypto.randomUUID()}.${materialFiles.allowedExtension(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: config.materials.maxMb * 1024 * 1024,
    files: 1,
    fields: 10,
    fieldSize: 16 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!materialFiles.allowedExtension(file.originalname)) {
      return cb(new HttpError(400, 'FILE_TYPE_NOT_ALLOWED', `Only ${ALLOWED_LIST} files can be uploaded.`));
    }
    return cb(null, true);
  },
}).single('file');

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new HttpError(413, 'FILE_TOO_LARGE', `The file is larger than the ${config.materials.maxMb} MB limit.`);
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      return new HttpError(400, 'VALIDATION', 'Send one file, in the field named "file".');
    }
    return new HttpError(400, 'VALIDATION', 'The upload could not be read. Please try again.');
  }
  return err;
}

function uploadMaterial(req, res, next) {
  upload(req, res, async (err) => {
    if (err) return next(toHttpError(err));
    if (!req.file) return next();

    try {
      const ext = materialFiles.allowedExtension(req.file.originalname);
      if (!(await materialFiles.hasValidSignature(req.file.path, ext))) {
        await discardUpload(req);
        return next(new HttpError(400, 'FILE_CONTENT_MISMATCH',
          `This file is not a real ${ext.toUpperCase()} file. Check the file and try again.`));
      }
      req.file.ext = ext;
      // Kept with the generated name, ready to store in courses.material_url
      req.file.materialUrl = materialFiles.toMaterialUrl(req.file.filename);
      return next();
    } catch (checkErr) {
      await discardUpload(req);
      return next(checkErr);
    }
  });
}

// Removes the uploaded file when the request did not succeed.
async function discardUpload(req) {
  if (req.file?.path) await materialFiles.removePath(req.file.path);
}

module.exports = { uploadMaterial, discardUpload };
