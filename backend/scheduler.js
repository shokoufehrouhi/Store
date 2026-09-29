// In-process scheduler for the two site-sync jobs. Their time is a single
// global setting (sync_settings, one row) — at that time, every active site
// is checked/imported, not a per-site schedule. Per-site control is only the
// manual "Sync Now" button (see sitesController.js#syncImport/syncStock).
// Runs entirely inside the API process — no system crontab entry needed, so
// changing the schedule in the admin panel takes effect immediately.
//
// Imports were briefly staggered 2h apart per site (2026-09-29) to space out
// Instagram posting from new-product imports -- reverted the same day once
// the product-post queue got its own independent drip-feed rate + daily cap
// (see instagram_product_posts / maybePostQueuedProduct below), which made
// import timing irrelevant to Instagram safety. Staggering also had a real
// bug: each site got its own independently-checked time instead of one
// sequential loop, so a site whose import overran its 2h window (Lefties
// alone can take 1-2+ hours) could start overlapping with the next site's
// Chrome instance -- the exact CPU/RAM contention this file's original
// switch to sequential imports (missing-await fix, predates this feature)
// existed to prevent. Back to one shared time + a single sequential
// for-loop, which can't overlap no matter how long any one site takes.
const prisma = require('./prisma/client');
const { checkSiteStock, importSite, cleanupStaleChromeProfiles } = require('./utils/siteSync');
const { syncSubcategoryActiveState } = require('./utils/subcategorySync');
const { buildSingleProductStory, buildCollageStory } = require('./utils/storyBuilder');
const { deployStoryById } = require('./controllers/instagramContentController');
const { queueNewProductsForInstagram } = require('./utils/instagramProductQueue');
const { createFeedContainer, publishContainer } = require('./utils/instagramPublish');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, 'public/uploads');

let ranThisMinute = null; // 'HH:MM' of the last minute we already acted on
let ranSoldOutSweepOn = null; // 'YYYY-MM-DD' of the last day we ran the sold-out expiry sweep
let ranMorningGenOn = null; // 'YYYY-MM-DD' -- 10:00 generation of both morning drafts
let ranEveningGenOn = null; // 'YYYY-MM-DD' -- 18:00 generation of both evening drafts
let ranMorningSingleDeployOn = null; // 'YYYY-MM-DD'
let ranMorningCollageDeployOn = null; // 'YYYY-MM-DD'
let ranEveningSingleDeployOn = null; // 'YYYY-MM-DD'
let ranEveningCollageDeployOn = null; // 'YYYY-MM-DD'
let lastMorningSingleProductId = null; // excluded from the 11:30 collage so the two don't repeat a product
let lastEveningSingleProductId = null; // excluded from the 19:30 collage, same reason

// Generated as drafts a bit ahead of their actual post time (10:00 for the
// 11:00/11:30 pair, 18:00 for the 19:00/19:30 pair) so there's a review
// window in admin.html's Instagram Content tab -- then auto-deployed for
// real at the scheduled time unless a human already deployed or deleted it
// first (see autoDeploySlot). Manual Deploy still works at any point.
const GEN_MORNING_TIME = '10:00';
const GEN_EVENING_TIME = '18:00';
const MORNING_SINGLE_TIME = '11:00';
const MORNING_COLLAGE_TIME = '11:30';
const EVENING_SINGLE_TIME = '19:00';
const EVENING_COLLAGE_TIME = '19:30';

function currentHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function currentDateStr() {
  return new Date().toISOString().slice(0, 10);
}

const PRODUCT_POST_INTERVAL_MS = 10 * 60 * 1000; // drip-feed rate for new-product Instagram posts (6/hour)
const PRODUCT_POST_START_TIME = '08:00'; // don't start posting before this time each day

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

// Generates the story image and saves it as a draft row for admin review.
// This alone never posts to Instagram -- it just gives a review window
// before autoDeploySlot posts it for real at the scheduled slot time (or a
// human clicks "Deploy" early, or deletes it, in admin.html's Instagram
// Content tab). Either way it's the one real, shared Instagram account
// with no staging/production isolation.
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

