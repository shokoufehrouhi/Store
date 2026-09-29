// In-process scheduler for the two site-sync jobs. Their time is a single
// global setting (sync_settings, one row) — at that time, every active site
// is checked/imported, not a per-site schedule. Per-site control is only the
// manual "Sync Now" button (see sitesController.js#syncImport/syncStock).
// Runs entirely inside the API process — no system crontab entry needed, so
// changing the schedule in the admin panel takes effect immediately.
const prisma = require('./prisma/client');
const { checkSiteStock, importSite, cleanupStaleChromeProfiles } = require('./utils/siteSync');
const { syncSubcategoryActiveState } = require('./utils/subcategorySync');
const { buildSingleProductStory, buildCollageStory } = require('./utils/storyBuilder');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, 'public/uploads');

let ranThisMinute = null; // 'HH:MM' of the last minute we already acted on
let ranSoldOutSweepOn = null; // 'YYYY-MM-DD' of the last day we ran the sold-out expiry sweep
let ranMorningOn = null; // 'YYYY-MM-DD' -- covers both 11:00 stories (single + collage)
let ranEveningSingleOn = null; // 'YYYY-MM-DD'
let ranEveningCollageOn = null; // 'YYYY-MM-DD'
let lastMorningSingleProductId = null; // excluded from the 11:00 collage so the two don't repeat a product
let lastEveningSingleProductId = null; // excluded from the 19:30 collage, same reason

// 11:00 -- single-product + collage together. 19:00 -- a second, differently
// worded single-product story. 19:30 -- a second collage. Four stories/day
// total, each a separate draft in admin.html's Instagram Content tab.
const MORNING_TIME = '11:00';
const EVENING_SINGLE_TIME = '19:00';
const EVENING_COLLAGE_TIME = '19:30';

function currentHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function currentDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// A product stays visibly sold_out for a month (sold_out_at is stamped once,
// on the transition into sold_out — see resolveProductTag's callers and
// checkSiteStock — not re-stamped on every check while it stays sold out).
// Past that, it's deactivated AND published immediately here: every other
// admin change waits for a manual "Publish" click (a deliberate review step),
// but nothing about a product having sat sold out for a month needs a human
// to confirm it should stop showing, so this flips is_live itself rather
// than just marking it dirty and waiting for the next unrelated publish.
async function deactivateExpiredSoldOutProducts() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);

  const expired = await prisma.products.findMany({
    where: { tag: 'sold_out', sold_out_at: { lte: cutoff }, is_active: true },
    select: { id: true, subcategory_id: true, product_categories: { select: { subcategory_id: true } } },
  });
  if (!expired.length) return;

  const subcategoryIds = new Set();
  for (const p of expired) {
    if (p.subcategory_id) subcategoryIds.add(p.subcategory_id);
    for (const ec of p.product_categories) if (ec.subcategory_id) subcategoryIds.add(ec.subcategory_id);
  }

  await prisma.products.updateMany({
    where: { id: { in: expired.map(p => p.id) } },
    data: { is_active: false, is_live: false, is_dirty: false, updated_at: new Date() },
  });
  for (const id of subcategoryIds) await syncSubcategoryActiveState(id);

  console.log(`[scheduler] auto-deactivated ${expired.length} product(s) sold out for over a month`);
}

// Product ids that already appeared in a story within the last `days` days
// (drawn straight from instagram_content's own history) — used to keep
// eligibleStoryProducts from repeating the same product/photo across
// consecutive stories.
async function recentlyUsedProductIds(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = await prisma.instagram_content.findMany({
    where: { created_at: { gte: cutoff } },
    select: { product_ids: true },
  });
  const ids = new Set();
  for (const row of rows) for (const id of row.product_ids || []) ids.add(id);
  return ids;
}

