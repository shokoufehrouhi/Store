// After reframeProductImages.js replaced photos (new files, new URLs), the
// public API on production kept serving the old URLs: it reads each
// product's published_data snapshot, not product_media, and the reframe
// script only updated product_media — and had moved the old files away, so
// those products showed no photos (2026-10-07; the old files were copied
// back from _reframe_backup as the immediate fix).
//
// This points each snapshot's product_media at the reframed files: an entry
// whose file was reframed (it's in uploads/_reframe_backup) gets the URL now
// at the same position in product_media. Nothing else in the snapshot
// changes, so an admin's unpublished edits stay unpublished.
//
// Usage (on the server, from backend/):
//   node scripts/syncPublishedMedia.js           # dry run
//   node scripts/syncPublishedMedia.js --apply
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

const BACKUP_DIR = path.join(__dirname, '../public/uploads/_reframe_backup');

(async () => {
  const apply = process.argv.includes('--apply');
  const reframed = new Set(fs.readdirSync(BACKUP_DIR));
  const products = await prisma.products.findMany({
    where: { published_data: { not: null } },
    select: { id: true, published_data: true, product_media: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }], select: { type: true, url: true, sort_order: true } } },
  });

  let changedProducts = 0, changedPhotos = 0, mismatched = 0;
  for (const p of products) {
    const snap = p.published_data;
    const media = Array.isArray(snap.product_media) ? snap.product_media : [];
    if (!media.some(m => reframed.has(path.basename(m.url || '')))) continue;
    const current = p.product_media;
    let n = 0;
    const next = media.map((m, i) => {
      if (!reframed.has(path.basename(m.url || ''))) return m;
      const now = current[i];
      if (!now || now.url === m.url) { mismatched++; return m; }
      n++;
      return { ...m, url: now.url };
    });
    if (!n) continue;
    changedProducts++; changedPhotos += n;
    if (apply) await prisma.products.update({ where: { id: p.id }, data: { published_data: { ...snap, product_media: next } } });
  }
  console.log(JSON.stringify({ apply, changedProducts, changedPhotos, leftAsIs: mismatched }));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
