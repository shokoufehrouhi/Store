// Re-downloads products' photos from the brand's own site and saves them
// again with the current framing (utils/productFrame.js via
// compressImageFile). Until 2026-10-07 every import centre-cropped photos
// to a square, which cut the heads (and feet) off full-length model shots;
// the original image URLs were never stored, so the only fix is fetching
// the product page again.
//
// Per product: read the brand's image list from its product page, replace
// each stored photo in order with the fresh one (a new file and URL, so no
// browser or CDN keeps showing the old one), and move the old file to
// public/uploads/_reframe_backup/. Products whose page is gone or lists no
// images are skipped and left as they are; a product with more stored
// photos than the page now lists keeps the extra ones untouched.
//
// Usage (on the server, from backend/):
//   node scripts/reframeProductImages.js --brand Koton --limit 10          # dry run
//   node scripts/reframeProductImages.js --brand Koton --limit 10 --apply
//   node scripts/reframeProductImages.js --brand Koton --apply              # all of them
//   node scripts/reframeProductImages.js --brand Koton --ids 632,633 --apply
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const { compressImageFile } = require('../utils/compressImage');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const BACKUP_DIR = path.join(UPLOAD_DIR, '_reframe_backup');
const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept-Language': 'tr-TR,tr;q=0.9',
};
const MIN_IMAGE_BYTES = 5000;
const PAUSE_MS = 800; // between products, to stay polite to the brand's site

// The product page's image list, per brand. Koton's pages carry them in
// the schema.org JSON-LD "image" field (a bare string or an array).
async function ldJsonImages(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`page HTTP ${res.status}`);
  const html = await res.text();
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d.image) return [...new Set(Array.isArray(d.image) ? d.image : [d.image])];
    } catch { /* not this block */ }
  }
  return [];
}
const SOURCES = { Koton: ldJsonImages };

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

async function saveFresh(imageUrl) {
  const res = await fetch(imageUrl, { headers: UA });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_IMAGE_BYTES) throw new Error(`image too small (${buf.length} bytes)`);
  const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
  const file = path.join(UPLOAD_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(file, buf);
  const r = await compressImageFile(file);
  return '/uploads/' + path.basename(r.compressed && r.newPath ? r.newPath : file);
}

(async () => {
  const brand = arg('brand');
  const apply = process.argv.includes('--apply');
  const limit = arg('limit') ? Number(arg('limit')) : null;
  const ids = arg('ids') ? arg('ids').split(',').map(Number) : null;
  const source = SOURCES[brand];
  if (!source) throw new Error(`no image source for brand "${brand}" (have: ${Object.keys(SOURCES).join(', ')})`);
  if (apply) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const products = await prisma.products.findMany({
    where: { brand, product_link: { not: null }, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { id: 'asc' },
    ...(limit ? { take: limit } : {}),
    select: { id: true, product_link: true, product_media: { where: { type: 'image' }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }], select: { id: true, url: true } } },
  });
  console.log(`${brand}: ${products.length} product(s)${apply ? '' : ' — DRY RUN, nothing changes (add --apply)'}`);

  const totals = { products: 0, replaced: 0, skipped: 0, failed: 0 };
  for (const p of products) {
    try {
      const fresh = await source(p.product_link);
      if (!fresh.length) { totals.skipped++; console.log(`  ${p.id}: no images on the page, skipped`); continue; }
      const n = Math.min(fresh.length, p.product_media.length);
      if (!apply) { console.log(`  ${p.id}: would replace ${n} of ${p.product_media.length} photo(s) (page has ${fresh.length})`); totals.products++; continue; }
      let done = 0;
      for (let i = 0; i < n; i++) {
        const media = p.product_media[i];
        try {
          const url = await saveFresh(fresh[i]);
          await prisma.product_media.update({ where: { id: media.id }, data: { url } });
          const old = path.join(UPLOAD_DIR, path.basename(media.url));
          if (fs.existsSync(old)) fs.renameSync(old, path.join(BACKUP_DIR, path.basename(media.url)));
          done++;
        } catch (e) { totals.failed++; console.log(`  ${p.id}: photo ${i + 1} failed: ${e.message}`); }
      }
      totals.products++; totals.replaced += done;
      console.log(`  ${p.id}: replaced ${done}/${n}`);
    } catch (e) {
      totals.skipped++; console.log(`  ${p.id}: skipped (${e.message})`);
    }
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  console.log(JSON.stringify(totals));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