// Pool of postable products, freshest first (recent imports/edits are the
// most relevant thing to promote day-to-day) — pulled a bit deeper than
// `limit` and shuffled so the same top few items don't lead every story.
// Excludes anything used in a story this week so the same product/photo
// doesn't keep repeating -- falls back to ignoring that exclusion only if
// it would otherwise leave too few candidates to fill `limit`.
async function eligibleStoryProducts(limit, excludeIds = []) {
  const recent = await recentlyUsedProductIds();
  const baseWhere = {
    is_active: true,
    is_live: true,
    tag: { not: 'sold_out' },
    product_media: { some: {} },
  };

  async function fetchPool(exclude) {
    const pool = await prisma.products.findMany({
      where: { ...baseWhere, id: { notIn: exclude } },
      include: { product_media: { take: 1 } },
      orderBy: { updated_at: 'desc' },
      take: Math.max(limit * 10, 30),
    });
    // A product_media row pointing at a file that's actually missing on disk
    // (seen in production data) would otherwise crash sharp mid-render —
    // filter those out here rather than letting generateMorning/EveningStory
    // fail silently for the whole day.
    return pool.filter(p => {
      const media = p.product_media[0];
      return media && fs.existsSync(path.join(UPLOADS_DIR, path.basename(media.url)));
    });
  }

  let withFiles = await fetchPool([...new Set([...excludeIds, ...recent])]);
  if (withFiles.length < limit) withFiles = await fetchPool(excludeIds); // catalog too small to also avoid repeats

  // Same-name duplicate catalog rows (seen in production data) would
  // otherwise show up twice in one story even though they're distinct ids.
  const seenNames = new Set();
  withFiles = withFiles.filter(p => {
    if (seenNames.has(p.name_fa)) return false;
    seenNames.add(p.name_fa);
    return true;
  });

  for (let i = withFiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [withFiles[i], withFiles[j]] = [withFiles[j], withFiles[i]];
  }
  return withFiles.slice(0, limit);
}

function productLink(product) {
  return `${process.env.FRONTEND_URL}/product.html?id=${product.id}`;
}

