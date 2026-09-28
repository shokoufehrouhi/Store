// Companion to backfillCompressUploads.js, for the extensions
// compressImageFile() renames to .jpg (everything except .jpg/.webp) --
// png/gif/heic/heif/bmp. A rename with no matching reference update leaves a
// dangling DB path (this already happened once: the jpg/jpeg/webp pass
// renamed 7 .jpeg files to .jpg without knowing to touch product_media, since
// at the time it looked like a same-extension, no-rename case).
//
// product_media.url isn't the only place a path gets cached -- products.
// published_data (a JSON snapshot of the live/public product) embeds its own
// copy of each image URL, found by grep across schema.prisma for every url/
// image/photo/avatar/logo/receipt column and confirmed live: several
// candidates (avatar, receipt/photo columns, sites.logo_url, card_photo_url)
// had zero real matches at the time this was written, but are kept here
// since new rows using them are only a matter of time.
//
// Run manually on the VPS:
//   node scripts/backfillCompressUploadsRenaming.js [--dry-run]
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const { compressImageFile } = require('../utils/compressImage');

const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
const TARGET_EXTS = new Set(['.png', '.gif', '.heic', '.heif', '.bmp']);
const DRY_RUN = process.argv.includes('--dry-run');

const VARCHAR_TARGETS = [
  ['product_media', 'url'],
  ['size_charts', 'image_url_fa'],
  ['size_charts', 'image_url_en'],
  ['size_charts', 'image_url_tr'],
  ['customers', 'avatar'],
  ['orders', 'payment_receipt_url'],
  ['order_returns', 'shipping_receipt_url'],
  ['order_returns', 'refund_receipt_url'],
  ['order_returns', 'defective_photo_url'],
  ['order_returns', 'rejection_photo_url'],
  ['customer_product_photos', 'photo_url'],
  ['suppliers', 'card_photo_url'],
  ['sites', 'logo_url'],
];

// oldName/newName are this script's own renamed-file basenames (e.g.
// "abc123.png" -> "abc123.jpg"), never user input, so the interpolated
// table/column identifiers above (fixed, hardcoded) are the only
// non-parameterized part of these queries.
async function patchReferences(oldName, newName) {
  let rows = 0;
  for (const [table, col] of VARCHAR_TARGETS) {
    rows += await prisma.$executeRawUnsafe(
      `UPDATE ${table} SET ${col} = replace(${col}, $1, $2) WHERE ${col} LIKE $3`,
      oldName, newName, `%${oldName}`
    );
  }
  rows += await prisma.$executeRawUnsafe(
    `UPDATE products SET published_data = regexp_replace(published_data::text, $1, $2)::jsonb WHERE published_data::text LIKE $3`,
    oldName, newName, `%${oldName}%`
  );
  return rows;
}

async function main() {
  const entries = fs.readdirSync(UPLOADS_DIR);
  let done = 0, failed = 0, dbRowsUpdated = 0, totalBefore = 0, totalAfter = 0;

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!TARGET_EXTS.has(ext)) continue;
    const filePath = path.join(UPLOADS_DIR, entry);

    if (DRY_RUN) { console.log(`[dry-run] would compress+rename ${entry}`); continue; }

    const before = fs.statSync(filePath).size;
    const result = await compressImageFile(filePath);
    if (!result.compressed) { failed++; console.error(`[backfill] skipped (compress failed): ${entry}`); continue; }

    done++; totalBefore += before; totalAfter += result.finalSize;

    const newName = path.basename(result.newPath);
    if (newName !== entry) {
      const rows = await patchReferences(entry, newName);
      dbRowsUpdated += rows;
      console.log(`${entry} -> ${newName} (${rows} db rows updated)`);
    }
  }

  console.log('--- summary ---');
  console.log({ done, failed, dbRowsUpdated, totalBefore, totalAfter, saved: totalBefore - totalAfter });
}

main().then(() => prisma.$disconnect()).catch(err => { console.error(err); process.exit(1); });
