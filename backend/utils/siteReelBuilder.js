// The weekly site reel (user's choice, 2026-10-17, from the prompt-motion.com
// "landing page 3D scroll" prompt; Thursdays 21:30): a 3D fly-over of the
// live home page. The page lies on a studio floor, the camera glides down it
// while the product photos stand up, rises overhead, dives into the hero
// and lands it as a card under the title. ~14.5s, 1080x1920, no music.
//
// The home page is shot fresh each time (full page, 1440 wide, the hero
// banner caught in its bento) so the reel shows that week's products; the
// motion lives in siteReel/siteReel.html (rendered by htmlReel.js).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { renderHtmlReel } = require('./htmlReel');

const TEMPLATE = path.join(__dirname, 'siteReel', 'siteReel.html');
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
const PAGE_W = 1440, MAX_PAGE_H = 3800;

async function captureHomePage(siteUrl, outFile) {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    // Our own visit isn't a real one: keep it out of the view stats.
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().includes('/api/track') ? req.respond({ status: 204, body: '' }) : req.continue()));
    await page.evaluateOnNewDocument(() => localStorage.setItem('lang_v2', 'fa'));
    await page.setViewport({ width: PAGE_W, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${siteUrl.replace(/\/$/, '')}/index.html`, { waitUntil: 'networkidle2', timeout: 90000 });
    // Lazy images further down load as they scroll into view.
    for (let y = 0; y < 4000; y += 600) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await new Promise((r) => setTimeout(r, 400));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const rects = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; };
      const banner = document.getElementById('hero-media');
      return {
        banner: banner && banner.offsetWidth ? r(banner) : null,
        cards: [...document.querySelectorAll('.product-card img')].slice(0, 16).map(r).filter((c) => c.w > 0),
        height: document.documentElement.scrollHeight,
      };
    });
    // The whole page in one viewport (a tall capture of a short viewport
    // brings in off-screen drawers and overlays).
    await page.setViewport({ width: PAGE_W, height: rects.height, deviceScaleFactor: 1 });
    await page.evaluate(async () => {
      await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
    });
    // Catch the animated banner in its bento (its discount chips showing);
    // without it (fewer than 6 products) the page is shot as it is.
    await page.waitForFunction(() => [...document.querySelectorAll('.hb-chip')]
      .filter((c) => c.style.visibility === 'visible' && parseFloat(c.style.transform.slice(6)) > 0.98).length >= 6,
    { timeout: 25000, polling: 30 }).catch(() => {});
    const ph = Math.min(MAX_PAGE_H, rects.height);
    await page.screenshot({ path: outFile, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: PAGE_W, height: ph } });
    rects.cards = rects.cards.filter((c) => c.y + c.h < ph);
    return { rects, ph };
  } finally {
    await browser.close().catch(() => {});
  }
}

// Builds the reel from the live home page and returns its /uploads/... path.
async function buildSiteReel({ siteUrl = process.env.FRONTEND_URL, prefix = 'reel-site' } = {}) {
  if (!siteUrl) throw new Error('site reel: FRONTEND_URL is not set');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shilista-sitereel-'));
  try {
    const shot = path.join(workDir, 'page.jpg');
    const { rects, ph } = await captureHomePage(siteUrl, shot);
    if (rects.cards.length < 3) throw new Error(`site reel: only ${rects.cards.length} product cards on the page`);
    const filename = `ig-${prefix}-${Date.now()}.mp4`;
    await renderHtmlReel(TEMPLATE, { page: 'file://' + shot, ph, rects }, path.join(UPLOADS_DIR, filename));
    return `/uploads/${filename}`;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { buildSiteReel };