// Persists a generated story image under public/uploads (kept around
// indefinitely, unlike the old flow's temp file) and returns its public path.
function saveGeneratedStoryImage(buffer, prefix) {
  const filename = `ig-${prefix}-${Date.now()}.jpg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

// Generates the story image and saves it as a draft row for admin review —
// it does NOT post to Instagram. Actual posting only happens when an admin
// clicks "Deploy" on the card in admin.html's Instagram Content tab (see
// instagramContentController.js#deployStory), since this hits the one real,
// shared Instagram account with no staging/production isolation.
async function generateSingleStory(slot, headline, prefix, excludeIds = []) {
  const [product] = await eligibleStoryProducts(1, excludeIds);
  if (!product) return null;
  const buffer = await buildSingleProductStory(product, { headline });
  const imageUrl = saveGeneratedStoryImage(buffer, prefix);
  await prisma.instagram_content.create({
    data: {
      kind: 'single',
      slot,
      scheduled_date: new Date(currentDateStr()),
      image_url: imageUrl,
      product_ids: [product.id],
      link: productLink(product),
    },
  });
  return product.id;
}

async function generateCollageStory(slot, headline, prefix, excludeIds = []) {
  const products = await eligibleStoryProducts(4, excludeIds);
  if (products.length < 2) return; // not enough distinct products for a collage today
  const buffer = await buildCollageStory(products, { headline });
  const imageUrl = saveGeneratedStoryImage(buffer, prefix);
  await prisma.instagram_content.create({
    data: {
      kind: 'collage',
      slot,
      scheduled_date: new Date(currentDateStr()),
      image_url: imageUrl,
      product_ids: products.map(p => p.id),
      link: `${process.env.FRONTEND_URL}/index.html`,
    },
  });
}

async function generateMorningStories() {
  lastMorningSingleProductId = await generateSingleStory(
    MORNING_TIME, 'پیشنهاد امروز شیلیستا', 'morning-single'
  );
  const excludeIds = lastMorningSingleProductId ? [lastMorningSingleProductId] : [];
  await generateCollageStory(MORNING_TIME, 'محصولات جدید ما', 'morning-collage', excludeIds);
}

async function generateEveningSingleStory() {
  lastEveningSingleProductId = await generateSingleStory(
    EVENING_SINGLE_TIME, 'پیشنهاد ویژه‌ی امشب', 'evening-single'
  );
}

async function generateEveningCollageStory() {
  const excludeIds = lastEveningSingleProductId ? [lastEveningSingleProductId] : [];
  await generateCollageStory(EVENING_COLLAGE_TIME, 'انتخاب‌های امشب', 'evening-collage', excludeIds);
}

async function runImport(site) {
  try {
    await prisma.sites.update({ where: { id: site.id }, data: { import_in_progress: true } });
    const result = await importSite(site, { limit: 30 });
    const ok = result.imported.filter(r => !r.error).length;
    const failed = result.imported.filter(r => r.error).length;
    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `imported ${ok}, ${failed} errors` },
    });
  } catch (err) {
    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `error: ${err.message}` },
    }).catch(() => {});
  }
}

async function runStockCheck(site) {
  try {
    await prisma.sites.update({ where: { id: site.id }, data: { stock_check_in_progress: true } });
    const results = await checkSiteStock(site);
    const soldOut = results.filter(r => r.status === 'sold_out').length;
    await prisma.sites.update({
      where: { id: site.id },
      data: { stock_check_in_progress: false, last_stock_check_at: new Date(), last_stock_check_status: `checked ${results.length}, ${soldOut} sold out` },
    });
  } catch (err) {
    await prisma.sites.update({
      where: { id: site.id },
      data: { stock_check_in_progress: false, last_stock_check_at: new Date(), last_stock_check_status: `error: ${err.message}` },
    }).catch(() => {});
  }
}

async function tick() {
  const today = currentDateStr();
  if (ranSoldOutSweepOn !== today) {
    ranSoldOutSweepOn = today;
    await deactivateExpiredSoldOutProducts().catch(err => console.error('[scheduler] sold-out expiry sweep failed:', err));
  }

  const nowHHMM = currentHHMM();

  // Generation only -- never posts by itself. Each generated row sits as a
  // 'draft' in admin.html's Instagram Content tab until a human clicks
  // Deploy on that specific card (see instagramContentController.js).
  if (nowHHMM === MORNING_TIME && ranMorningOn !== today) {
    ranMorningOn = today;
    await generateMorningStories().catch(err => console.error('[scheduler] morning story generation failed:', err));
  }
  if (nowHHMM === EVENING_SINGLE_TIME && ranEveningSingleOn !== today) {
    ranEveningSingleOn = today;
    await generateEveningSingleStory().catch(err => console.error('[scheduler] evening single story generation failed:', err));
  }
  if (nowHHMM === EVENING_COLLAGE_TIME && ranEveningCollageOn !== today) {
    ranEveningCollageOn = today;
    await generateEveningCollageStory().catch(err => console.error('[scheduler] evening collage story generation failed:', err));
  }

  if (ranThisMinute === nowHHMM) return; // already handled this minute
  const settings = await prisma.sync_settings.findUnique({ where: { id: 1 } });
  if (!settings) return;
  if (settings.import_schedule_time !== nowHHMM && settings.stock_check_schedule_time !== nowHHMM) return;

  ranThisMinute = nowHHMM;
  const sites = await prisma.sites.findMany({ where: { is_active: true } });
  // Sequential, not fire-and-forget: each site gets its own full Puppeteer/
  // Chrome instance (see backend/utils/siteSync.js#withBrowser), and this
  // used to kick off every active site's import at once — confirmed live
  // that at import-heavy site counts (Lefties alone can run 1-2+ hours with
  // no candidate cap, see siteImport.js's own history) that means several
  // simultaneous Chrome processes competing for this VPS's CPU/RAM, not
  // just a slow individual run. One site at a time costs total wall-clock
  // time instead, which is the right tradeoff for an unattended overnight
  // job — nothing is waiting on it to finish quickly.
  if (settings.import_schedule_time === nowHHMM) {
    for (const site of sites) await runImport(site);
  }
  if (settings.stock_check_schedule_time === nowHHMM) {
    for (const site of sites) await runStockCheck(site);
  }
}

function start() {
  // A sync mid-flight when the process restarts (deploy, crash, manual
  // restart) never gets to write its final status — the in_progress flag
  // would otherwise stay stuck true forever, permanently disabling that
  // site's Sync Now buttons. Nothing can genuinely be in progress right
  // after boot, so clear both flags for every site once at startup.
  prisma.sites.updateMany({
    where: { OR: [{ import_in_progress: true }, { stock_check_in_progress: true }] },
    data: { import_in_progress: false, stock_check_in_progress: false },
  }).catch(err => console.error('[scheduler] failed to clear stale in-progress flags:', err));

  // Same reasoning: a leftover Puppeteer temp profile dir in /tmp is only
  // possible if the process that launched it is dead, which is guaranteed
  // true for every one of them right after this process just booted.
  cleanupStaleChromeProfiles().catch(err => console.error('[scheduler] failed to clean up stale Chrome profiles:', err));

  setInterval(() => { tick().catch(err => console.error('[scheduler] tick error:', err)); }, 60 * 1000);
  console.log('[scheduler] site sync scheduler started');
}

module.exports = { start };
