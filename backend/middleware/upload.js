const path = require('path');
const fs   = require('fs');
const { compressImageFile } = require('../utils/compressImage');

const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

let multer;
try { multer = require('multer'); } catch { multer = null; }

// Limits
const IMAGE_INPUT_MAX  = 20 * 1024 * 1024;  // 20 MB — images are compressed server-side
const VIDEO_MAX        = 100 * 1024 * 1024; // 100 MB
const PDF_MAX          = 10 * 1024 * 1024;  // 10 MB
const RECEIPT_MAX      = 10 * 1024 * 1024;  // 10 MB (images + PDFs)

function makeStorage() {
  return multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      let ext = path.extname(file.originalname).toLowerCase();
      if (!ext) {
        const mimeExt = {
          'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
          'image/webp': '.webp', 'image/heic': '.heic',
          'application/pdf': '.pdf',
          'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
        };
        ext = mimeExt[file.mimetype] || '';
      }
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
}

// Per-file size limits: multer runs fileFilter before writing, but limits are enforced per-upload
// We use the highest possible limit in multer (100MB) and enforce per-type limits in fileFilter
function getUploadMiddleware() {
  if (!multer) return null;
  return multer({
    storage: makeStorage(),
    limits: { fileSize: VIDEO_MAX },
    fileFilter: (req, file, cb) => {
      const isImage = /^image\//i.test(file.mimetype) || /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp)$/i.test(file.originalname);
      const isVideo = /^video\//i.test(file.mimetype) || /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(file.originalname);
      if (!isImage && !isVideo) {
        return cb(Object.assign(new Error('invalid_file_type'), { code: 'INVALID_FILE_TYPE' }), false);
      }
      // Store type hint on req so the route can enforce per-type size after upload
      req._uploadIsImage = isImage;
      req._uploadIsVideo = isVideo;
      cb(null, true);
    },
  });
}

// Receipt upload — images and PDFs
function getReceiptUploadMiddleware() {
  if (!multer) return null;
  return multer({
    storage: makeStorage(),
    limits: { fileSize: RECEIPT_MAX },
  });
}

// Call this after multer saves the file to compress images and update req.file.
// Returns the final public URL path ('/uploads/filename').
async function compressUploadedImage(req) {
  if (!req.file) return null;
  const isImage = /^image\//i.test(req.file.mimetype) ||
                  /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp)$/i.test(req.file.originalname);
  if (!isImage) return '/uploads/' + req.file.filename;

  const result = await compressImageFile(req.file.path);
  if (result.compressed && result.newPath) {
    req.file.path     = result.newPath;
    req.file.filename = path.basename(result.newPath);
    req.file.size     = result.finalSize;
  }
  return '/uploads/' + req.file.filename;
}

module.exports = { getUploadMiddleware, getReceiptUploadMiddleware, compressUploadedImage, uploadDir };
module.exports.LIMITS = { IMAGE_INPUT_MAX, VIDEO_MAX, PDF_MAX, RECEIPT_MAX };
