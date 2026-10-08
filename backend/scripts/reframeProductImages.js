// Re-downloads products' photos from the brand's own site and saves them
// again with the current framing (utils/productFrame.js via
// compressImageFile). Until 2026-10-07 every import centre-cropped photos
// to a square, which cut the heads (and feet) off full-length model shots;
// the original image URLs were never stored, so the only fix is fetching
// the product page again.
//
// Per product: read the brand's image list from its product page, replace
// each stored photo in order with the fresh one (a new file and URL, so no
// browser or CDN keeps showing the old one) in product_media AND in the
// published_data snapshot — production's public API serves the snapshot,
// so updating only product_media left it on the old URLs (2026-10-07). The
// old file stays where it is (a copy goes to public/uploads/_reframe_backup/)
// so nothing can point at a missing file; moving it away blanked those
// products' photos on production. Products whose page is gone or lists no
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

// The product page's image list, per brand. Koton's (and Colin's) pages carry them in
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
// Mavi's photos sit on its image CDN as <product code>_image_<n>.jpg (the
// same files its API's galleryImagesNew lists, in the same order), and the
// CDN answers plain HTTP — unlike the site and API behind Cloudflare — so
// they're listed by trying n = 1, 2, … until one is missing.
const MAVI_MAX_IMAGES = 15;
async function maviCdnImages(url) {
  const code = url.match(/\/p\/([^/?#]+)/)?.[1];
  if (!code) throw new Error('no Mavi product code in the link');
  const images = [];
  for (let n = 1; n <= MAVI_MAX_IMAGES; n++) {
    const img = `https://sky-static.mavi.com/mnresize/1005/1425/${code}_image_${n}.jpg`;
    const res = await fetch(img, { method: 'HEAD', headers: UA });
    if (!res.ok) break;
    images.push(img);
  }
  return images;
}
// Colin's, Defacto's and LC Waikiki's product pages list their photos in
// JSON-LD too, in the same order as stored (checked 2026-10-07).

// ArmaLife and PaulMark (both on Farktor): the photos come from the
// company's catalog JSON, as at import — the colour the stored link points
// at first (its full set), then two photos of each other colour in stock.
// The import picked "the" colour by stock, which can differ today, so the
// link's own colour is used to keep the order the stored photos have.
function farktorSource(fetchCatalog, imageBase) {
  let byId = null;
  return async (url) => {
    const imp = require('../utils/siteImport');
    if (!byId) {
      byId = new Map();
      for (const g of imp.groupArmaLifeCatalog(await fetchCatalog())) for (const id of g.ids) byId.set(id, g);
    }
    const linkId = imp.armalifeLinkId(url);
    const group = linkId && byId.get(linkId);
    if (!group) return []; // no longer in the catalog: left as it is
    const own = group.members.find(c => imp.armalifeIds(c).has(linkId)) || group.rep;
    const photosOf = c => String(c.photoAll || c.photo || '').split('||').map(p => p.trim()).filter(Boolean);
    const list = [...photosOf(own)];
    for (const c of group.members) {
      if (c === own || !imp.armalifeSizes(c).some(sz => sz.qty > 0)) continue;
      list.push(...photosOf(c).slice(0, 2));
    }
    return [...new Set(list)].slice(0, imp.ARMALIFE_MAX_GALLERY_IMAGES).map(ph => imageBase + ph);
  };
}

// Zara's product page builds its JSON-LD in the browser (plain HTTP gets
// a shell without it), so it's read with the importer's own scraper in a
// headless Chrome — the same ProductGroup "image" list the import stored.
async function zaraImages(url, { pm }) {
  const data = await require('../utils/siteImport').scrapeZaraProduct(pm, url);
  return data?.images || [];
}
const NEEDS_BROWSER = new Set(['Zara', 'Bershka', 'PullAndBear', 'Stradivarius', 'Lefties']);

// Mango: photos from its product API, one colour at a time. Which colour
// the import put first depended on that day's discounts and stock, so the
// colour whose first photo looks most like the stored first photo is used
// (a small greyscale thumbnail compared pixel by pixel), and only that
// colour's photos (the first 8, as the import took) are returned.
const sharp = require('sharp');
// Square from the centre, as the old import cropped, in colour: the stored
// photo IS that crop of the right colour's first photo, so it matches it
// almost exactly. A greyscale thumbnail stretched to a square (until
// 2026-10-08) mostly compared layout, and grey, beige and olive came out
// alike — Stradivarius, Pull&Bear and Mango products got another colour's
// photos.
async function thumb(buf) {
  return sharp(buf).resize(16, 16, { fit: 'cover' }).removeAlpha().raw().toBuffer();
}
// Of several colours' photo lists, the one whose first photo looks most
// like the stored first photo. `refs` are candidate files for that stored
// photo (the current one, or old ones from the backup — see --refs); the
// closest pair wins.
async function closestColour(lists, refs, previewUrl) {
  const files = (Array.isArray(refs) ? refs : [refs]).filter(f => f && fs.existsSync(f));
  if (lists.length < 2 || !files.length) return lists[0];
  const refThumbs = [];
  for (const f of files) { try { refThumbs.push(await thumb(f)); } catch { /* unreadable */ } }
  if (!refThumbs.length) return lists[0];
  let best = lists[0], bestDiff = Infinity;
  for (const list of lists) {
    const r = await fetch(previewUrl(list[0]), { headers: UA });
    if (!r.ok) continue;
    let t;
    try { t = await thumb(Buffer.from(await r.arrayBuffer())); } catch { continue; }
    for (const ref of refThumbs) {
      let d = 0; for (let i = 0; i < t.length; i++) d += Math.abs(t[i] - ref[i]);
      if (d < bestDiff) { bestDiff = d; best = list; }
    }
  }
  if (process.env.REFRAME_DEBUG) console.log(`    colour ${lists.indexOf(best) + 1}/${lists.length}, diff ${Math.round(bestDiff / (16 * 16 * 3))}`);
  return best;
}

async function mangoImages(url, { storedFirstFile }) {
  const imp = require('../utils/siteImport');
  const id = imp.mangoLinkProductId(url);
  if (!id) return [];
  const detail = await imp.mangoProduct(id);
  const colors = (detail.colors || []).map(c => imp.mangoColorImages(c).slice(0, 8)).filter(l => l.length);
  if (!colors.length) return [];
  const best = await closestColour(colors, storedFirstFile, (img) => `${imp.MANGO_MEDIA}${img}?wid=300`);
  return best.map(img => `${imp.MANGO_MEDIA}${img}?wid=1200`);
}

// Bershka, Pull&Bear, Stradivarius, Lefties (Inditex): the store's own API, called
// from inside its homepage in the browser (Akamai blocks it otherwise) —
// the importer's opener and reader. The link carries the category and
// product ids ("…-c<category>p<product>.html"); the colour is matched by
// photo as for Mango, and its first 8 photos returned, as the import took.
function inditexSource(open, apiArgs) {
  let page = null;
  return async (url, { pm, storedFirstFile }) => {
    const imp = require('../utils/siteImport');
    const m = String(url).match(/-c(\d+)p(\d+)\.html/);
    if (!m) return [];
    if (!page) page = (await open(pm)).page;
    const [product] = await imp.readLeftiesProducts(page, Number(m[1]), [Number(m[2])], apiArgs());
    const colors = (product?.colors || []).map(c => (c.images || []).slice(0, 8)).filter(l => l.length);
    if (!colors.length) return [];
    return closestColour(colors, storedFirstFile, (u) => u);
  };
}

const imp0 = require('../utils/siteImport');
const SOURCES = {
  Koton: ldJsonImages, Mavi: maviCdnImages, Colins: ldJsonImages, Defacto: ldJsonImages, LCWaikiki: ldJsonImages,
  // Barrels and Oil's page lists the stored colour's photos (the import
  // added other colours after them; those extra photos stay as they are).
  BarrelsAndOil: ldJsonImages,
  ArmaLife: farktorSource(() => imp0.fetchArmaLifeCatalog(), imp0.ARMALIFE_IMAGE_BASE),
  PaulMark: farktorSource(() => imp0.fetchPaulMarkCatalog(), imp0.PAULMARK_IMAGE_BASE),
  Zara: zaraImages,
  Mango: mangoImages,
  Bershka: inditexSource((pm) => imp0.openBershka(pm), () => imp0.bershkaApiArgs()),
  PullAndBear: inditexSource((pm) => imp0.openPullAndBear(pm), () => imp0.pullAndBearApiArgs()),
  Stradivarius: inditexSource((pm) => imp0.openStradivarius(pm), () => imp0.stradivariusApiArgs()),
  // Lefties: the same Inditex API, opened the way its importer does.
  Lefties: inditexSource((pm) => imp0.fetchLeftiesListingMeta(pm), () => imp0.leftiesApiArgs()),
};

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

async function main(ctx) {
  const brand = arg('brand');
  const apply = process.argv.includes('--apply');
  const limit = arg('limit') ? Number(arg('limit')) : null;
  const ids = arg('ids') ? arg('ids').split(',').map(Number) : null;
  const source = SOURCES[brand];
  const refs = arg('refs') ? JSON.parse(fs.readFileSync(arg('refs'), 'utf8')) : {};
  if (!source) throw new Error(`no image source for brand "${brand}" (have: ${Object.keys(SOURCES).join(', ')})`);
  if (apply) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const products = await prisma.products.findMany({
    where: { brand, product_link: { not: null }, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { id: 'asc' },
    ...(limit ? { take: limit } : {}),
    select: { id: true, product_link: true, published_data: true, product_media: { where: { type: 'image' }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }], select: { id: true, url: true } } },
  });
  console.log(`${brand}: ${products.length} product(s)${apply ? '' : ' — DRY RUN, nothing changes (add --apply)'}`);

  const totals = { products: 0, replaced: 0, skipped: 0, failed: 0 };
  for (const p of products) {
    try {
      const firstStored = p.product_media[0] && path.join(UPLOAD_DIR, path.basename(p.product_media[0].url));
      // --refs: candidate original first photos for products already
      // reframed once (their current first photo may be the wrong colour).
      const fresh = await source(p.product_link, { ...ctx, storedFirstFile: refs[p.id] || firstStored });
      if (!fresh.length) { totals.skipped++; console.log(`  ${p.id}: no images on the page, skipped`); continue; }
      const n = Math.min(fresh.length, p.product_media.length);
      if (!apply) { console.log(`  ${p.id}: would replace ${n} of ${p.product_media.length} photo(s) (page has ${fresh.length})`); totals.products++; continue; }
      let done = 0;
      const swapped = new Map(); // old url -> new url
      for (let i = 0; i < n; i++) {
        const media = p.product_media[i];
        try {
          const url = await saveFresh(fresh[i]);
          await prisma.product_media.update({ where: { id: media.id }, data: { url } });
          const old = path.join(UPLOAD_DIR, path.basename(media.url));
          if (fs.existsSync(old)) fs.copyFileSync(old, path.join(BACKUP_DIR, path.basename(media.url)));
          swapped.set(media.url, url);
          done++;
        } catch (e) { totals.failed++; console.log(`  ${p.id}: photo ${i + 1} failed: ${e.message}`); }
      }
      const snap = p.published_data;
      if (swapped.size && snap && Array.isArray(snap.product_media)) {
        const media = snap.product_media.map(m => (swapped.has(m.url) ? { ...m, url: swapped.get(m.url) } : m));
        await prisma.products.update({ where: { id: p.id }, data: { published_data: { ...snap, product_media: media } } });
      }
      totals.products++; totals.replaced += done;
      console.log(`  ${p.id}: replaced ${done}/${n}`);
    } catch (e) {
      totals.skipped++; console.log(`  ${p.id}: skipped (${e.message})`);
    }
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  console.log(JSON.stringify(totals));
}

(async () => {
  if (NEEDS_BROWSER.has(arg('brand'))) {
    const { withBrowser } = require('../utils/siteSync');
    await withBrowser((pm) => main({ pm }));
  } else {
    await main({});
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
