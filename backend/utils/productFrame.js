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
  if (!bg) return frameScene(buf, W, H, width, height);

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
  const img = await extendFromInside(await sharp(buf).extract({ left, top, width: ew, height: eh }).toBuffer(),
    { left: padL, right: padR, top: padT, bottom: padB });
  return sharp(img).resize(width, height, { fit: 'cover' });
}

// A photo whose background isn't plain all round (e.g. Mavi's grey studio
// with a floor shadow, or a street): keep the whole photo and grow it to
// the target shape past whichever sides of the short axis are plain — a
// portrait shot with plain walls left and right becomes square without
// losing the head or feet. Only when neither side is plain is it cropped,
// on the most interesting area.
async function frameScene(buf, W, H, width, height) {
  const ratio = width / height;
  const wide = W / H < ratio; // needs width added (else height)
  const [a, b] = wide ? ['left', 'right'] : ['top', 'bottom'];
  const plainA = await plainEdge(buf, W, H, a), plainB = await plainEdge(buf, W, H, b);
  if (!plainA && !plainB) return sharp(buf).resize(width, height, { fit: 'cover', position: sharp.strategy.attention });
  const extra = wide ? Math.round(H * ratio) - W : Math.round(W / ratio) - H;
  const first = plainA && plainB ? Math.floor(extra / 2) : plainA ? extra : 0;
  const img = await extendFromInside(buf, { [a]: first, [b]: extra - first });
  return sharp(img).resize(width, height, { fit: 'cover' });
}

// Grows an image by repeating its edge pixels — but from a few pixels in:
// brand photos often have a thin lighter or darker line along their very
// edge (Koton's is 240 against a 231 background), and repeating that line
// drew a visible band down the side. Those pixels are dropped first and
// added back to the padding, so the size comes out the same.
async function extendFromInside(buf, pad) {
  const { width: w, height: h } = await sharp(buf).metadata();
  const inset = (n) => Math.max(2, Math.round(n * 0.012));
  const cut = {
    left: pad.left ? inset(w) : 0, right: pad.right ? inset(w) : 0,
    top: pad.top ? inset(h) : 0, bottom: pad.bottom ? inset(h) : 0,
  };
  return sharp(buf)
    .extract({ left: cut.left, top: cut.top, width: w - cut.left - cut.right, height: h - cut.top - cut.bottom })
    .extend({
      left: (pad.left || 0) + cut.left, right: (pad.right || 0) + cut.right,
      top: (pad.top || 0) + cut.top, bottom: (pad.bottom || 0) + cut.bottom,
      extendWith: 'copy',
    })
    .toBuffer();
}

// Whether a photo's edge (a thin strip along it) is plain background:
// sampled along its length, neighbouring samples never jump by much. A soft
// gradient (common in studio shots, top to bottom) still counts as plain —
// repeating it outwards is seamless — but hair, clothing or a prop crossing
// the edge shows up as a jump.
// The strip reaches past the few pixels extendFromInside skips, since that
// inner column is the one actually repeated.
const EDGE_STRIP = 0.03, EDGE_SAMPLES = 200, EDGE_MAX_JUMP = 14, EDGE_MAX_RANGE = 45;
const EDGE_MIN_LIGHT = 175, EDGE_MAX_TEXTURE = 2.5;
async function plainEdge(buf, W, H, side) {
  const vertical = side === 'left' || side === 'right';
  const t = Math.max(2, Math.round((vertical ? W : H) * EDGE_STRIP));
  const box = side === 'left' ? { left: 0, top: 0, width: t, height: H }
    : side === 'right' ? { left: W - t, top: 0, width: t, height: H }
    : side === 'top' ? { left: 0, top: 0, width: W, height: t }
    : { left: 0, top: H - t, width: W, height: t };
  // In colour: in greyscale a light-blue sleeve reaching the edge looked
  // the same as a light-grey wall, so it was "plain" and got smeared out
  // into a blue stripe (Colin's, 2026-10-07).
  const { data } = await sharp(buf).extract(box).removeAlpha()
    .resize(vertical ? 1 : EDGE_SAMPLES, vertical ? EDGE_SAMPLES : 1, { fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 3) {
    for (let c = 0; c < 3; c++) if (Math.abs(data[i + c] - data[i - 3 + c]) > EDGE_MAX_JUMP) return false;
  }
  // A dark garment filling most of the edge changes gradually between
  // samples (no single jump), but spans a far wider range than a studio
  // gradient (Koton's ~10, Mavi's ~30) — Defacto, 2026-10-07.
  for (let c = 0; c < 3; c++) {
    let lo = 255, hi = 0;
    for (let i = c; i < data.length; i += 3) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
    if (hi - lo > EDGE_MAX_RANGE) return false;
  }
  // A fabric close-up fills the whole photo, so its edges are one even
  // colour too and passed the checks above — repeating them drew streaks
  // (459 photos, mostly Mavi, 2026-10-08). Studio walls are light (176+ on
  // every brand measured, fabric close-ups mostly under 130) and smooth at
  // full size (neighbouring pixels differ by under ~2; knit and weave by
  // 2–30), so an edge must be both.
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  if (sum / data.length < EDGE_MIN_LIGHT) return false;
  return (await edgeTexture(buf, box)) < EDGE_MAX_TEXTURE;
}

// Mean difference between neighbouring pixels of a strip, at full size.
async function edgeTexture(buf, box) {
  const { data, info } = await sharp(buf).extract(box).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i++) {
    if (i % w) { s += Math.abs(data[i] - data[i - 1]); n++; }
    if (i >= w) { s += Math.abs(data[i] - data[i - w]); n++; }
  }
  return n ? s / n : 0;
}

module.exports = { frameProduct };
