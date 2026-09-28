// One-off backfill: every jpg/jpeg/webp in backend/public/uploads predates
// compressImage.js actually working here (sharp silently failed to load on
// the VPS's Node 18 until it was pinned to 0.34.4 — see the "Pin sharp to
// 0.34.4" commit), so they were saved at full scrape/upload resolution
// instead of the intended 800x800/quality-85. This filled the VPS disk to
// 100% and took the site down. Run manually on the VPS:
//   node scripts/backfillCompressUploads.js [--dry-run]
//
// png/gif/heic/bmp are deliberately NOT included here — compressImageFile()
// renames those to .jpg, which requires updating product_media.url (and any
// other table storing the old path) in the same pass; that's a separate
// script so a DB failure never leaves an orphaned/renamed file behind.
const fs = require('fs');
const path = require('path');
const { compressImageFile } = require('../utils/compressImage');

const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
const TARGET_EXTS = new Set(['.jpg', '.jpeg', '.webp']);
const DRY_RUN = process.argv.includes('--dry-run');

// sharp() call just for metadata is cheap relative to a full re-encode —
// worth it to make this script safe to re-run without re-compressing
// (and re-lossying) files a previous run (or the 25-file pilot batch)
// already brought down to size.
async function alreadyCompressed(filePath) {
  let sharp;
  try { sharp = require('sharp'); } catch { return false; }
  try {
    const meta = await sharp(filePath).metadata();
    return meta.width === 800 && meta.height === 800;
  } catch {
    return false;
  }
}

async function main() {
  const entries = fs.readdirSync(UPLOADS_DIR);
  let done = 0, skipped = 0, failed = 0, totalBefore = 0, totalAfter = 0;

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!TARGET_EXTS.has(ext)) continue;
    const filePath = path.join(UPLOADS_DIR, entry);

    if (await alreadyCompressed(filePath)) { skipped++; continue; }

    const before = fs.statSync(filePath).size;
    if (DRY_RUN) {
      console.log(`[dry-run] would compress ${entry} (${before} bytes)`);
      continue;
    }

    const result = await compressImageFile(filePath);
    if (result.compressed) {
      done++; totalBefore += before; totalAfter += result.finalSize;
    } else {
      failed++;
      console.error(`[backfill] skipped (compress failed): ${entry}`);
    }
  }

  console.log('--- summary ---');
  console.log({ done, skipped, failed, totalBefore, totalAfter, saved: totalBefore - totalAfter });
}

main().catch(err => { console.error(err); process.exit(1); });
