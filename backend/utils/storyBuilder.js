// Builds the two daily Instagram Story images (1080x1920) for Shilista's
// auto-post pipeline: a single-product story and a 2-3 product collage.
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
async function photoCard(imagePath, { size, radius = 28, rotateDeg = 0 }) {
  const img = await sharp(imagePath).resize(size, size, { fit: 'cover' }).toBuffer();
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
  );
  const rounded = await sharp(img)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const border = Buffer.from(
    `<svg width="${size}" height="${size}">
       <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${radius}" ry="${radius}"
             fill="none" stroke="#ffffff" stroke-width="6"/>
     </svg>`
  );
  const withBorder = await sharp(rounded).composite([{ input: border }]).png().toBuffer();

  if (!rotateDeg) return { buffer: withBorder, width: size, height: size };
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

// Story 1: a single product — logo, hero photo, short name, site link + CTA.
async function buildSingleProductStory(product) {
  const layers = [{ input: await solidBackground() }];

  const logo = await sharp(LOGO_PATH).resize({ width: 480 }).toBuffer();
  const logoMeta = await sharp(logo).metadata();
  layers.push({ input: logo, left: Math.round((W - logoMeta.width) / 2), top: 110 });

  const imgPath = productImagePath(product);
  if (imgPath) {
    const card = await photoCard(imgPath, { size: 860 });
    layers.push({ input: card.buffer, left: Math.round((W - card.width) / 2), top: 430 });
  }

  const nameBuf = await renderText({
    text: shortenName(product.name_fa, 70),
    fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 920, height: 220, color: '#ffffff',
  });
  const nameMeta = await sharp(nameBuf).metadata();
  layers.push({ input: nameBuf, left: Math.round((W - nameMeta.width) / 2), top: 1340 });

  const cta = await buildCtaBadge();
  layers.push({ input: cta.buffer, left: Math.round((W - cta.width) / 2), top: 1620 });

  const linkBuf = await renderText({
    text: SITE_LINK_TEXT, fontFile: FONT_MEDIUM, fontFamily: 'Vazirmatn Medium',
    width: 600, height: 80, color: GOLD,
  });
  const linkMeta = await sharp(linkBuf).metadata();
  layers.push({ input: linkBuf, left: Math.round((W - linkMeta.width) / 2), top: 1770 });

  return sharp({ create: { width: W, height: H, channels: 4, background: BG_DARK } })
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function buildCtaBadge() {
  const text = 'مشاهده و خرید';
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

// Story 2: 2-3 products fanned into a card collage, with a promo headline.
async function buildCollageStory(products, { headline, subline }) {
  const layers = [{ input: await solidBackground() }];

  const logo = await sharp(LOGO_PATH).resize({ width: 340 }).toBuffer();
  const logoMeta = await sharp(logo).metadata();
  layers.push({ input: logo, left: Math.round((W - logoMeta.width) / 2), top: 90 });

  const headlineBuf = await renderText({
    text: headline, fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black',
    width: 960, height: 220, color: GOLD,
  });
  const headlineMeta = await sharp(headlineBuf).metadata();
  layers.push({ input: headlineBuf, left: Math.round((W - headlineMeta.width) / 2), top: 300 });

  const n = Math.min(products.length, 3);
  const cardSize = n === 2 ? 480 : 420;
  const angles = n === 2 ? [-7, 7] : [-10, 0, 10];
  const centerY = 1150;
  const margin = 30;

  // A square rotated by θ has bounding-box side = size*(|cosθ|+|sinθ|) — used
  // to keep every card fully on-canvas (the first cut of this collage placed
  // cards by center spread alone and clipped the leftmost one off the edge).
  const rotatedHalf = (deg) => {
    const rad = Math.abs(deg) * Math.PI / 180;
    return (cardSize * (Math.cos(rad) + Math.sin(rad))) / 2;
  };
  const maxHalf = Math.max(...angles.slice(0, n).map(rotatedHalf));
  const spread = Math.min(n === 2 ? 220 : 260, W / 2 - margin - maxHalf);
  const xs = n === 2
    ? [W / 2 - spread, W / 2 + spread]
    : [W / 2 - spread, W / 2, W / 2 + spread];

  for (let i = 0; i < n; i++) {
    const imgPath = productImagePath(products[i]);
    if (!imgPath) continue;
    const card = await photoCard(imgPath, { size: cardSize, rotateDeg: angles[i] });
    const left = Math.round(Math.min(Math.max(xs[i] - card.width / 2, margin), W - margin - card.width));
    layers.push({ input: card.buffer, left, top: Math.round(centerY - card.height / 2) });
  }

  const sublineBuf = await renderText({
    text: subline, fontFile: FONT_MEDIUM, fontFamily: 'Vazirmatn Medium',
    width: 900, height: 160, color: '#ffffff',
  });
  const sublineMeta = await sharp(sublineBuf).metadata();
  layers.push({ input: sublineBuf, left: Math.round((W - sublineMeta.width) / 2), top: 1620 });

  const linkBuf = await renderText({
    text: SITE_LINK_TEXT, fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 600, height: 80, color: GOLD,
  });
  const linkMeta = await sharp(linkBuf).metadata();
  layers.push({ input: linkBuf, left: Math.round((W - linkMeta.width) / 2), top: 1790 });

  return sharp({ create: { width: W, height: H, channels: 4, background: BG_DARK } })
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = { buildSingleProductStory, buildCollageStory };
