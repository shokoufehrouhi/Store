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
const toFaDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

// The three looks, taken in turn by day (user's choice, 2026-10-21, so the
// grid doesn't repeat): the cover (reelCover/cover.js) and the colours.
const LOOKS = [
  { cover: 'mosaic',    theme: { bg: '#ffffff', accent: '#C2410C' } },
  { cover: 'brandwall', theme: { bg: '#F4EDE3', accent: '#9F1239' } },
  { cover: 'hero',      theme: { bg: '#EEF2F7', accent: '#1D4ED8' } },
];

// `look`: index into LOOKS; without one the reel opens as before (with the hook).
function reelData(products, look) {
  const brands = [...new Set(products.map((p) => brandName(p.brand)).filter(Boolean))];
  const photos = products.map((p) => 'file://' + path.join(UPLOADS_DIR, path.basename(p.product_media[0].url)));
  const cuts = products.map(cutOf);
  const maxPct = Math.max(...cuts);
  const L = look == null ? null : LOOKS[look % LOOKS.length];
  return {
    photos,
    maxPct,
    brands: Array.from({ length: BRAND_FLIPS }, (_, i) => brands[i % brands.length]),
    hook: reelHook(products),
    ...(L && {
      theme: L.theme,
      cover: { layout: L.cover, photos, pct: toFaDigits(maxPct), brands, hero: cuts.indexOf(maxPct) },
    }),
  };
}

// Builds the reel for `products` (discounted, with a photo on disk, up to
// 11 — the page repeats photos when there are fewer) and returns its
// /uploads/... path.
async function buildBrandReel(products, { prefix = 'reel-brand', look } = {}) {
  const filename = `ig-${prefix}-${Date.now()}.mp4`;
  await renderHtmlReel(TEMPLATE, reelData(products, look), path.join(UPLOADS_DIR, filename));
  return `/uploads/${filename}`;
}

module.exports = { buildBrandReel, reelData, LOOKS };
