// Shared, reusable per-site sync logic — used by both the daily cron
// scheduler (backend/scheduler.js) and the manual "Sync Now" buttons in the
// admin panel Sites tab (POST /admin/sites/:id/sync-import|sync-stock).
const prisma = require('../prisma/client');
const importers = require('./siteImport');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// A page reused across many dozens of navigations (a full multi-category,
// paginated import can hit 50-1000+) eventually crashes on this VPS's tight
// RAM — Puppeteer starts throwing "detached Frame" on every subsequent call.
// PageManager recycles the underlying page every `recycleEvery` navigations,
// and force-recycles + retries once on a detached-frame error specifically,
// so callers just do `await pm.goto(url, opts)` without worrying about it.
function createPageManager(browser, { recycleEvery = 12 } = {}) {
  let page = null;
  let navCount = 0;

  async function open() {
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    navCount = 0;
  }

  return {
    async goto(url, opts) {
      if (!page || page.isClosed() || navCount >= recycleEvery) {
        if (page && !page.isClosed()) await page.close().catch(() => {});
        await open();
      }
      navCount++;
      try {
        await page.goto(url, opts);
      } catch (err) {
        if (/detached Frame|Target closed|Session closed/i.test(err.message)) {
          await open();
          await page.goto(url, opts);
        } else {
          throw err;
        }
      }
      return page;
    },
    async close() {
      if (page && !page.isClosed()) await page.close().catch(() => {});
    },
  };
}

// `browser` is also passed to `fn` (most callers only take `pm` and ignore
// it) so a scraper that wants its own bounded concurrency — several
// PageManagers sharing this one already-launched browser, rather than
// launching several full browsers — can create more of them via
// `createPageManager(browser)` itself. See Lefties() in siteImport.js.
async function withBrowser(fn) {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const pm = createPageManager(browser);
  try {
    return await fn(pm, browser);
  } finally {
    await pm.close();
    await browser.close();
  }
}

async function readSiteData(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  return page.evaluate(() => {
    const sizes = window.PRODUCT_DETAIL_SIZE_DATA
      ? window.PRODUCT_DETAIL_SIZE_DATA.map(s => ({ size: s.Size, stock: s.StockQuantity }))
      : null;

    let originalPrice = null;
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      try { const d = JSON.parse(s.textContent); if (d.offers?.price) originalPrice = Number(d.offers.price); } catch (e) {}
    }
    const priceText = document.querySelector('.product-detail__price')?.textContent || '';
    const discMatch = priceText.match(/Sepette\s*([\d.,]+)\s*TL/i);
    const discountedPrice = discMatch ? Number(discMatch[1].replace(',', '.')) : null;

    return { sizes, originalPrice, discountedPrice };
  });
}

// Checks live per-size stock (and current price) for every product imported
// from this site: marks fully-sold-out products stock=0 / tag='sold_out',
// and re-prices cost_price/price/discounted_price if the site's price moved
// — using this site's markup_percent, same formula as at import time.
async function checkSiteStock(site) {
  const products = await prisma.products.findMany({
    where: { supplier_shop_name: site.name, product_link: { not: null }, is_active: true },
  });
  const results = [];
  if (!products.length) return results;

  await withBrowser(async (pm) => {
    for (const p of products) {
      try {
        const data = await readSiteData(pm, p.product_link);
        if (!data.sizes) { results.push({ id: p.id, name: p.name_tr, status: 'skipped (no data)' }); continue; }
        const totalStock = data.sizes.reduce((sum, s) => sum + (s.stock || 0), 0);

        const priceUpdate = {};
        if (data.originalPrice) {
          const newCost = data.discountedPrice ?? data.originalPrice;
          const newDiscounted = Math.round(newCost * (1 + site.markup_percent / 100) * 100) / 100;
          if (Number(p.price) !== data.originalPrice) priceUpdate.price = data.originalPrice;
          if (Number(p.cost_price) !== newCost) priceUpdate.cost_price = newCost;
          if (Number(p.discounted_price) !== newDiscounted) priceUpdate.discounted_price = newDiscounted;
        }

        if (totalStock === 0) {
          if (p.tag !== 'sold_out' || p.stock !== 0 || Object.keys(priceUpdate).length) {
            await prisma.products.update({
              where: { id: p.id },
              data: { ...priceUpdate, stock: 0, tag: 'sold_out', is_dirty: true, updated_at: new Date() },
            });
          }
          results.push({ id: p.id, name: p.name_tr, status: 'sold_out' });
        } else {
          if (Object.keys(priceUpdate).length) {
            await prisma.products.update({
              where: { id: p.id },
              data: { ...priceUpdate, is_dirty: true, updated_at: new Date() },
            });
          }
          results.push({ id: p.id, name: p.name_tr, status: `ok (stock=${totalStock})${Object.keys(priceUpdate).length ? ', repriced' : ''}` });
        }
      } catch (err) {
        results.push({ id: p.id, name: p.name_tr, status: `error: ${err.message}` });
      }
    }
  });
  return results;
}

// Imports new discounted products from this site. Each site needs its own
// scraper module in ./siteImport (matched by site.name) since every site has
// a different page structure — there is no generic "works for any site"
// scraper. Sites without a matching module throw a clear error.
async function importSite(site, opts = {}) {
  const importer = importers[site.name];
  if (!importer) throw new Error(`no importer implemented for site "${site.name}"`);
  // browser/createPageManager: see withBrowser's own comment — only Lefties
  // currently uses either, every other importer's opts.limit-only signature
  // just ignores the extra fields.
  return withBrowser((pm, browser) => importer(pm, site, { ...opts, browser, createPageManager }));
}

module.exports = { checkSiteStock, importSite, withBrowser };
