const fs   = require('fs');
const path = require('path');

let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

// Output size for product images and JPEG quality
const CROP_SIZE    = 800;
const JPEG_QUALITY = 85;

// Resize + center-crop an image file in-place to CROP_SIZE × CROP_SIZE.
// Non-image files are left untouched.
// Returns { compressed: bool, originalSize, finalSize, newPath? }.
async function compressImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'];
  if (!imageExts.includes(ext)) return { compressed: false };
  if (!sharp) return { compressed: false };

  const originalSize = fs.statSync(filePath).size;

  try {
    // auto-orient from EXIF, then center-crop to CROP_SIZE × CROP_SIZE
    const pipeline = sharp(filePath)
      .rotate()
      .resize(CROP_SIZE, CROP_SIZE, { fit: 'cover', position: 'centre' });

    // Always output as JPEG (webp stays webp)
    const outputExt  = ext === '.webp' ? '.webp' : '.jpg';
    const outputPath = filePath.replace(/\.[^.]+$/, outputExt);

    if (ext === '.webp') {
      await pipeline.webp({ quality: JPEG_QUALITY }).toFile(outputPath + '.tmp');
    } else {
      await pipeline.jpeg({ quality: JPEG_QUALITY, progressive: true }).toFile(outputPath + '.tmp');
    }

    fs.renameSync(outputPath + '.tmp', outputPath);

    if (outputPath !== filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const finalSize = fs.statSync(outputPath).size;
    return { compressed: true, originalSize, finalSize, newPath: outputPath };
  } catch (err) {
    console.error('[compressImage] failed for', filePath, err.message);
    return { compressed: false };
  }
}

module.exports = { compressImageFile };
