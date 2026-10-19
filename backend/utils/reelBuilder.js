// Builds the daily Instagram Reels (1080x1920 MP4, ~15s, no music — the
// user's choice, 2026-10-06: "bedune ahang vali effect video bashe"):
// an intro (the story collage with the slot's headline), one slide per
// product with a slow zoom, varied transitions between them, and an outro
// with the logo and site link. Slides are drawn with sharp in the same
// style as the stories (storyBuilder.js); ffmpeg (the ffmpeg-static
// package, so nothing has to be installed on the server) animates and
// joins them. A silent audio track is included since some players refuse
// video-only files.
const sharp = require('sharp');
const { frameProduct } = require('./productFrame');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { buildCollageStory, displayName } = require('./storyBuilder');

const FONT_BLACK  = path.join(__dirname, '../assets/fonts/Vazirmatn-Black.ttf');
const FONT_BOLD   = path.join(__dirname, '../assets/fonts/Vazirmatn-Bold.ttf');
const FONT_MEDIUM = path.join(__dirname, '../assets/fonts/Vazirmatn-Medium.ttf');
const LOGO_PATH   = path.join(__dirname, '../../frontend/images/shilista_logo.png');
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');

const W = 1080, H = 1920, FPS = 30;
// The site's minimal look (2026-10-07 redesign), like the stories: white,
// ink text, orange only for the discount. Was black with an orange price.
const BG        = '#ffffff';
const INK       = '#1a1a1a';
const MUTED     = '#6b6b6b';
const ACCENT    = '#C2410C';
const ACCENT_BG = '#fff1e8';
const INTRO_SEC = 2.5, SLIDE_SEC = 2.6, OUTRO_SEC = 2.2, FADE_SEC = 0.5;
// Picked in turn, so every reel mixes a few kinds of transition.
const TRANSITIONS = ['slideleft', 'circleopen', 'smoothup', 'fadeblack', 'wiperight', 'zoomin', 'slideup'];

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// With `size` the text keeps that font size and only wraps within `width`;
// without it, it's stretched to fill width x height — which made short
// product names huge and long ones small, so slides use fixed sizes.
async function renderText({ text, fontFile, fontFamily, width, height, size, color, align = 'center' }) {
  const box = size ? { font: `${fontFamily} ${size}`, width } : { font: fontFamily, width, height };
  return sharp({
    text: { text: `<span foreground="${color}">${escapeXml(text)}</span>`, fontfile: fontFile, align, rgba: true, ...box },
  }).png().toBuffer();
}

async function centered(buf, top) {
  const meta = await sharp(buf).metadata();
  return { input: buf, left: Math.round((W - meta.width) / 2), top: Math.round(top) };
}

