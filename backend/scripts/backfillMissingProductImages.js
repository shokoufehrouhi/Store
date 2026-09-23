// One-off: three scrapers in siteImport.js (LCWaikiki, Koton, KikoMilano)
// read product images from JSON-LD's "image" field via
// `[...new Set(prod.image || [])]` — schema.org allows that field to be
// either a URL string or an array of them, and when it was a bare string
// (confirmed live on Kiko's own "LIPS & NAILS COMBO- APRICOT NUDE SET",
// SHIL00000848) a Set spread it character-by-character instead of treating
// it as one URL, so every image download failed silently (caught per-image)
// and the product landed with zero product_media rows. Fixed going forward
// in siteImport.js (commit 071f9b9) — this backfills products already
// imported before that fix by re-visiting their own product_link and
// re-extracting JSON-LD image the correct way. Generic across all three
// sites since they all serve the same schema.org Product JSON-LD shape.
// Run manually once: node scripts/backfillMissingProductImages.js
const prisma = require('../prisma/client');
const puppeteer = require('puppeteer');
const { saveImageFromUrl } = require('../utils/siteImport');

(async () => {
  const candidates = await prisma.products.findMany({
    where: {
      product_link: { not: null },
      product_media: { none: {} },
    },
    select: { id: true, name_tr: true, product_link: true },
  });
  if (!candidates.length) { console.log('nothing to backfill'); return; }
  console.log(`${candidates.length} zero-image product(s) with a product_link to re-check`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  let fixed = 0, stillEmpty = 0, failed = 0;
  for (const p of candidates) {
    try {
      await page.goto(p.product_link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1200));
      const images = await page.evaluate(() => {
        const ldBlocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
          .filter(Boolean);
        const prod = ldBlocks.find(d => d['@type'] === 'Product');
        if (!prod) return [];
        return [...new Set(Array.isArray(prod.image) ? prod.image : (prod.image ? [prod.image] : []))];
      });
      if (!images.length) {
        console.log(`#${p.id} still no image on the live page: ${p.name_tr}`);
        stillEmpty++;
        continue;
      }

      const mediaUrls = [];
      for (const imgUrl of images) {
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip a broken image, keep the rest */ }
      }
      if (!mediaUrls.length) {
        console.log(`#${p.id} found ${images.length} image url(s) but every download failed: ${p.name_tr}`);
        stillEmpty++;
        continue;
      }

      await prisma.product_media.createMany({
        data: mediaUrls.map((u, i) => ({ product_id: p.id, type: 'image', url: u, sort_order: i })),
      });
      console.log(`#${p.id} backfilled ${mediaUrls.length} image(s): ${p.name_tr}`);
      fixed++;
    } catch (err) {
      console.log(`#${p.id} failed: ${err.message}`);
      failed++;
    }
  }

  await browser.close();
  console.log(`done: ${fixed} product(s) backfilled, ${stillEmpty} still had no usable image, ${failed} failed to load`);
})();