async function generateMorningSingleStory() {
  lastMorningSingleProductId = await generateSingleStory(
    MORNING_SINGLE_TIME, 'پیشنهاد امروز شیلیستا', 'morning-single'
  );
}

async function generateMorningCollageStory() {
  const excludeIds = lastMorningSingleProductId ? [lastMorningSingleProductId] : [];
  await generateCollageStory(MORNING_COLLAGE_TIME, 'محصولات جدید ما', 'morning-collage', excludeIds);
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

// Auto-posts today's draft for a given slot, if one still exists and is
// still a draft -- a no-op if it was already manually deployed, deleted, or
// never generated (e.g. not enough eligible products that day).
async function autoDeploySlot(slot) {
  const row = await prisma.instagram_content.findFirst({
    where: { slot, status: 'draft', scheduled_date: new Date(currentDateStr()) },
    orderBy: { created_at: 'desc' },
  });
  if (!row) return;
  await deployStoryById(row.id);
}

async function runImport(site) {
  try {
    await prisma.sites.update({ where: { id: site.id }, data: { import_in_progress: true } });
    const result = await importSite(site, { limit: 30 });
    const ok = result.imported.filter(r => !r.error);
    const failed = result.imported.length - ok.length;

    // Queue up to this site's configured daily cap of today's new products
    // for an automatic Instagram feed post (drip-fed, see
    // maybePostQueuedProduct) -- not every single import, per-brand limit.
    await queueNewProductsForInstagram(site, result.imported);

    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `imported ${ok.length}, ${failed} errors` },
    });
  } catch (err) {
    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `error: ${err.message}` },
    }).catch(() => {});
  }
}

function buildProductCaption(product) {
  return `${product.name_fa}\n\n${product.name_en}\n\n🛍 shilista.com`;
}

async function postQueuedProductToInstagram(row) {
  const media = row.products.product_media[0];
  const imageUrl = `${process.env.FRONTEND_URL}${media.url}`;
  const caption = buildProductCaption(row.products);
  try {
    const creationId = await createFeedContainer(imageUrl, caption);
    const mediaId = await publishContainer(creationId);
    await prisma.instagram_product_posts.update({
      where: { id: row.id },
      data: { status: 'posted', ig_media_id: mediaId, posted_at: new Date(), error_message: null },
    });
  } catch (err) {
    await prisma.instagram_product_posts.update({
      where: { id: row.id },
      data: { status: 'failed', error_message: err.message },
    }).catch(() => {});
  }
}

// Sum of every active site's daily_ig_post_limit -- the hard ceiling on how
// many product posts go out in a single calendar day, independent of the
// drip-feed rate. Recomputed live (not cached) so changing a site's limit
// in the admin panel takes effect the same day.
async function totalDailyPostCap() {
  const sites = await prisma.sites.findMany({ where: { is_active: true }, select: { daily_ig_post_limit: true } });
  return sites.reduce((sum, s) => sum + s.daily_ig_post_limit, 0);
}

async function productPostsMadeToday() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return prisma.instagram_product_posts.count({
    where: { status: 'posted', posted_at: { gte: startOfDay } },
  });
}

