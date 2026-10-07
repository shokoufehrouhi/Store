// Fits a product photo into a width x height box with the product itself
// centred and whole. A plain cover crop (centre or top) cut products off
// whenever they sat off-centre in their photo — e.g. Mango's portrait
// sandal shots, where the pair is at the very bottom under a big empty
// grey area: the square import crop kept the empty middle and cut the
// sandals in half, and the story then showed mostly grey (2026-10-07).
//
// Studio photos (a plain background all around) get the empty background
// trimmed off, then the product is fitted inside the box with a margin, the
// rest filled with that same background colour. Photos without a plain
// background (a scene, a street) fall back to a cover crop on the most
// interesting area (sharp's 'attention' strategy) instead of the centre.
const sharp = require('sharp');

const CORNER_TOLERANCE = 18; // max per-channel difference between corners to call the background plain
const TRIM_THRESHOLD = 18;

// The photo's background colour if all four corners share it, else null.
async function plainBackground(buf) {
  const { data, info } = await sharp(buf).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const corners = [px(1, 1), px(info.width - 2, 1), px(1, info.height - 2), px(info.width - 2, info.height - 2)];
  for (let c = 0; c < 3; c++) {
    const vals = corners.map(p => p[c]);
    if (Math.max(...vals) - Math.min(...vals) > CORNER_TOLERANCE) return null;
  }
  const avg = [0, 1, 2].map(c => Math.round(corners.reduce((s, p) => s + p[c], 0) / 4));
  return { r: avg[0], g: avg[1], b: avg[2] };
}

// Returns a sharp instance of exactly width x height (callers pick the format).
async function frameProduct(input, width, height, { margin = 0.06 } = {}) {
  const buf = await sharp(input).rotate().toBuffer();
  const bg = await plainBackground(buf);
  if (!bg) return sharp(buf).resize(width, height, { fit: 'cover', position: sharp.strategy.attention });

  let trimmed = buf;
  try {
    trimmed = await sharp(buf).trim({ background: bg, threshold: TRIM_THRESHOLD }).toBuffer();
  } catch { /* nothing to trim */ }
  const innerW = Math.round(width * (1 - 2 * margin));
  const innerH = Math.round(height * (1 - 2 * margin));
  const product = await sharp(trimmed).resize(innerW, innerH, { fit: 'inside' }).toBuffer();
  const meta = await sharp(product).metadata();
  return sharp({ create: { width, height, channels: 3, background: bg } })
    .composite([{ input: product, left: Math.round((width - meta.width) / 2), top: Math.round((height - meta.height) / 2) }]);
}

module.exports = { frameProduct };
