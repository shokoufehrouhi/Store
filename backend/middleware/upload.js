const path = require('path');
const fs   = require('fs');

const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

let multer;
try { multer = require('multer'); } catch { multer = null; }

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

// General media upload (product images + videos)
function getUploadMiddleware() {
  if (!multer) return null;
  return multer({
    storage: makeStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const okMime = /^(image|video)\//i.test(file.mimetype);
      const okExt  = /\.(jpg|jpeg|png|gif|webp|heic|heif|mp4|webm|mov|avi|mkv|m4v)$/i.test(file.originalname);
      if (!okMime && !okExt) {
        return cb(Object.assign(new Error('invalid_file_type'), { code: 'INVALID_FILE_TYPE' }), false);
      }
      cb(null, true);
    },
  });
}

// Receipt upload — no fileFilter, validation done in controller
function getReceiptUploadMiddleware() {
  if (!multer) return null;
  return multer({
    storage: makeStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });
}

module.exports = { getUploadMiddleware, getReceiptUploadMiddleware, uploadDir };
