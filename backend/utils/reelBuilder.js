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
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { buildCollageStory } = require('./storyBuilder');

const FONT_BLACK  = path.join(__dirname, '../assets/fonts/Vazirmatn-Black.ttf');
const FONT_BOLD   = path.join(__dirname, '../assets/fonts/Vazirmatn-Bold.ttf');
const FONT_MEDIUM = path.join(__dirname, '../assets/fonts/Vazirmatn-Medium.ttf');
const LOGO_PATH   = path.join(__dirname, '../../frontend/images/shilista_logo.png');
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');

const W = 1080, H = 1920, FPS = 30;
const BG_DARK = '#0d0d0d';
const GOLD    = '#D4AF37';
const ORANGE  = '#FF5C00';
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

const toFaDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const formatTL = (n) => `${Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`;

function productImagePath(product) {
  const media = (product.product_media || [])[0];
  return media ? path.join(UPLOADS_DIR, path.basename(media.url)) : null;
}

async function roundedPhoto(imagePath, width, height, radius = 36) {
  const img = await sharp(imagePath).resize(width, height, { fit: 'cover', position: 'top' }).toBuffer();
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
    text: String(product.name_fa || '').slice(0, 70), fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold',
    width: 960, size: 76, color: '#ffffff',
  });
  const nameTop = 1350;
  layers.push(await centered(nameBuf, nameTop));
  let y = nameTop + (await sharp(nameBuf).metadata()).height + 25;

  const price = Number(product.price);
  const sale = product.discounted_price != null ? Number(product.discounted_price) : null;
  if (sale != null && sale < price) {
    const pct = Math.round((price - sale) / price * 100);
    const oldBuf = await renderText({ text: formatTL(price), fontFile: FONT_MEDIUM, fontFamily: 'Vazirmatn Medium', width: 600, size: 64, color: '#9a9a9a' });
    const oldMeta = await sharp(oldBuf).metadata();
    const strike = Buffer.from(`<svg width="${oldMeta.width}" height="${oldMeta.height}"><line x1="0" y1="${oldMeta.height / 2}" x2="${oldMeta.width}" y2="${oldMeta.height / 2}" stroke="#9a9a9a" stroke-width="5"/></svg>`);
    layers.push(await centered(await sharp(oldBuf).composite([{ input: strike }]).png().toBuffer(), y));
    y += oldMeta.height + 5;
    layers.push(await centered(await renderText({ text: formatTL(sale), fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 900, size: 124, color: ORANGE }), y));

    const badgeText = await renderText({ text: `${toFaDigits(pct)}٪ تخفیف`, fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 420, size: 60, color: '#ffffff' });
    const bm = await sharp(badgeText).metadata();
    const bw = bm.width + 60, bh = bm.height + 30;
    const badgeBg = Buffer.from(`<svg width="${bw}" height="${bh}"><rect width="${bw}" height="${bh}" rx="${bh / 2}" ry="${bh / 2}" fill="${ORANGE}"/></svg>`);
    const badge = await sharp(badgeBg).composite([{ input: badgeText, left: 30, top: 15 }]).png().toBuffer();
    layers.push({ input: badge, left: W - bw - 90, top: 215 });
  } else {
    layers.push(await centered(await renderText({ text: formatTL(sale ?? price), fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 900, size: 124, color: ORANGE }), y));
  }

  return sharp({ create: { width: W, height: H, channels: 4, background: BG_DARK } }).composite(layers).jpeg({ quality: 92 }).toBuffer();
}

async function buildOutroSlide() {
  const layers = [];
  const logo = await sharp(LOGO_PATH).resize({ width: 640 }).toBuffer();
  layers.push(await centered(logo, 640));
  layers.push(await centered(await renderText({ text: 'همین الان در شیلیستا ببین', fontFile: FONT_BLACK, fontFamily: 'Vazirmatn Black', width: 960, height: 130, color: '#ffffff' }), 1000));
  layers.push(await centered(await renderText({ text: 'shilista.com', fontFile: FONT_BOLD, fontFamily: 'Vazirmatn Bold', width: 700, height: 100, color: GOLD }), 1160));
  return sharp({ create: { width: W, height: H, channels: 4, background: BG_DARK } }).composite(layers).jpeg({ quality: 92 }).toBuffer();
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 32 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${String(stderr).split('\n').slice(-6).join(' ')}`));
      else resolve();
    });
  });
}

// Slow zoom in or out, alternating per slide (zoompan on a 2x upscale so
// the motion doesn't jitter).
function motionFilter(i, seconds) {
  const frames = Math.round(seconds * FPS);
  const zoom = i % 2 === 0 ? "min(zoom+0.0009,1.12)" : "if(eq(on,0),1.12,max(zoom-0.0009,1))";
  return `scale=${W * 2}:${H * 2},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p,setsar=1`;
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

    const filename = `ig-${prefix}-${Date.now()}.mp4`;
    const outFile = path.join(UPLOADS_DIR, filename);
    await runFfmpeg([
      '-y', ...inputs,
      '-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-filter_complex', filters.join(';'),
      '-map', `[${last}]`, '-map', `${slides.length}:a`,
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

module.exports = { buildReel, buildProductSlide };
