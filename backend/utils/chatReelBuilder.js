// The "shopping assistant" reel (user's choice, 2026-10-17, from the
// prompt-motion.com "food craving launch film" prompt; only for the 20:00
// slot): a request is typed into a chat, a shopping bag tosses the
// products' photos, an orange flood brings in their cards, the strip lands
// on the biggest discount, it's added to the cart and the outro says how
// much off it is. ~16s, 1080x1920, no music like the other reels.
//
// The motion lives in chatReel/chatReel.html (rendered by htmlReel.js).
const path = require('path');
const { displayName } = require('./storyBuilder');
const { renderHtmlReel } = require('./htmlReel');
const { reelHook } = require('./reelBuilder');

const TEMPLATE = path.join(__dirname, 'chatReel', 'chatReel.html');
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');

// What the customer "types" (three lines, one per composer line) and the
// outro's first line, per reel group (utils/reelPlan.js).
const COPY = {
  women:     { lines: ['یه لباس زنانه می‌خوام،', 'شیک باشه برای پاییز،', 'و حتماً تخفیف داشته باشه'], out1: 'دنبال یه لباس شیک بودی.' },
  men:       { lines: ['یه لباس مردونه می‌خوام،', 'ساده و خوش‌دوخت باشه،', 'و حتماً تخفیف داشته باشه'], out1: 'دنبال یه استایل مردونه بودی.' },
  kids:      { lines: ['برای بچه‌م لباس می‌خوام،', 'راحت و خوشگل باشه،', 'و قیمتش هم خوب باشه'], out1: 'دنبال لباس بچگونه بودی.' },
  cosmetics: { lines: ['یه محصول آرایشی می‌خوام،', 'از یه برند خوب باشه،', 'و حتماً تخفیف داشته باشه'], out1: 'دنبال یه آرایشی خوب بودی.' },
  lifestyle: { lines: ['یه چیز برای خونه می‌خوام،', 'قشنگ و کاربردی باشه،', 'و حتماً تخفیف داشته باشه'], out1: 'دنبال یه چیز قشنگ برای خونه بودی.' },
  bagsShoes: { lines: ['یه کیف یا کفش می‌خوام،', 'که به همه‌چی بیاد،', 'و حتماً تخفیف داشته باشه'], out1: 'دنبال یه کیف یا کفش بودی.' },
};

const toFaDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const cutOf = (p) => Math.round((Number(p.price) - Number(p.discounted_price)) / Number(p.price) * 100);

// The three looks, taken in turn by day (user's choice, 2026-10-21, so the
// grid doesn't repeat): the cover (reelCover/cover.js) and the colours.
const LOOKS = [
  { cover: 'notif',    theme: { bg: '#FDF2F8', accent: '#BE185D' } },
  { cover: 'pricetag', theme: { bg: '#f5f5f2', accent: '#C2410C' } },
  { cover: 'question', theme: { bg: '#ECFDF5', accent: '#047857' } },
];

// The card list for the page: the biggest discount is the pick, placed so
// the strip slides across the others before landing on it. `look`: index
// into LOOKS; without one the reel opens as before (with the hook).
function reelData(products, groupKey, look) {
  const sorted = [...products].sort((a, b) => cutOf(b) - cutOf(a));
  const best = sorted[0];
  const rest = sorted.slice(1);
  const pick = products.length >= 4 ? products.length - 2 : products.length - 1;
  const ordered = [...rest.slice(0, pick), best, ...rest.slice(pick)];
  const copy = COPY[groupKey] || COPY.women;
  const pct = toFaDigits(cutOf(best));
  const cards = ordered.map((p) => ({
    brand: String(p.brand || 'Shilista'),
    name: displayName(p),
    price: Number(p.price),
    sale: Number(p.discounted_price),
    img: 'file://' + path.join(UPLOADS_DIR, path.basename(p.product_media[0].url)),
  }));
  const L = look == null ? null : LOOKS[look % LOOKS.length];
  return {
    products: cards,
    pick,
    lines: copy.lines,
    reply: `پیداش کردم! ${best.brand || 'Shilista'} با ${pct}٪ تخفیف.`,
    out1: copy.out1,
    out2: `حالا با ${pct}٪ تخفیف مال توئه.`,
    // Under the composer, where the request is typed.
    hook: reelHook(products, { top: 1250 }),
    ...(L && {
      theme: L.theme,
      cover: {
        layout: L.cover,
        pct,
        best: cards[pick],
        // the pick first, then the others
        photos: [cards[pick], ...cards.filter((_, i) => i !== pick)].map((c) => c.img),
        ask: copy.lines[0].replace(/[،,]\s*$/, ''),
      },
    }),
  };
}

// Builds the reel for `products` (3-5, discounted, with a photo on disk)
// and returns its /uploads/... path.
async function buildChatReel(products, { groupKey, prefix = 'reel-chat', look }) {
  const filename = `ig-${prefix}-${Date.now()}.mp4`;
  await renderHtmlReel(TEMPLATE, reelData(products, groupKey, look), path.join(UPLOADS_DIR, filename));
  return `/uploads/${filename}`;
}

module.exports = { buildChatReel, reelData, LOOKS };
