// The "shopping assistant" reel (user's choice, 2026-10-17, from the
// prompt-motion.com "food craving launch film" prompt; only for the 20:00
// slot): a request is typed into a chat, a shopping bag tosses the
// products' photos, an orange flood brings in their cards, the strip lands
// on the biggest discount, it's added to the cart and the outro says how
// much off it is. ~16s, 1080x1920, no music like the other reels.
//
// The motion lives in chatReel/chatReel.html, where every frame is a pure
// function of time (seek(t)): Puppeteer screenshots each frame and
// ffmpeg-static joins them, so nothing extra (no Remotion licence) is needed.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { displayName } = require('./storyBuilder');

const TEMPLATE = path.join(__dirname, 'chatReel', 'chatReel.html');
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
const FPS = 30;

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

// The card list for the page: the biggest discount is the pick, placed so
// the strip slides across the others before landing on it.
function reelData(products, groupKey) {
  const sorted = [...products].sort((a, b) => cutOf(b) - cutOf(a));
  const best = sorted[0];
  const rest = sorted.slice(1);
  const pick = products.length >= 4 ? products.length - 2 : products.length - 1;
  const ordered = [...rest.slice(0, pick), best, ...rest.slice(pick)];
  const copy = COPY[groupKey] || COPY.women;
  const pct = toFaDigits(cutOf(best));
  return {
    products: ordered.map((p) => ({
      brand: String(p.brand || 'Shilista'),
      name: displayName(p),
      price: Number(p.price),
      sale: Number(p.discounted_price),
      img: 'file://' + path.join(UPLOADS_DIR, path.basename(p.product_media[0].url)),
    })),
    pick,
    lines: copy.lines,
    reply: `پیداش کردم! ${best.brand || 'Shilista'} با ${pct}٪ تخفیف.`,
    out1: copy.out1,
    out2: `حالا با ${pct}٪ تخفیف مال توئه.`,
  };
}

// Builds the reel for `products` (3-5, discounted, with a photo on disk)
// and returns its /uploads/... path.
async function buildChatReel(products, { groupKey, prefix = 'reel-chat' }) {
  const data = reelData(products, groupKey);
  const filename = `ig-${prefix}-${Date.now()}.mp4`;
  const outFile = path.join(UPLOADS_DIR, filename);

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
  });
  let ff;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.goto('file://' + TEMPLATE, { waitUntil: 'load' });
    await page.evaluate(async (d) => {
      await document.fonts.ready;
      window.setup(d);
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    }, data);
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src));
    if (broken.length) throw new Error(`chat reel: images failed to load: ${broken.join(', ')}`);

    const dur = await page.evaluate(() => window.DURATION);
    const frames = Math.round(dur * FPS);
    let stderr = '';
    ff = spawn(ffmpegPath, [
      '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-f', 'lavfi', '-t', dur.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v', '-map', '1:a',
      // 2 threads: the server also runs the site (same as reelBuilder.js).
      '-threads', '2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart',
      outFile,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    const done = new Promise((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-4).join(' | ')}`))));
    });
    // An ffmpeg that died mid-way would otherwise leave a drain wait hanging forever.
    const closed = done.catch(() => {});
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.seek(t), f / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (ff.exitCode !== null) break;
      if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), closed]);
    }
    ff.stdin.end();
    await done;
    return `/uploads/${filename}`;
  } catch (err) {
    if (ff && ff.exitCode === null) ff.kill('SIGKILL');
    fs.rmSync(outFile, { force: true });
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { buildChatReel, reelData };