// At most two lines at the slide's name size: cut at a word, with "…".
const REEL_NAME_MAX = 46;
function shortName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
  if (n.length <= REEL_NAME_MAX) return n;
  const cut = n.slice(0, REEL_NAME_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : REEL_NAME_MAX).trim()}…`;
}

const toFaDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const formatTL = (n) => `${Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`;

function productImagePath(product) {
  const media = (product.product_media || [])[0];
  return media ? path.join(UPLOADS_DIR, path.basename(media.url)) : null;
}

async function roundedPhoto(imagePath, width, height, radius = 36) {
  const img = await (await frameProduct(imagePath, width, height)).png().toBuffer();
  const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

// One product: big photo, name, old price struck through, new price and
// the discount badge.
async function buildProductSlide(product) {
  const layers = [];
  const logo = await sharp(LOGO_PATH).resize({ width: 220 }).toBuffer();
  layers.push(await centered(logo, 60));

  const imgPath = productImagePath(product);
  if (imgPath) layers.push(await centered(await roundedPhoto(imgPath, 940, 1140), 180));

  // The prices go right under the name, which can wrap to two lines.
  const nameBuf = await renderText({
    text: shortName(displayName(product)), fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 960, size: 76, color: INK,
  });
  const nameTop = 1350;
  layers.push(await centered(nameBuf, nameTop));
  let y = nameTop + (await sharp(nameBuf).metadata()).height + 25;

  const price = Number(product.price);
  const sale = product.discounted_price != null ? Number(product.discounted_price) : null;
  if (sale != null && sale < price) {
    const pct = Math.round((price - sale) / price * 100);
    const oldBuf = await renderText({ text: formatTL(price), fontFile: FONT_MEDIUM, fontFamily: 'Vazirmatn Medium', width: 600, size: 64, color: '#8a8a8a' });
    const oldMeta = await sharp(oldBuf).metadata();
    const strike = Buffer.from(`<svg width="${oldMeta.width}" height="${oldMeta.height}"><line x1="0" y1="${oldMeta.height / 2}" x2="${oldMeta.width}" y2="${oldMeta.height / 2}" stroke="#8a8a8a" stroke-width="5"/></svg>`);
    layers.push(await centered(await sharp(oldBuf).composite([{ input: strike }]).png().toBuffer(), y));
    y += oldMeta.height + 5;
    layers.push(await centered(await renderText({ text: formatTL(sale), fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 900, size: 124, color: INK }), y));

    const badgeText = await renderText({ text: `${toFaDigits(pct)}٪ تخفیف`, fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 420, size: 60, color: ACCENT });
    const bm = await sharp(badgeText).metadata();
    const bw = bm.width + 60, bh = bm.height + 30;
    const badgeBg = Buffer.from(`<svg width="${bw}" height="${bh}"><rect width="${bw}" height="${bh}" rx="${bh / 2}" ry="${bh / 2}" fill="${ACCENT_BG}"/></svg>`);
    const badge = await sharp(badgeBg).composite([{ input: badgeText, left: 30, top: 15 }]).png().toBuffer();
    layers.push({ input: badge, left: W - bw - 90, top: 215 });
  } else {
    layers.push(await centered(await renderText({ text: formatTL(sale ?? price), fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 900, size: 124, color: INK }), y));
  }

  return sharp({ create: { width: W, height: H, channels: 4, background: BG } }).composite(layers).jpeg({ quality: 92 }).toBuffer();
}

async function buildOutroSlide() {
  const layers = [];
  const logo = await sharp(LOGO_PATH).resize({ width: 640 }).toBuffer();
  layers.push(await centered(logo, 640));
  layers.push(await centered(await renderText({ text: 'همین الان در شیلیستا ببین', fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 960, height: 130, color: INK }), 1000));
  layers.push(await centered(await renderText({ text: 'shilista.com', fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold', width: 700, height: 100, color: MUTED }), 1160));
  return sharp({ create: { width: W, height: H, channels: 4, background: BG } }).composite(layers).jpeg({ quality: 92 }).toBuffer();
}

// The opening hook (user's choice, 2026-10-19): the discount in big type
// for the first HOOK_SEC — "up to X%" for a reel of several products, "X%"
// for one. The HTML reels draw it with reelHook/hook.js from the same
// { text, sub }; the ffmpeg reels overlay hookOverlay()'s picture.
const HOOK_SEC = 2.4, HOOK_OUT_SEC = 0.35;
const cutOf = (p) => Math.round((Number(p.price) - Number(p.discounted_price)) / Number(p.price) * 100);
function reelHook(products, { top } = {}) {
  const cuts = products.filter((p) => p.discounted_price != null && Number(p.discounted_price) < Number(p.price)).map(cutOf);
  if (!cuts.length) return null;
  const pct = toFaDigits(Math.max(...cuts));
  const several = products.length > 1;
  return { text: several ? `تا ${pct}٪ تخفیف` : `${pct}٪ تخفیف`, sub: several ? 'برندهای اصل ترکیه' : 'برند اصل ترکیه', ...(top != null && { top }) };
}

// The hook as a full-frame transparent PNG, looking like reelHook/hook.js's.
async function hookOverlay(hook, top = 1260) {
  const big = await renderText({ text: hook.text, fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 1000, size: 132, color: '#ffffff' });
  const sub = await renderText({ text: hook.sub, fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold', width: 1000, size: 46, color: '#ffffff' });
  const bm = await sharp(big).metadata(), sm = await sharp(sub).metadata();
  const bw = Math.max(bm.width, sm.width) + 160, bh = bm.height + sm.height + 70;
  const box = Buffer.from(`<svg width="${bw}" height="${bh}"><rect width="${bw}" height="${bh}" rx="64" ry="64" fill="${ACCENT}"/></svg>`);
  const pill = await sharp(box).composite([
    { input: big, left: Math.round((bw - bm.width) / 2), top: 26 },
    { input: sub, left: Math.round((bw - sm.width) / 2), top: 26 + bm.height + 6 },
  ]).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: pill, left: Math.round((W - bw) / 2), top }]).png().toBuffer();
}
// ffmpeg filter for input `n` (the hook PNG, looped for HOOK_SEC): fades out at the end.
const hookFilter = (n) => `[${n}:v]format=rgba,fade=t=out:st=${(HOOK_SEC - HOOK_OUT_SEC).toFixed(2)}:d=${HOOK_OUT_SEC}:alpha=1[hook]`;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 32 * 1024 * 1024 }, (err, _stdout, stderr) => {
      // The cause is usually far above the last lines (which only say
      // nothing was written): keep the lines that name an error too.
      if (err) {
        const lines = String(stderr).split('\n');
        const why = lines.filter(l => /error|invalid|mismatch|do not match|failed|unable|cannot/i.test(l)).slice(0, 6);
        reject(new Error(`ffmpeg failed: ${[...why, ...lines.slice(-3)].join(' | ')}`));
      }
      else resolve();
    });
  });
}

// Slow zoom in or out, alternating per slide (zoompan on a 2x upscale so
// the motion doesn't jitter).
function motionFilter(i, seconds) {
  const frames = Math.round(seconds * FPS);
  const zoom = i % 2 === 0 ? "min(zoom+0.0009,1.12)" : "if(eq(on,0),1.12,max(zoom-0.0009,1))";
  return `scale=${W * 2}:${H * 2},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p,setsar=1,settb=1/${FPS}`;
}

// Builds the reel for `products` (2+) and returns its /uploads/... path.
async function buildReel(products, { headline, prefix = 'reel' }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shilista-reel-'));
  try {
    const slides = [
      { buf: await buildCollageStory(products.slice(0, 4), { headline }), sec: INTRO_SEC },
      ...await Promise.all(products.map(async (p) => ({ buf: await buildProductSlide(p), sec: SLIDE_SEC }))),
      { buf: await buildOutroSlide(), sec: OUTRO_SEC },
    ];
    const inputs = [];
    slides.forEach((s, i) => {
      const file = path.join(workDir, `slide${i}.jpg`);
      fs.writeFileSync(file, s.buf);
      inputs.push('-i', file);
    });

    const hook = reelHook(products);
    if (hook) {
      const file = path.join(workDir, 'hook.png');
      fs.writeFileSync(file, await hookOverlay(hook));
      inputs.push('-loop', '1', '-t', String(HOOK_SEC), '-i', file);
    }
    const filters = slides.map((s, i) => `[${i}:v]${motionFilter(i, s.sec)}[v${i}]`);
    let last = 'v0';
    let offset = 0;
    for (let i = 1; i < slides.length; i++) {
      offset += slides[i - 1].sec - FADE_SEC;
      const out = `x${i}`;
      filters.push(`[${last}][v${i}]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${FADE_SEC}:offset=${offset.toFixed(2)}[${out}]`);
      last = out;
    }
    const total = slides.reduce((sum, s) => sum + s.sec, 0) - FADE_SEC * (slides.length - 1);
    if (hook) {
      filters.push(hookFilter(slides.length), `[${last}][hook]overlay=0:0:eof_action=pass,format=yuv420p,fps=${FPS}[vh]`);
      last = 'vh';
    }
    const audioIn = slides.length + (hook ? 1 : 0);

    const filename = `ig-${prefix}-${Date.now()}.mp4`;
    const outFile = path.join(UPLOADS_DIR, filename);
    await runFfmpeg([
      '-y', ...inputs,
      '-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-filter_complex', filters.join(';'),
      '-map', `[${last}]`, '-map', `${audioIn}:a`,
      // 2 threads: the server also runs the site and the imports (~680MB peak RAM per build).
      '-threads', '2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart',
      '-t', total.toFixed(2),
      outFile,
    ]);
    return `/uploads/${filename}`;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// The daily AI reel (see aiReel.js): the ~5s clip of a person with the
// product, with the logo on top and the real product photo in the corner
// (no price on the clip — user's choice, 2026-10-13),
// then a product slide and the outro — exactly AI_REEL_SEC in all. User's
// request (2026-10-13): one product only, and the person wearing it in
// every part, so the product slide and outro show the try-on picture (`look`)
// instead of the bare product photo.
// Three parts of 5s each (user's choice, 2026-10-13): the clip, the
// product slide and the outro; the first two run AI_FADE_SEC longer to
// make up for the cross-fades.
const AI_PART_SEC = 5, AI_FADE_SEC = 0.35;
const AI_CLIP_SEC = AI_PART_SEC + AI_FADE_SEC, AI_PRODUCT_SEC = AI_PART_SEC + AI_FADE_SEC, AI_OUTRO_SEC = AI_PART_SEC;
const AI_REEL_SEC = AI_CLIP_SEC + AI_PRODUCT_SEC + AI_OUTRO_SEC - 2 * AI_FADE_SEC;

// The try-on picture blurred and washed out, filling the frame.
async function aiBackdrop(look) {
  const blur = await sharp(look).resize(W, H, { fit: 'cover' }).blur(40).toBuffer();
  const wash = Buffer.from(`<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff" fill-opacity=".55"/></svg>`);
  return { input: await sharp(blur).composite([{ input: wash }]).png().toBuffer(), left: 0, top: 0 };
}

