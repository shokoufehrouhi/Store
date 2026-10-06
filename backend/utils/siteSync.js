// Shared, reusable per-site sync logic — used by both the daily cron
// scheduler (backend/scheduler.js) and the manual "Sync Now" buttons in the
// admin panel Sites tab (POST /admin/sites/:id/sync-import|sync-stock).
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
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
    // A crashed/detached browser process can make close() itself throw,
    // which used to skip Puppeteer's own temp-profile-dir cleanup (this
    // block is a finally already, but an uncaught throw here would still
    // replace whatever error `fn` threw with this one, hiding the real
    // cause) — see cleanupStaleChromeProfiles() below for the case where
    // the whole process dies before even this line runs.
    await browser.close().catch(() => {});
  }
}

// puppeteer.launch() drops each browser's temp profile dir straight in the
// OS tmpdir (e.g. /tmp/puppeteer_dev_chrome_profile-*); browser.close() in
// withBrowser's finally normally removes it, but nothing runs that finally
// if the whole process dies mid-import (crash, OOM kill, `pm2 restart`) —
// those dirs (each tens to hundreds of MB) then sit there forever and can
// fill the disk (this took staging+production fully down on 2026-09-28).
// Same reasoning as scheduler.js's stale in_progress flags: nothing can
// genuinely have a live Chrome instance right after this process just
// booted, so anything matching here is guaranteed orphaned.
async function cleanupStaleChromeProfiles() {
  const dir = os.tmpdir();
  let entries;
  try { entries = await fs.readdir(dir); } catch { return; }
  for (const entry of entries) {
    if (!entry.startsWith('puppeteer_dev_chrome_profile-')) continue;
    await fs.rm(path.join(dir, entry), { recursive: true, force: true }).catch(() => {});
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
  // readSiteData below only understands Defacto's page structure (every
  // other site just comes back "skipped (no data)"), and for Mavi it'd also
  // mean one page navigation per imported product through a Cloudflare WAF
  // that hard-blocks rapid navigations — which would then break Mavi's own
  // import too, since that shares the same VPS IP. See Mavi() in siteImport.js.
  if (site.name === 'Mavi') return results;
  // mClub's whole catalog (price, discount, per-shade stock) comes from one
  // API response — see checkMClubStock in siteImport.js.
  if (site.name === 'MClub') return importers.checkMClubStock(site, products);
  // Same for ArmaLife — see checkArmaLifeStock in siteImport.js.
  if (site.name === 'ArmaLife') return importers.checkArmaLifeStock(site, products);
  // And Mango — see checkMangoStock in siteImport.js.
  if (site.name === 'Mango') return importers.checkMangoStock(site, products);
  // And Colin's — its sale list carries prices and in-stock sizes.
  if (site.name === 'Colins') return importers.checkColinsStock(site, products);
  // Lefties' API only answers from inside one of its pages, hence the browser.
  if (site.name === 'Lefties') return withBrowser((pm) => importers.checkLeftiesStock(site, products, pm));
  if (site.name === 'Oysho') return withBrowser((pm) => importers.checkOyshoStock(site, products, pm));
  if (site.name === 'Bershka') return withBrowser((pm) => importers.checkBershkaStock(site, products, pm));
  if (site.name === 'PullAndBear') return withBrowser((pm) => importers.checkPullAndBearStock(site, products, pm));
  if (site.name === 'Stradivarius') return withBrowser((pm) => importers.checkStradivariusStock(site, products, pm));

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
              data: {
                ...priceUpdate, stock: 0, tag: 'sold_out', is_dirty: true, updated_at: new Date(),
                // Only stamped on the actual transition into sold_out, not on
                // every re-check while it stays sold out — see scheduler.js's
                // 5-days-later auto-deactivation, which reads this.
                ...(p.tag !== 'sold_out' ? { sold_out_at: new Date() } : {}),
              },
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
// Per-site override of the per-run import limit callers pass (30): sites
// with a big backlog worth catching up on faster. ArmaLife imports its
// whole catalog (~500 models on 2026-10-05) and Lefties now scans every
// category; at 30 a run, ArmaLife alone would take over two weeks.
// Colin's had ~3,200 importable discounted models on 2026-10-06.
const SITE_IMPORT_LIMITS = { ArmaLife: 100, Lefties: 50, Colins: 100 };

async function importSite(site, opts = {}) {
  const importer = importers[site.name];
  if (!importer) throw new Error(`no importer implemented for site "${site.name}"`);
  if (SITE_IMPORT_LIMITS[site.name]) opts = { ...opts, limit: SITE_IMPORT_LIMITS[site.name] };
  // Subcategories are matched by key (see MENU_SUBCATEGORY_DEFS); refresh
  // their ids so ones created since the last run are used.
  await importers.loadSubcategoryIds();
  // browser/createPageManager: see withBrowser's own comment — only Lefties
  // currently uses either, every other importer's opts.limit-only signature
  // just ignores the extra fields.
  return withBrowser((pm, browser) => importer(pm, site, { ...opts, browser, createPageManager }));
}

// One-line summary for sites.last_import_status, shared by the scheduled
// import (scheduler.js#runImport) and the manual Sync Now button
// (sitesController.js#syncImport). Includes the first error's actual message
// -- before this only the error *count* was kept anywhere, so e.g. Mavi's
// "280 errors" run on 2026-09-30 left no way to tell what had gone wrong.
function importStatusText(result) {
  const errors = result.imported.filter(r => r.error);
  const ok = result.imported.length - errors.length;
  let text = `imported ${ok}, ${errors.length} errors, ${result.skipped || 0} skipped`;
  if (errors.length) {
    // Prisma's messages start with a multi-line code frame ("Invalid
    // `prisma.products.create()` invocation in ...") and only state the
    // actual reason on the last line -- that line is the useful part.
    const msg = String(errors[0].error);
    const reason = /^\s*Invalid `prisma/.test(msg) ? msg.trim().split('\n').filter(l => l.trim()).pop() : msg;
    text += ` — first error: ${reason.slice(0, 200)} (${errors[0].url || ''})`;
  }
  return text;
}

// Whether a site's name matches an importer in siteImport.js (shown on the
// admin Sites page). Importers are the capitalized exports (Defacto, Oysho,
// ...); the lowercase ones are helpers.
function hasImporter(name) {
  return /^[A-Z]/.test(name || '') && typeof importers[name] === 'function';
}

module.exports = { checkSiteStock, importSite, withBrowser, cleanupStaleChromeProfiles, importStatusText, hasImporter };
