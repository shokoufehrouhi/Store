// Builds the daily Instagram Story images (1080x1920) for Shilista's
// auto-post pipeline: a single-product story and a 2-4 product collage,
// each called with its own headline at different times of day.
// Text is rendered via sharp's Pango-backed text input (not hand-rolled SVG
// <text> — SVG's text-anchor for RTL scripts behaves inconsistently across
// renderers; Pango gives correct shaping, joining and automatic word-wrap
// for Farsi out of the box) — see the "font_test" exploration this was
// validated against before writing this file.
const sharp = require('sharp');
const path = require('path');

const FONT_BLACK  = path.join(__dirname, '../assets/fonts/Vazirmatn-Black.ttf');
const FONT_BOLD   = path.join(__dirname, '../assets/fonts/Vazirmatn-Bold.ttf');
const FONT_MEDIUM = path.join(__dirname, '../assets/fonts/Vazirmatn-Medium.ttf');
const LOGO_PATH   = path.join(__dirname, '../../frontend/images/shilista_logo.png');
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');

const W = 1080, H = 1920;
const BG_DARK = '#0d0d0d';
const GOLD    = '#D4AF37';
const ORANGE  = '#FF5C00';
const SITE_LINK_TEXT = 'shilista.com';
// Every story (single-product or collage) ends with the same caption card,
// CTA and link -- fixed by design, not passed in per-call.
const STANDARD_CAPTION = 'همین الان محصولات ما رو ببین';

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function renderText({ text, fontFile, fontFamily, width, height, color, align = 'center' }) {
  return sharp({
    text: {
      text: `<span foreground="${color}">${escapeXml(text)}</span>`,
      font: fontFamily,
      fontfile: fontFile,
      width, height, align,
      rgba: true,
    },
  }).png().toBuffer();
}

async function solidBackground() {
  return sharp({
    create: { width: W, height: H, channels: 4, background: BG_DARK },
  }).png().toBuffer();
}