async function roundedBuf(buf, width, height, radius = 36) {
  const img = await sharp(buf).resize(width, height, { fit: 'cover', position: 'top' }).png().toBuffer();
  const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

function whiteCard(width, height, radius = 44) {
  return Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
}

// The person with the product and the real product photo, the name on a
// white card under it and the discount.
async function aiProductSlide(product, look) {
  const layers = [await aiBackdrop(look)];
  layers.push(await centered(await sharp(LOGO_PATH).resize({ width: 220 }).toBuffer(), 50));
  const photoH = 1150, photoW = Math.round(photoH * 9 / 16);
  layers.push(await centered(await roundedBuf(look, photoW, photoH), 160));
  const cornerSize = 260;
  layers.push({ input: await productCorner(product, cornerSize), left: Math.round((W + photoW) / 2) - cornerSize - 24, top: 160 + photoH - cornerSize - 24 });

  // The card fits the name (one line or two).
  const cardTop = 1360, cardW = 980;
  const cardAt = layers.length;
  const nameBuf = await renderText({
    text: shortName(displayName(product)), fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 900, size: 64, color: INK,
  });
  layers.push(await centered(nameBuf, cardTop + 35));
  const y = cardTop + 35 + (await sharp(nameBuf).metadata()).height;

  // No prices at all (user's choice, 2026-10-13), only the discount.
  const price = Number(product.price);
  const sale = product.discounted_price != null ? Number(product.discounted_price) : null;
  if (sale != null && sale < price) {
    const pct = Math.round((price - sale) / price * 100);
    const badgeText = await renderText({ text: `${toFaDigits(pct)}٪ تخفیف`, fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 420, size: 56, color: ACCENT });
    const bm = await sharp(badgeText).metadata();
    const bw = bm.width + 60, bh = bm.height + 30;
    const badgeBg = Buffer.from(`<svg width="${bw}" height="${bh}"><rect width="${bw}" height="${bh}" rx="${bh / 2}" ry="${bh / 2}" fill="${ACCENT_BG}"/></svg>`);
    const badge = await sharp(badgeBg).composite([{ input: badgeText, left: 30, top: 15 }]).png().toBuffer();
    layers.push({ input: badge, left: Math.round((W + photoW) / 2) - bw + 30, top: 190 });
  }
  layers.splice(cardAt, 0, { input: whiteCard(cardW, y - cardTop + 40), left: (W - cardW) / 2, top: cardTop });
  return sharp({ create: { width: W, height: H, channels: 4, background: BG } }).composite(layers).jpeg({ quality: 92 }).toBuffer();
}

// The outro on top of the same person: logo, call to action, site link.
async function aiOutroSlide(look) {
  const layers = [await aiBackdrop(look)];
  const photoH = 900, photoW = Math.round(photoH * 9 / 16);
  layers.push(await centered(await roundedBuf(look, photoW, photoH), 170));
  const cardW = 900, cardH = 560, cardTop = 1170;
  layers.push({ input: whiteCard(cardW, cardH), left: (W - cardW) / 2, top: cardTop });
  layers.push(await centered(await sharp(LOGO_PATH).resize({ width: 480 }).toBuffer(), cardTop + 50));
  layers.push(await centered(await renderText({ text: 'همین الان در شیلیستا ببین', fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 820, size: 66, color: INK }), cardTop + 300));
  layers.push(await centered(await renderText({ text: 'shilista.com', fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold', width: 700, size: 52, color: MUTED }), cardTop + 430));
  return sharp({ create: { width: W, height: H, channels: 4, background: BG } }).composite(layers).jpeg({ quality: 92 }).toBuffer();
}
async function aiClipOverlay(product) {
  const layers = [];
  const shade = Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".14" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  layers.push({ input: shade });
  layers.push(await centered(await sharp(LOGO_PATH).resize({ width: 260 }).toBuffer(), 80));
  const corner = await productCorner(product, 340);
  layers.push({ input: corner, left: W - 340 - 50, top: H - 340 - 140 });
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
}

// The real product photo on a small white card for a corner of the AI
// reel: the AI often gets the product wrong (2026-10-13: a pink bottle
// instead of the KIKO foundation), so the real one is always on screen.
async function productCorner(product, size) {
  const pad = Math.round(size * 0.06);
  const photo = await roundedPhoto(productImagePath(product), size - 2 * pad, size - 2 * pad, 24);
  const card = Buffer.from(`<svg width="${size}" height="${size}"><rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="32" ry="32" fill="#fff" stroke="#e5e5e5" stroke-width="2"/></svg>`);
  return sharp(card).composite([{ input: photo, left: pad, top: pad }]).png().toBuffer();
}

// Builds the AI reel for one product of `groupKey` and returns its
// /uploads/... path plus what aiReel.js picked (kind, avatar).
async function buildAiReel(product, groupKey) {
  const { makeAiClip } = require('./aiReel');
  const photo = productImagePath(product);
  if (!photo || !fs.existsSync(photo)) throw new Error(`product ${product.id} has no photo on disk`);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shilista-aireel-'));
  try {
    const clip = path.join(workDir, 'clip.mp4');
    const { look, ...info } = await makeAiClip(product, groupKey, photo, clip);
    const files = { overlay: 'overlay.png', product: 'product.jpg', outro: 'outro.jpg', hook: 'hook.png' };
    fs.writeFileSync(path.join(workDir, files.overlay), await aiClipOverlay(product));
    // Under the logo: the person (and the real product's corner) fill the rest.
    const hook = reelHook([product]);
    if (hook) fs.writeFileSync(path.join(workDir, files.hook), await hookOverlay(hook, 260));
    fs.writeFileSync(path.join(workDir, files.product), await aiProductSlide(product, look));
    fs.writeFileSync(path.join(workDir, files.outro), await aiOutroSlide(look));

    // The clip on its own first, to plain 1080x1920 30fps (the Space's
    // output varies): if this fails it's the clip, not the reel's assembly —
    // the 2026-10-09 run failed in one combined step with no way to tell.
    // It's also fitted to AI_CLIP_SEC here so the reel is always
    // AI_REEL_SEC: slowed down or sped up a little (at most 0.8-1.4x), then
    // the last frame held / the end cut for whatever is left.
    const probeSec = async (file) => {
      const probe = await new Promise((resolve) => execFile(ffmpegPath, ['-i', file], (_e, _o, stderr) => resolve(String(stderr))));
      const m = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
      return { sec: m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0, probe };
    };
    const raw = await probeSec(clip);
    if (raw.sec < 1) throw new Error(`AI clip too short (${raw.probe.match(/Duration: [^,]*/)?.[0] || 'no duration'})`);
    const stretch = Math.min(1.4, Math.max(0.8, AI_CLIP_SEC / raw.sec));
    const norm = path.join(workDir, 'clip-norm.mp4');
    await runFfmpeg(['-y', '-i', clip, '-an',
      '-vf', `setpts=${stretch.toFixed(4)}*(PTS-STARTPTS),scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},fps=${FPS},tpad=stop_mode=clone:stop_duration=${AI_CLIP_SEC},format=yuv420p,setsar=1`,
      '-t', String(AI_CLIP_SEC),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', norm]);
    const clipSec = AI_CLIP_SEC;
    const total = AI_REEL_SEC;

    const filename = `ig-reel-ai-${groupKey}-${Date.now()}.mp4`;
    const outFile = path.join(UPLOADS_DIR, filename);
    // A failed run leaves an empty file behind in uploads/.
    await runFfmpeg([
      '-y', '-i', norm, '-i', path.join(workDir, files.overlay),
      '-loop', '1', '-t', String(AI_PRODUCT_SEC), '-i', path.join(workDir, files.product),
      '-loop', '1', '-t', String(AI_OUTRO_SEC), '-i', path.join(workDir, files.outro),
      '-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      ...(hook ? ['-loop', '1', '-t', String(HOOK_SEC), '-i', path.join(workDir, files.hook)] : []),
      '-filter_complex', [
        // xfade needs every input on the same timebase, and the clip's
        // depends on what the Space returned (1/15360 vs 1/30: "Invalid
        // argument", nothing written) — so it's set explicitly everywhere.
        `[0:v]fps=${FPS},settb=1/${FPS},setpts=PTS-STARTPTS[c]`,
        // ffmpeg 7 (the VPS's ffmpeg-static) gives overlay's output an
        // unknown frame rate when the still overlay image (25fps) and the
        // clip (30fps) differ, and xfade refuses it ("current rate of 1/0",
        // the 2026-10-10/11 runs): fps= sets it again.
        ...(hook
          ? [hookFilter(5), `[c][1:v]overlay=0:0[o]`, `[o][hook]overlay=0:0:eof_action=pass,format=yuv420p,setsar=1,fps=${FPS}[v0]`]
          : [`[c][1:v]overlay=0:0,format=yuv420p,setsar=1,fps=${FPS}[v0]`]),
        `[2:v]${motionFilter(0, AI_PRODUCT_SEC)}[v1]`,
        `[3:v]${motionFilter(1, AI_OUTRO_SEC)}[v2]`,
        `[v0][v1]xfade=transition=fadewhite:duration=${AI_FADE_SEC}:offset=${(clipSec - AI_FADE_SEC).toFixed(2)}[x1]`,
        `[x1][v2]xfade=transition=fadeblack:duration=${AI_FADE_SEC}:offset=${(clipSec + AI_PRODUCT_SEC - 2 * AI_FADE_SEC).toFixed(2)}[x2]`,
      ].join(';'),
      '-map', '[x2]', '-map', '4:a',
      '-threads', '2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart',
      '-t', total.toFixed(2),
      outFile,
    ]).catch((e) => { fs.rmSync(outFile, { force: true }); throw e; });
    return { videoUrl: `/uploads/${filename}`, ...info };
  } catch (err) {
    // The AI clip took minutes of free GPU quota and can't be made again
    // today: keep it so the failure can be looked into.
    const clip = path.join(workDir, 'clip.mp4');
    if (fs.existsSync(clip)) {
      const kept = path.join(os.tmpdir(), `shilista-aireel-failed-${Date.now()}.mp4`);
      fs.copyFileSync(clip, kept);
      err.message += ` (clip kept at ${kept})`;
    }
    throw err;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { buildReel, buildProductSlide, buildAiReel, reelHook, hookOverlay };
