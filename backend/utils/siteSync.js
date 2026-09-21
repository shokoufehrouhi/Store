// Shared, reusable per-site sync logic — used by both the daily cron
// scheduler (backend/scheduler.js) and the manual "Sync Now" buttons in the
// admin panel Sites tab (POST /admin/sites/:id/sync-import|sync-stock).
const prisma = require('../prisma/client');
const importers = require('./siteImport');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function withBrowser(fn) {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function readSiteStock(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  return page.evaluate(() => (
    window.PRODUCT_DETAIL_SIZE_DATA
      ? window.PRODUCT_DETAIL_SIZE_DATA.map(s => ({ size: s.Size, stock: s.StockQuantity }))
      : null
  ));
}

// Checks live per-size stock for every product imported from this site and
// marks fully-sold-out products stock=0 / tag='sold_out'.
async function checkSiteStock(site) {
  const products = await prisma.products.findMany({
    where: { supplier_shop_name: site.name, product_link: { not: null }, is_active: true },
  });
  const results = [];
  if (!products.length) return results;

  await withBrowser(async (page) => {
    for (const p of products) {
      try {
        const sizes = await readSiteStock(page, p.product_link);
        if (!sizes) { results.push({ id: p.id, name: p.name_tr, status: 'skipped (no data)' }); continue; }
        const totalStock = sizes.reduce((sum, s) => sum + (s.stock || 0), 0);
        if (totalStock === 0) {
          if (p.tag !== 'sold_out' || p.stock !== 0) {
            await prisma.products.update({
              where: { id: p.id },
              data: { stock: 0, tag: 'sold_out', is_dirty: true, updated_at: new Date() },
            });
          }
          results.push({ id: p.id, name: p.name_tr, status: 'sold_out' });
        } else {
          results.push({ id: p.id, name: p.name_tr, status: `ok (stock=${totalStock})` });
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
  return withBrowser(page => importer(page, site, opts));
}

module.exports = { checkSiteStock, importSite, withBrowser };