// Rounded-corner card with a thin white border frame, optionally rotated —
// used for both the single hero photo and the collage cards.
async function photoCard(imagePath, { size, height = size, radius = 28, rotateDeg = 0 }) {
  const img = await sharp(imagePath).resize(size, height, { fit: 'cover', position: 'top' }).toBuffer();
  const mask = Buffer.from(
    `<svg width="${size}" height="${height}"><rect width="${size}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
  );
  const rounded = await sharp(img)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const border = Buffer.from(
    `<svg width="${size}" height="${height}">
       <rect x="2" y="2" width="${size - 4}" height="${height - 4}" rx="${radius}" ry="${radius}"
             fill="none" stroke="#ffffff" stroke-width="6"/>
     </svg>`
  );
  const withBorder = await sharp(rounded).composite([{ input: border }]).png().toBuffer();

  if (!rotateDeg) return { buffer: withBorder, width: size, height };
  const rotated = await sharp(withBorder)
    .rotate(rotateDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const meta = await sharp(rotated).metadata();
  return { buffer: rotated, width: meta.width, height: meta.height };
}

function productImagePath(product) {
  const media = (product.product_media || [])[0];
  if (!media) return null;
  return path.join(UPLOADS_DIR, path.basename(media.url));
}

function shortenName(name, max = 60) {
  if (!name) return '';
  return name.length > max ? name.slice(0, max - 1).trimEnd() + '…' : name;
}

// Story 1: a single product — logo, promo headline, hero photo, short name,
// the standard caption card, CTA and site link.
async function buildSingleProductStory(product, { headline }) {
  const layers = [{ input: await solidBackground() }];

  const logo = await sharp(LOGO_PATH).resize({ width: 300 }).toBuffer();
  const logoMeta = await sharp(logo).metadata();
  layers.push({ input: logo, left: Math.round((W - logoMeta.width) / 2), top: 70 });

  const headlineBuf = await renderText({
    text: headline, fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black',
    width: 960, height: 150, color: GOLD,
  });
  const headlineMeta = await sharp(headlineBuf).metadata();
  layers.push({ input: headlineBuf, left: Math.round((W - headlineMeta.width) / 2), top: 200 });

  const imgPath = productImagePath(product);
  if (imgPath) {
    const card = await photoCard(imgPath, { size: 700 });
    layers.push({ input: card.buffer, left: Math.round((W - card.width) / 2), top: 380 });
  }

  const nameBuf = await renderText({
    text: shortenName(product.name_fa, 70),
    fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 920, height: 140, color: '#ffffff',
  });
  const nameMeta = await sharp(nameBuf).metadata();
  layers.push({ input: nameBuf, left: Math.round((W - nameMeta.width) / 2), top: 1110 });

  const caption = await buildCaptionCard(STANDARD_CAPTION);
  const captionTop = 1280;
  layers.push({ input: caption.buffer, left: Math.round((W - caption.width) / 2), top: captionTop });

  const cta = await buildCtaBadge('شروع خرید');
  const ctaTop = captionTop + caption.height + 30;
  layers.push({ input: cta.buffer, left: Math.round((W - cta.width) / 2), top: ctaTop });

  const linkBuf = await renderText({
    text: SITE_LINK_TEXT, fontFile: FONT_MEDIUM, fontFamily: 'Vazirmatn Medium',
    width: 600, height: 80, color: GOLD,
  });
  const linkMeta = await sharp(linkBuf).metadata();
  layers.push({ input: linkBuf, left: Math.round((W - linkMeta.width) / 2), top: ctaTop + cta.height + 30 });

  return sharp({ create: { width: W, height: H, channels: 4, background: BG_DARK } })
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function buildCtaBadge(text = 'مشاهده و خرید') {
  const padX = 60, textH = 90;
  const textBuf = await renderText({
    text, fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 500, height: textH, color: '#ffffff',
  });
  const textMeta = await sharp(textBuf).metadata();
  const boxW = textMeta.width + padX * 2, boxH = 110;
  const box = Buffer.from(
    `<svg width="${boxW}" height="${boxH}"><rect width="${boxW}" height="${boxH}" rx="${boxH / 2}" fill="${ORANGE}"/></svg>`
  );
  const buffer = await sharp(box)
    .composite([{ input: textBuf, left: Math.round((boxW - textMeta.width) / 2), top: Math.round((boxH - textH) / 2) }])
    .png()
    .toBuffer();
  return { buffer, width: boxW, height: boxH };
}

// Rounded card holding the subline text, framed in gold — replaces the old
// bare centered text so the promo line reads as one deliberate element
// sitting under the product grid, not a second disconnected headline.
async function buildCaptionCard(text, { textH = 160 } = {}) {
  const textW = 860, padX = 50, padY = 30;
  const textBuf = await renderText({
    text, fontFile: FONT_MEDIUM, fontFamily: 'Vazirmatn Medium',
    width: textW, height: textH, color: '#ffffff',
  });
  const boxW = textW + padX * 2, boxH = textH + padY * 2;
  const box = Buffer.from(
    `<svg width="${boxW}" height="${boxH}">
       <rect x="1.5" y="1.5" width="${boxW - 3}" height="${boxH - 3}" rx="22" ry="22"
             fill="#161616" stroke="${GOLD}" stroke-width="3"/>
     </svg>`
  );
  const buffer = await sharp(box)
    .composite([{ input: textBuf, left: padX, top: padY }])
    .png()
    .toBuffer();
  return { buffer, width: boxW, height: boxH };
}

// Collage layout: a plain grid of large portrait cards -- 2 side by side,
// 3 as two on top + one centered below, 4 as a full 2x2. Fan and diagonal
// cascade layouts (tilted, overlapping cards) used to be picked at random
// too, but they shrank every photo to a small square -- dropped on request
// 2026-10-02 in favor of this grid only.
const COLLAGE_CARD_W = 450, COLLAGE_GAP = 18;
function collageCardHeight(n) {
  return n <= 2 ? 760 : 500;
}

function collageGridPositions(n, cardW, cardH, gap) {
  const rowW = cardW * 2 + gap;
  const left0 = -rowW / 2;
  if (n <= 2) {
    const totalW = cardW * n + gap * (n - 1);
    return Array.from({ length: n }, (_, i) => ({ left: -totalW / 2 + i * (cardW + gap), top: 0 }));
  }
  const positions = [
    { left: left0, top: 0 },
    { left: left0 + cardW + gap, top: 0 },
  ];
  if (n === 3) positions.push({ left: -cardW / 2, top: cardH + gap });
  else positions.push({ left: left0, top: cardH + gap }, { left: left0 + cardW + gap, top: cardH + gap });
  return positions;
}

async function layoutGrid(products, top) {
  const n = products.length;
  const cardW = COLLAGE_CARD_W, cardH = collageCardHeight(n), gap = COLLAGE_GAP;
  const positions = collageGridPositions(n, cardW, cardH, gap);
  const layers = [];
  for (let i = 0; i < n; i++) {
    const imgPath = productImagePath(products[i]);
    if (!imgPath) continue;
    const card = await photoCard(imgPath, { size: cardW, height: cardH });
    layers.push({
      input: card.buffer,
      left: Math.round(W / 2 + positions[i].left),
      top: Math.round(top + positions[i].top),
    });
  }
  return { layers, height: n <= 2 ? cardH : cardH * 2 + gap };
}

// Story 2: 2-4 products, with a promo headline, a bordered caption card, a
// "شروع خرید" CTA and the site link — kept on-brand (dark bg, gold accents),
// unlike a straight photo-booth/film-strip mockup which reads off-brand.
async function buildCollageStory(products, { headline }) {
  const layers = [{ input: await solidBackground() }];

  const logo = await sharp(LOGO_PATH).resize({ width: 300 }).toBuffer();
  const logoMeta = await sharp(logo).metadata();
  layers.push({ input: logo, left: Math.round((W - logoMeta.width) / 2), top: 80 });

  const headlineBuf = await renderText({
    text: headline, fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black',
    width: 960, height: 180, color: GOLD,
  });
  const headlineMeta = await sharp(headlineBuf).metadata();
  layers.push({ input: headlineBuf, left: Math.round((W - headlineMeta.width) / 2), top: 250 });

  const n = Math.min(products.length, 4);
  const gridTop = 420;
  const layout = await layoutGrid(products.slice(0, n), gridTop);
  layers.push(...layout.layers);
  const gridBottom = gridTop + layout.height;

  // Shorter caption box than the single-product story's, so the larger
  // grid above still leaves room for the CTA and link on a 1920px canvas.
  const caption = await buildCaptionCard(STANDARD_CAPTION, { textH: 100 });
  const captionTop = Math.round(gridBottom + 30);
  layers.push({ input: caption.buffer, left: Math.round((W - caption.width) / 2), top: captionTop });

  const cta = await buildCtaBadge('شروع خرید');
  const ctaTop = Math.round(captionTop + caption.height + 25);
  layers.push({ input: cta.buffer, left: Math.round((W - cta.width) / 2), top: ctaTop });

  const linkBuf = await renderText({
    text: SITE_LINK_TEXT, fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 600, height: 80, color: GOLD,
  });
  const linkMeta = await sharp(linkBuf).metadata();
  layers.push({ input: linkBuf, left: Math.round((W - linkMeta.width) / 2), top: Math.round(ctaTop + cta.height + 30) });

  return sharp({ create: { width: W, height: H, channels: 4, background: BG_DARK } })
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = { buildSingleProductStory, buildCollageStory };