// Posts at most one queued new-product row per PRODUCT_POST_INTERVAL_MS,
// derived from the last actual post time (not an in-memory timer, so it
// self-corrects across restarts instead of bursting) -- never before
// PRODUCT_POST_START_TIME each day, and never more than totalDailyPostCap()
// posts in a single calendar day, even if the queue has backlog from a
// slower day and the rate alone would allow more. Only considers products
// that have actually gone live (an admin publish can lag well behind
// import) -- skips (not blocks on) a row whose photo file is missing, same
// defensive pattern as eligibleStoryProducts.
async function maybePostQueuedProduct() {
  if (currentHHMM() < PRODUCT_POST_START_TIME) return;

  const last = await prisma.instagram_product_posts.findFirst({
    where: { status: 'posted' },
    orderBy: { posted_at: 'desc' },
  });
  if (last && Date.now() - new Date(last.posted_at).getTime() < PRODUCT_POST_INTERVAL_MS) return;

  const [postedToday, dailyCap] = await Promise.all([productPostsMadeToday(), totalDailyPostCap()]);
  if (postedToday >= dailyCap) return; // today's combined per-brand cap already reached

  const next = await prisma.instagram_product_posts.findFirst({
    where: { status: 'queued', products: { is_active: true, is_live: true } },
    orderBy: { created_at: 'asc' },
    include: { products: { include: { product_media: { take: 1 } } } },
  });
  if (!next) return;

  const media = next.products.product_media[0];
  if (!media || !fs.existsSync(path.join(UPLOADS_DIR, path.basename(media.url)))) {
    await prisma.instagram_product_posts.update({
      where: { id: next.id },
      data: { status: 'skipped', error_message: 'missing image file' },
    });
    return;
  }
  await postQueuedProductToInstagram(next);
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

  // Generate the two morning drafts an hour+ ahead of their post time, and
  // the two evening drafts likewise -- gives a review window in admin.html's
  // Instagram Content tab before autoDeploySlot posts them for real.
  if (nowHHMM === GEN_MORNING_TIME && ranMorningGenOn !== today) {
    ranMorningGenOn = today;
    await generateMorningSingleStory().catch(err => console.error('[scheduler] morning single story generation failed:', err));
    await generateMorningCollageStory().catch(err => console.error('[scheduler] morning collage story generation failed:', err));
  }
  if (nowHHMM === GEN_EVENING_TIME && ranEveningGenOn !== today) {
    ranEveningGenOn = today;
    await generateEveningSingleStory().catch(err => console.error('[scheduler] evening single story generation failed:', err));
    await generateEveningCollageStory().catch(err => console.error('[scheduler] evening collage story generation failed:', err));
  }

  // Auto-post each slot's draft at its scheduled time (no-op if it was
  // already manually deployed or deleted during the review window).
  if (nowHHMM === MORNING_SINGLE_TIME && ranMorningSingleDeployOn !== today) {
    ranMorningSingleDeployOn = today;
    await autoDeploySlot(MORNING_SINGLE_TIME).catch(err => console.error('[scheduler] morning single auto-deploy failed:', err));
  }
  if (nowHHMM === MORNING_COLLAGE_TIME && ranMorningCollageDeployOn !== today) {
    ranMorningCollageDeployOn = today;
    await autoDeploySlot(MORNING_COLLAGE_TIME).catch(err => console.error('[scheduler] morning collage auto-deploy failed:', err));
  }
  if (nowHHMM === EVENING_SINGLE_TIME && ranEveningSingleDeployOn !== today) {
    ranEveningSingleDeployOn = today;
    await autoDeploySlot(EVENING_SINGLE_TIME).catch(err => console.error('[scheduler] evening single auto-deploy failed:', err));
  }
  if (nowHHMM === EVENING_COLLAGE_TIME && ranEveningCollageDeployOn !== today) {
    ranEveningCollageDeployOn = today;
    await autoDeploySlot(EVENING_COLLAGE_TIME).catch(err => console.error('[scheduler] evening collage auto-deploy failed:', err));
  }

  if (ranThisMinute !== nowHHMM) {
    const settings = await prisma.sync_settings.findUnique({ where: { id: 1 } });
    if (settings && (settings.import_schedule_time === nowHHMM || settings.stock_check_schedule_time === nowHHMM)) {
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
  }

  // Drip-feed one queued new-product Instagram post at a time, throttled to
  // PRODUCT_POST_INTERVAL_MS -- runs every tick, self-throttles internally.
  await maybePostQueuedProduct().catch(err => console.error('[scheduler] product post drip-feed failed:', err));
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
