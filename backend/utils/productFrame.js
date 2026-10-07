// Fits a product photo into a width x height box with the product itself
// centred and whole. A plain cover crop (centre or top) cut products off
// whenever they sat off-centre in their photo — e.g. Mango's portrait
// sandal shots, where the pair is at the very bottom under a big empty
// grey area: the square import crop kept the empty middle and cut the
// sandals in half, and the story then showed mostly grey (2026-10-07). The
// same centre crop cut the heads off full-length model shots (Koton, Mavi…).
//
// Studio photos (a plain background all around): find the product's
// bounding box (the trimmed area), take a box of the target shape around it
// from the photo itself, with a margin, and where the photo is too narrow
// or short for that, continue it by repeating its edge pixels — only past
// edges that are plain background, so nothing gets smeared. That keeps the
// photo's own background — studio backgrounds are often a soft gradient, so
// filling with one flat colour showed a visible lighter rectangle around
// the model. Photos without a plain background (a scene,
// a street) fall back to a cover crop on the most interesting area
// (sharp's 'attention' strategy) instead of the centre.
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

// The product's bounding box in the photo, or the whole photo.
async function contentBox(buf, bg, W, H) {
  try {
    const { info } = await sharp(buf).trim({ background: bg, threshold: TRIM_THRESHOLD }).toBuffer({ resolveWithObject: true });
    return { left: -(info.trimOffsetLeft || 0), top: -(info.trimOffsetTop || 0), width: info.width, height: info.height };
  } catch {
    return { left: 0, top: 0, width: W, height: H };
  }
}

// Returns a sharp instance of exactly width x height (callers pick the format).
async function frameProduct(input, width, height, { margin = 0.06 } = {}) {
  const buf = await sharp(input).rotate().toBuffer();
  const { width: W, height: H } = await sharp(buf).metadata();
  const bg = await plainBackground(buf);
  if (!bg) return sharp(buf).resize(width, height, { fit: 'cover', position: sharp.strategy.attention });

  // Box of the target shape around the product, plus the margin.
  const c = await contentBox(buf, bg, W, H);
  const ratio = width / height;
  let bw = c.width / (1 - 2 * margin), bh = c.height / (1 - 2 * margin);
  if (bw / bh < ratio) bw = bh * ratio; else bh = bw / ratio;
  bw = Math.round(bw); bh = Math.round(bh);
  const cx = c.left + c.width / 2, cy = c.top + c.height / 2;

  // The box can stick out of the photo; that part repeats the photo's edge
  // pixels, but only past an edge that is plain background (a near-uniform
  // strip): repeating an edge the product reaches would smear it (a head at
  // the top edge got its hair stretched upwards), and a busy edge leaves
  // streaks. Which edges the product "touches" can't be told from the
  // trimmed box — a gradient studio background counts as content there —
  // so the edge strip itself is checked. An axis that can't grow is left
  // at the photo's size and the other one is cropped to the shape instead.
  const plain = {
    left: await plainEdge(buf, W, H, 'left'), right: await plainEdge(buf, W, H, 'right'),
    top: await plainEdge(buf, W, H, 'top'), bottom: await plainEdge(buf, W, H, 'bottom'),
  };
  if (bw > W && !plain.left && !plain.right) { bw = W; bh = Math.round(bw / ratio); }
  if (bh > H && !plain.top && !plain.bottom) { bh = H; bw = Math.round(bh * ratio); }
  const ex = Math.max(0, bw - W), ey = Math.max(0, bh - H);
  const split = (extra, a, b) => (a && b ? [Math.floor(extra / 2), extra - Math.floor(extra / 2)] : a ? [extra, 0] : [0, extra]);
  const [padL, padR] = split(ex, plain.left, plain.right);
  const [padT, padB] = split(ey, plain.top, plain.bottom);

  const ew = Math.min(bw, W), eh = Math.min(bh, H);
  const left = Math.min(Math.max(Math.round(cx - ew / 2), 0), W - ew);
  const top = Math.min(Math.max(Math.round(cy - eh / 2), 0), H - eh);
  const img = await sharp(buf)
    .extract({ left, top, width: ew, height: eh })
    .extend({ left: padL, right: padR, top: padT, bottom: padB, extendWith: 'copy' })
    .toBuffer();
  return sharp(img).resize(width, height, { fit: 'cover' });
}

// Whether a photo's edge (a thin strip along it) is plain background:
// sampled along its length, neighbouring samples never jump by much. A soft
// gradient (common in studio shots, top to bottom) still counts as plain —
// repeating it outwards is seamless — but hair, clothing or a prop crossing
// the edge shows up as a jump.
const EDGE_STRIP = 0.01, EDGE_SAMPLES = 200, EDGE_MAX_JUMP = 14;
async function plainEdge(buf, W, H, side) {
  const vertical = side === 'left' || side === 'right';
  const t = Math.max(2, Math.round((vertical ? W : H) * EDGE_STRIP));
  const box = side === 'left' ? { left: 0, top: 0, width: t, height: H }
    : side === 'right' ? { left: W - t, top: 0, width: t, height: H }
    : side === 'top' ? { left: 0, top: 0, width: W, height: t }
    : { left: 0, top: H - t, width: W, height: t };
  const { data } = await sharp(buf).extract(box).greyscale()
    .resize(vertical ? 1 : EDGE_SAMPLES, vertical ? EDGE_SAMPLES : 1, { fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true });
  for (let i = 1; i < data.length; i++) if (Math.abs(data[i] - data[i - 1]) > EDGE_MAX_JUMP) return false;
  return true;
}

module.exports = { frameProduct };
