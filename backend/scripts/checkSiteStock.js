// Runs once a day via cron. For products imported from an active site
// (products.supplier_shop_name matching an active row in `sites`), visits the
// source product page with a real headless browser (the source sites block
// plain HTTP requests) and reads live per-size stock. If every size is out of
// stock on the source, marks the product stock=0 and tags it 'sold_out'.
const prisma = require('../prisma/client');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function readSiteStock(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  return page.evaluate(() => (
    window.PRODUCT_DETAIL_SIZE_DATA
      ? window.PRODUCT_DETAIL_SIZE_DATA.map(s => ({ size: s.Size, stock: s.StockQuantity }))
      : null
  ));
}

(async () => {
  const sites = await prisma.sites.findMany({ where: { is_active: true } });
  const siteNames = sites.map(s => s.name);
  if (!siteNames.length) { console.log(`[${new Date().toISOString()}] no active sites, nothing to check`); return; }

  const products = await prisma.products.findMany({
    where: { supplier_shop_name: { in: siteNames }, product_link: { not: null }, is_active: true },
  });
  if (!products.length) { console.log(`[${new Date().toISOString()}] no site-linked products to check`); return; }

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    for (const p of products) {
      try {
        const sizes = await readSiteStock(page, p.product_link);
        if (!sizes) { console.log(`[skip] #${p.id} ${p.name_tr} — no stock data on page`); continue; }
        const totalStock = sizes.reduce((sum, s) => sum + (s.stock || 0), 0);
        if (totalStock === 0) {
          if (p.tag !== 'sold_out' || p.stock !== 0) {
            await prisma.products.update({
              where: { id: p.id },
              data: { stock: 0, tag: 'sold_out', is_dirty: true, updated_at: new Date() },
            });
            console.log(`[sold_out] #${p.id} ${p.name_tr}`);
          } else {
            console.log(`[still sold_out] #${p.id} ${p.name_tr}`);
          }
        } else {
          console.log(`[ok] #${p.id} ${p.name_tr} — site stock=${totalStock}`);
        }
      } catch (err) {
        console.log(`[error] #${p.id} ${p.name_tr} — ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  await prisma.$disconnect();
})().catch(err => { console.error(err); process.exit(1); });
