// The brand ad reel (user's choice, 2026-10-17, from the prompt-motion.com
// "engraving-style ad" prompt; only for the 11:00 slot): the site's hero
// line, the brand names flipping with small photos popping around them, one
// photo big with a hand-drawn circle, columns, a 3x4 grid with "up to X%
// off", the site's own three promises (kifiyat-e asl, zemanat-e esalat,
// ersal-e sari, all from i18n.js) and the logo. ~14s, no music.
//
// The motion lives in brandReel/brandReel.html (rendered by htmlReel.js).
const path = require('path');
const { renderHtmlReel } = require('./htmlReel');
const { reelHook } = require('./reelBuilder');

const TEMPLATE = path.join(__dirname, 'brandReel', 'brandReel.html');
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
// The page flips through this many names (repeated when there are fewer brands).
const BRAND_FLIPS = 10;

// How the brands are written on screen (the sites table keys them in CamelCase).
const BRAND_NAMES = {
  LCWaikiki: 'LC WAIKIKI', PullAndBear: 'PULL&BEAR', KikoMilano: 'KIKO MILANO', BarrelsAndOil: 'BARRELS AND OIL',
  PaulMark: 'PAUL MARK', MadameCoco: 'MADAME COCO', ArmaLife: 'ARMALIFE', MClub: 'MCLUB', Defacto: 'DEFACTO', DeFacto: 'DEFACTO',
};
const brandName = (b) => BRAND_NAMES[b] || String(b || '').toUpperCase();
const cutOf = (p) => Math.round((Number(p.price) - Number(p.discounted_price)) / Number(p.price) * 100);

function reelData(products) {
  const brands = [...new Set(products.map((p) => brandName(p.brand)).filter(Boolean))];
  return {
    photos: products.map((p) => 'file://' + path.join(UPLOADS_DIR, path.basename(p.product_media[0].url))),
    maxPct: Math.max(...products.map(cutOf)),
    brands: Array.from({ length: BRAND_FLIPS }, (_, i) => brands[i % brands.length]),
    hook: reelHook(products),
  };
}

// Builds the reel for `products` (discounted, with a photo on disk, up to
// 11 — the page repeats photos when there are fewer) and returns its
// /uploads/... path.
async function buildBrandReel(products, { prefix = 'reel-brand' } = {}) {
  const filename = `ig-${prefix}-${Date.now()}.mp4`;
  await renderHtmlReel(TEMPLATE, reelData(products), path.join(UPLOADS_DIR, filename));
  return `/uploads/${filename}`;
}

module.exports = { buildBrandReel, reelData };
