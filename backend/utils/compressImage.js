const fs   = require('fs');
const path = require('path');

let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

// Max dimension and quality for compressed images
const MAX_DIMENSION = 1280;
const JPEG_QUALITY  = 82;

// Compress an image file in-place. Non-image files are left untouched.
// Returns { compressed: bool, originalSize, finalSize }.
async function compressImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'];
  if (!imageExts.includes(ext)) return { compressed: false };
  if (!sharp) return { compressed: false };

  const originalSize = fs.statSync(filePath).size;

  try {
    const img      = sharp(filePath).rotate(); // .rotate() auto-applies EXIF orientation
    const meta     = await img.metadata();
    const needsResize = (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION);

    let pipeline = img;
    if (needsResize) {
      pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
    }

    // Convert everything to JPEG for maximum compression (except webp → keep as webp)
    const outputExt  = ext === '.webp' ? '.webp' : '.jpg';
    const outputPath = filePath.replace(/\.[^.]+$/, outputExt);

    if (ext === '.webp') {
      await pipeline.webp({ quality: JPEG_QUALITY }).toFile(outputPath + '.tmp');
    } else {
      await pipeline.jpeg({ quality: JPEG_QUALITY, progressive: true }).toFile(outputPath + '.tmp');
    }

    // Rename temp → final (atomic swap)
    fs.renameSync(outputPath + '.tmp', outputPath);

    // If extension changed (e.g. .png → .jpg), delete the original
    if (outputPath !== filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const finalSize = fs.statSync(outputPath).size;
    return { compressed: true, originalSize, finalSize, newPath: outputPath };
  } catch (err) {
    // If compression fails, keep the original untouched
    console.error('[compressImage] failed for', filePath, err.message);
    return { compressed: false };
  }
}

module.exports = { compressImageFile };
