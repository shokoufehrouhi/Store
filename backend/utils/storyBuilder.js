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
async function buildCaptionCard(text) {
  const textW = 860, textH = 160, padX = 50, padY = 30;
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

// Grid positions for n products (2 or 4): a single row for 2, a full 2x2
// for 4. n===3 is handled separately (buildTrioFan) as an overlapping fan
// instead of a grid — see its own comment.
function collageGridPositions(n, cardSize, gap) {
  const rowW = cardSize * 2 + gap;
  if (n <= 2) {
    const totalW = cardSize * n + gap * (n - 1);
    const left0 = -totalW / 2;
    return Array.from({ length: n }, (_, i) => ({ left: left0 + i * (cardSize + gap), top: 0 }));
  }
  return [
    { left: -rowW / 2, top: 0 },
    { left: -rowW / 2 + cardSize + gap, top: 0 },
    { left: -rowW / 2, top: cardSize + gap },
    { left: -rowW / 2 + cardSize + gap, top: cardSize + gap },
  ];
}

// A square rotated by θ has bounding-box side = size*(|cosθ|+|sinθ|) — used
// to keep every card fully on-canvas when rotated (see buildTrioFan).
function rotatedHalf(size, deg) {
  const rad = Math.abs(deg) * Math.PI / 180;
  return (size * (Math.cos(rad) + Math.sin(rad))) / 2;
}

// Exactly 3 products: an overlapping fan (not a clean grid) — left and
// right cards rotated and tucked behind the centered one, per the user's
// "photos should overlap, not sit cleanly side by side" request. Returns
// the composite layers plus how tall the fan is, so the caller can stack
// the caption/CTA/link below it.
async function buildTrioFan(products, top) {
  const layers = [];
  const size = 380;
  const angles = [-7, 0, 7];
  const maxHalf = Math.max(...angles.map(deg => rotatedHalf(size, deg)));
  // Overlap by only ~100px of the 380px card (not half of it) so all three
  // stay clearly identifiable -- an earlier tighter spread buried most of
  // the side cards behind the centered one.
  const spread = Math.min(size - 100, W / 2 - 20 - maxHalf);
  const xs = [W / 2 - spread, W / 2, W / 2 + spread];
  const centerY = top + maxHalf;
  const drawOrder = [0, 2, 1]; // left, right, then the centered card on top

  for (const i of drawOrder) {
    const imgPath = productImagePath(products[i]);
    if (!imgPath) continue;
    const card = await photoCard(imgPath, { size, rotateDeg: angles[i] });
    layers.push({
      input: card.buffer,
      left: Math.round(xs[i] - card.width / 2),
      top: Math.round(centerY - card.height / 2),
    });
  }
  return { layers, height: maxHalf * 2 };
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
  const cardSize = 420, gap = 16;
  const gridTop = 440;
  let gridBottom;

  if (n === 3) {
    const fan = await buildTrioFan(products, gridTop);
    layers.push(...fan.layers);
    gridBottom = gridTop + fan.height;
  } else {
    const positions = collageGridPositions(n, cardSize, gap);
    for (let i = 0; i < n; i++) {
      const imgPath = productImagePath(products[i]);
      if (!imgPath) continue;
      const card = await photoCard(imgPath, { size: cardSize });
      layers.push({
        input: card.buffer,
        left: Math.round(W / 2 + positions[i].left),
        top: Math.round(gridTop + positions[i].top),
      });
    }
    gridBottom = gridTop + (n <= 2 ? cardSize : cardSize * 2 + gap);
  }

  const caption = await buildCaptionCard(STANDARD_CAPTION);
  const captionTop = Math.round(gridBottom + 40);
  layers.push({ input: caption.buffer, left: Math.round((W - caption.width) / 2), top: captionTop });

  const cta = await buildCtaBadge('شروع خرید');
  const ctaTop = Math.round(captionTop + caption.height + 30);
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
