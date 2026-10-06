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
const { checkSiteStock, importSite, cleanupStaleChromeProfiles, importStatusText, claimSiteRun, SITE_RUN_STALE_MS } = require('./utils/siteSync');
const { syncSubcategoryActiveState } = require('./utils/subcategorySync');
const { buildSingleProductStory, buildCollageStory } = require('./utils/storyBuilder');
const { buildReel } = require('./utils/reelBuilder');
const { REEL_SLOTS, reelGroupFor } = require('./utils/reelPlan');
const { deployStoryById } = require('./controllers/instagramContentController');
const { publishAllChanges } = require('./controllers/adminController');
const { queueNewProductsForInstagram } = require('./utils/instagramProductQueue');
const {
  createFeedContainer, createCarouselChildContainer, createCarouselContainer,
  publishContainer, waitUntilContainerReady, isRateLimitError, isRateLimitMessage, isAccountBlockedError,
  getPublishingQuota,
} = require('./utils/instagramPublish');
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
const ranReelGenOn = {};    // slot -> 'YYYY-MM-DD' of its last draft generation
const ranReelDeployOn = {}; // slot -> 'YYYY-MM-DD' of its last auto-deploy

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

// .toISOString() converts to UTC before formatting, unlike currentHHMM() above
// which reads local hours/minutes -- on this VPS (system TZ +03), that mismatch
// meant "today" here read as the UTC calendar date while nowHHMM already read
// the local one, so during local 00:00-03:00 "today" would still be yesterday.
// None of the current schedule times (10:00-19:30) fall in that window, so it
// hasn't visibly broken anything yet, but it's the same class of bug the
// Instagram product-post date grouping had (frontend/admin.html) -- fixed the
// same way, by reading local date components instead of the UTC ISO string.
function currentDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Product posts go out in pairs: two posts 3-4 min apart, then a random
// 15-30 min break before the next pair -- never a fixed cadence, since an
// exact every-10-minutes rhythm (plus ~80 posts/day) is the kind of
// mechanical pattern Meta flagged as unusual activity on 2026-09-30/10-01
// ("API access blocked."). A plain random 30-60 min gap was tried first but
// couldn't get through a full day's queue (~40-50 posts). The 3 min minimum
// also holds across restarts, via the last real posted_at in the DB; the
// rest is in-memory.
const PRODUCT_POST_MIN_INTERVAL_MS = 3 * 60 * 1000;
const PRODUCT_POSTS_PER_BURST = 2;
const randomMs = (minMinutes, maxMinutes) => (minMinutes + Math.random() * (maxMinutes - minMinutes)) * 60 * 1000;
let productPostsInCurrentBurst = 0;
function randomProductPostGapMs() {
  productPostsInCurrentBurst++;
  if (productPostsInCurrentBurst < PRODUCT_POSTS_PER_BURST) return randomMs(3, 4);
  productPostsInCurrentBurst = 0;
  return randomMs(15, 30);
}
let nextProductPostAllowedAt = 0;

// Staging runs this same scheduler against the same DB and the same Instagram
// account as production -- two posters doubled the API traffic and caused
// real double posts. Only production talks to Instagram: staging is
// recognised by PREVIEW_UNPUBLISHED=true (set only in Store-staging's .env,
// see productsController.js); INSTAGRAM_POSTING_DISABLED=true also works
// anywhere. Covers story generation, story posting/retries and product posts.
const INSTAGRAM_ENABLED = process.env.PREVIEW_UNPUBLISHED !== 'true' && process.env.INSTAGRAM_POSTING_DISABLED !== 'true';
const PRODUCT_POST_START_TIME = '08:00'; // don't start posting before this time each day (the day's imports are done by then)
const PRODUCT_POST_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000; // pause after Instagram says "request limit reached"

// In-memory, not in the DB: staging and production each run this scheduler
// against the one shared DB, so each process just backs off on its own after
// its own first rate-limit error (worst case one extra wasted call per
// process, or per restart) -- avoids a schema change for a single timestamp.
let productPostPausedUntil = 0;

// Account-level errors (see isAccountBlockedError) pause product posting much
// longer than a rate limit -- Meta lifting an "API access blocked" takes hours
// at least, and hammering a blocked app only risks making it worse.
const PRODUCT_POST_ACCOUNT_BLOCK_BACKOFF_MS = 6 * 60 * 60 * 1000;

// Start time of the last product-post attempt, successful or not. Any
// failure used to leave the very next tick (60s later) free to try the next
// row, since the interval only counted 'posted' rows -- an error neither
// rate-limit nor account-level would still burn the whole queue a row a
// minute (as "API access blocked." did on 2026-10-01: 50 rows in under an
// hour). Every attempt now sets the next allowed time (nextProductPostAllowedAt).

// A story that hit a rate limit is retried every STORY_RETRY_INTERVAL_MS, but
// only until STORY_RETRY_WINDOW_MIN after its own slot time -- a morning
// story going up in the afternoon is no longer worth posting. Last-attempt
// times are in-memory for the same reason as productPostPausedUntil; a row
// this process hasn't attempted yet (e.g. right after a restart, or failed
// in the other process) waits one full interval first rather than retrying
// immediately. deployStoryById's own atomic claim keeps staging and
// production from both posting the same retry.
const STORY_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const STORY_RETRY_WINDOW_MIN = 3 * 60;
const storyLastAttemptAt = new Map(); // instagram_content.id -> ms timestamp

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// A product stays visibly sold_out for SOLD_OUT_DEACTIVATE_DAYS (sold_out_at is stamped once,
// on the transition into sold_out — see resolveProductTag's callers and
// checkSiteStock — not re-stamped on every check while it stays sold out).
// Past that, it's deactivated AND published immediately here: every other
// admin change waits for a manual "Publish" click (a deliberate review step),
// but nothing about a product having sat sold out that long needs a human
// to confirm it should stop showing, so this flips is_live itself rather
// than just marking it dirty and waiting for the next unrelated publish.
// Was a month until 2026-09-30; shortened to 5 days on request.
const SOLD_OUT_DEACTIVATE_DAYS = 5;

async function deactivateExpiredSoldOutProducts() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SOLD_OUT_DEACTIVATE_DAYS);

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

  console.log(`[scheduler] auto-deactivated ${expired.length} product(s) sold out for over ${SOLD_OUT_DEACTIVATE_DAYS} days`);
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
// Only products whose selling price (the discounted price when there is
// one, otherwise the regular price) is at least this many TL -- user's
// request 2026-10-05, cheap items aren't worth a story slot.
const STORY_MIN_PRICE_TL = 300;

// Reels pass `where` (their product group plus "discounted"), their own
// lower `minPrice` (cosmetics are often under the stories' 300 TL) and a
// `keep` test the database can't do itself (the size of the discount), with
// a deeper `poolSize` to leave enough after it.
async function eligibleStoryProducts(limit, excludeIds = [], { where = null, minPrice = STORY_MIN_PRICE_TL, keep = null, poolSize = null } = {}) {
  const recent = await recentlyUsedProductIds();
  const baseWhere = {
    is_active: true,
    is_live: true,
    tag: { not: 'sold_out' },
    product_media: { some: {} },
    AND: [
      { OR: [
        { discounted_price: { gte: minPrice } },
        { discounted_price: null, price: { gte: minPrice } },
      ] },
      ...(where ? [where] : []),
    ],
  };

  async function fetchPool(exclude) {
    const pool = await prisma.products.findMany({
      where: { ...baseWhere, id: { notIn: exclude } },
      include: { product_media: { take: 1 } },
      orderBy: { updated_at: 'desc' },
      take: poolSize || Math.max(limit * 10, 30),
    });
    // A product_media row pointing at a file that's actually missing on disk
    // (seen in production data) would otherwise crash sharp mid-render —
    // filter those out here rather than letting generateMorning/EveningStory
    // fail silently for the whole day.
    return pool.filter(p => {
      const media = p.product_media[0];
      return media && fs.existsSync(path.join(UPLOADS_DIR, path.basename(media.url))) && (!keep || keep(p));
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
  if (products.length < 2) return false; // not enough distinct products for a collage today
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
  return true;
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

// A reel for one slot (see utils/reelPlan.js): up to REEL_PRODUCTS
// discounted products of that day's group, never fewer than
// REEL_MIN_PRODUCTS (no reel that slot otherwise). Saved as a draft row
// like a story (kind 'reel', image_url = the MP4) for review, then posted
// at the slot's time by autoDeploySlot.
// User's choice (2026-10-06): reels stay drafts — Instagram's API can't
// add its own music library, so they're posted by hand from the app with a
// trending track. The 🚀 button in the admin still posts one as it is.
const REEL_AUTO_POST = false;
const REEL_PRODUCTS = 5;
const REEL_MIN_PRODUCTS = 3;
const REEL_MIN_PRICE_TL = 100;
// User's choice (2026-10-06): only real-looking deals in a reel — at least
// this much off on OUR site, i.e. our selling price (the source's sale
// price plus markup) against the original price, the same percent the
// slide and the product page show.
const REEL_MIN_DISCOUNT = 0.20;
const reelDiscountOk = (minDiscount) => (p) => Number(p.price) > 0
  && (Number(p.price) - Number(p.discounted_price)) / Number(p.price) >= minDiscount;
async function generateReel(slot) {
  const group = reelGroupFor(slot, currentDateStr());
  if (!group) return false;
  const products = await eligibleStoryProducts(REEL_PRODUCTS, [], {
    where: { AND: [group.where, { tag: 'discount' }, { discounted_price: { not: null } }] },
    minPrice: REEL_MIN_PRICE_TL,
    keep: reelDiscountOk(group.minDiscount ?? REEL_MIN_DISCOUNT),
    poolSize: 400,
  });
  if (products.length < REEL_MIN_PRODUCTS) {
    console.warn(`[scheduler] reel ${slot} (${group.key}): only ${products.length} eligible product(s), skipped`);
    return false;
  }
  const videoUrl = await buildReel(products, { headline: group.headline, prefix: `${slot.replace(':', '')}-${group.key}` });
  await prisma.instagram_content.create({
    data: {
      kind: 'reel',
      slot,
      scheduled_date: new Date(currentDateStr()),
      image_url: videoUrl,
      product_ids: products.map(p => p.id),
      link: `${process.env.FRONTEND_URL}/index.html`,
    },
  });
  return true;
}

// Manual "rebuild" from admin.html's Instagram Content tab: replaces today's
// story for one slot with a freshly generated one (new products, current
// layout) -- e.g. after a layout change, or to swap out a draft the admin
// didn't like. Any not-yet-posted row for that slot today is removed first
// (deleting a draft used to leave the slot empty until the next day's
// generation run). Refuses if that slot already went out. A collage still
// avoids the product its paired single story is showing, read from today's
// DB row rather than the in-memory last*SingleProductId (lost on restart).
const STORY_SLOTS = {
  [MORNING_SINGLE_TIME]:  { kind: 'single',  headline: 'پیشنهاد امروز شیلیستا', prefix: 'morning-single' },
  [MORNING_COLLAGE_TIME]: { kind: 'collage', headline: 'محصولات جدید ما',      prefix: 'morning-collage', pairedSingle: MORNING_SINGLE_TIME },
  [EVENING_SINGLE_TIME]:  { kind: 'single',  headline: 'پیشنهاد ویژه‌ی امشب',   prefix: 'evening-single' },
  [EVENING_COLLAGE_TIME]: { kind: 'collage', headline: 'انتخاب‌های امشب',       prefix: 'evening-collage', pairedSingle: EVENING_SINGLE_TIME },
};

async function rebuildStoryForSlot(slot) {
  const def = STORY_SLOTS[slot] || (REEL_SLOTS[slot] && { kind: 'reel' });
  if (!def) throw Object.assign(new Error('unknown_slot'), { status: 400 });
  const today = new Date(currentDateStr());
  const existing = await prisma.instagram_content.findMany({ where: { slot, scheduled_date: today } });
  if (existing.some(r => r.status === 'posted' || r.status === 'posting')) {
    throw Object.assign(new Error('already_posted'), { status: 409 });
  }
  for (const r of existing) {
    if (r.image_url) fs.unlink(path.join(UPLOADS_DIR, path.basename(r.image_url)), () => {});
    await prisma.instagram_content.delete({ where: { id: r.id } });
  }

  let excludeIds = [];
  if (def.pairedSingle) {
    const single = await prisma.instagram_content.findFirst({
      where: { slot: def.pairedSingle, scheduled_date: today },
      orderBy: { created_at: 'desc' },
    });
    excludeIds = Array.isArray(single?.product_ids) ? single.product_ids : [];
  }
  const ok = def.kind === 'reel' ? await generateReel(slot)
    : def.kind === 'single'
      ? await generateSingleStory(slot, def.headline, def.prefix, excludeIds)
      : await generateCollageStory(slot, def.headline, def.prefix, excludeIds);
  if (!ok) throw Object.assign(new Error('not_enough_products'), { status: 422 });
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
  await deployStoryAndHandleRateLimit(row.id);
}

// Stories take priority over product posts for the shared Instagram limit:
// when a story gets rate-limited, product posting pauses too, so the limit
// has room again by the time the story is retried.
async function deployStoryAndHandleRateLimit(id) {
  storyLastAttemptAt.set(id, Date.now());
  const result = await deployStoryById(id);
  if (result?.rateLimited) productPostPausedUntil = Math.max(productPostPausedUntil, Date.now() + PRODUCT_POST_RATE_LIMIT_BACKOFF_MS);
  if (result?.accountBlocked) productPostPausedUntil = Math.max(productPostPausedUntil, Date.now() + PRODUCT_POST_ACCOUNT_BLOCK_BACKOFF_MS);
  // A story that actually went up proves the API is reachable again, so any
  // pause left over from an earlier block/limit no longer applies -- on
  // 2026-10-01 the 11:00 story posted fine right after Meta lifted an "API
  // access blocked", while product posts sat out the rest of a 6h pause.
  if (result && !result.rateLimited && !result.accountBlocked && result.posted) productPostPausedUntil = 0;
}

async function maybeRetryRateLimitedStories() {
  const rows = await prisma.instagram_content.findMany({
    where: { status: 'failed', scheduled_date: new Date(currentDateStr()) },
  });
  const nowMin = hhmmToMinutes(currentHHMM());
  for (const row of rows) {
    const slotTime = String(row.slot).replace(/^reel-/, ''); // reels: "reel-12:00"
    if (!/^\d{2}:\d{2}$/.test(slotTime)) continue; // legacy 'morning'/'evening' rows
    if (!isRateLimitMessage(row.error_message)) continue; // a real failure -- left for manual review
    if (nowMin > hhmmToMinutes(slotTime) + STORY_RETRY_WINDOW_MIN) continue;
    const last = storyLastAttemptAt.get(row.id);
    if (last === undefined) { storyLastAttemptAt.set(row.id, Date.now()); continue; }
    if (Date.now() - last < STORY_RETRY_INTERVAL_MS) continue;
    await deployStoryAndHandleRateLimit(row.id);
  }
}

async function runImport(site) {
  // Skipped when another process (staging/production) is already on it.
  if (!(await claimSiteRun(site.id, 'import_in_progress').catch(() => false))) return;
  try {
    const result = await importSite(site, { limit: 30 });

    // Queue up to this site's configured daily cap of today's new products
    // for an automatic Instagram feed post (drip-fed, see
    // maybePostQueuedProduct) -- not every single import, per-brand limit.
    await queueNewProductsForInstagram(site, result.imported);

    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: importStatusText(result) },
    });
  } catch (err) {
    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `error: ${err.message}` },
    }).catch(() => {});
  }
}

function toHashtag(text) {
  return '#' + String(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

// #Shilista always, plus 4 more -- prefers this product's own brand/category
// (genuinely "related" to the post) and pads with generic fallback tags only
// when those aren't available, so it's always exactly 5 tags.
// Brand goes in the caption body as plain text (below), NOT as a hashtag --
// only category feeds the dynamic hashtag slot now.
function buildProductHashtags(product) {
  const dynamicTags = [];
  if (product.categories?.label_en) dynamicTags.push(toHashtag(product.categories.label_en));

  const fallbackTags = ['#فشن', '#استایل', '#خرید_آنلاین', '#پوشاک'];
  const otherTags = [...dynamicTags];
  for (const t of fallbackTags) {
    if (otherTags.length >= 4) break;
    if (!otherTags.includes(t)) otherTags.push(t);
  }
  return ['#Shilista', ...otherTags.slice(0, 4)];
}

function buildProductCaption(product) {
  const tags = buildProductHashtags(product);
  const brandLine = product.brand ? `\n\n🏷 ${product.brand}` : '';
  return `${product.name_fa}\n\n${product.name_en}${brandLine}\n\n🛍 shilista.com\n\n${tags.join(' ')}`;
}

// 2+ real photos -> a carousel (swipeable) post with all of them, up to
// Instagram's 10-image cap; exactly 1 -> a plain single-image post (the API
// requires at least 2 children for CAROUSEL, so 1 photo can't go that route
// at all).
async function postQueuedProductToInstagram(row) {
  const media = (row.products.product_media || [])
    .filter(m => fs.existsSync(path.join(UPLOADS_DIR, path.basename(m.url))))
    .slice(0, 5); // 5 images max (was Instagram's own cap of 10): each one is its own create + poll API calls
  const caption = buildProductCaption(row.products);
  try {
    let creationId;
    if (media.length >= 2) {
      const childIds = [];
      for (const m of media) {
        const childId = await createCarouselChildContainer(`${process.env.FRONTEND_URL}${m.url}`);
        await waitUntilContainerReady(childId);
        childIds.push(childId);
      }
      creationId = await createCarouselContainer(childIds, caption);
    } else {
      creationId = await createFeedContainer(`${process.env.FRONTEND_URL}${media[0].url}`, caption);
    }
    const mediaId = await publishContainer(creationId);
    await prisma.instagram_product_posts.update({
      where: { id: row.id },
      data: { status: 'posted', ig_media_id: mediaId, posted_at: new Date(), error_message: null },
    });
  } catch (err) {
    // A rate-limit error says nothing about this post -- back into the queue
    // (not 'failed') and pause all product posting for a while. Before this,
    // a failure didn't count toward the posting interval at all (only
    // 'posted' rows do), so the very next tick 60s later tried the next row,
    // which failed the same way, and so on -- confirmed live 2026-09-30: the
    // whole queue (24 rows) burned through to 'failed' in ~24 minutes, each
    // attempt itself another call against the exhausted limit.
    // Account-level errors ("API access blocked.", invalid token) are handled
    // the same way, with a longer pause.
    const rateLimited = isRateLimitError(err);
    const accountBlocked = isAccountBlockedError(err);
    if (rateLimited) productPostPausedUntil = Math.max(productPostPausedUntil, Date.now() + PRODUCT_POST_RATE_LIMIT_BACKOFF_MS);
    if (accountBlocked) productPostPausedUntil = Math.max(productPostPausedUntil, Date.now() + PRODUCT_POST_ACCOUNT_BLOCK_BACKOFF_MS);
    await prisma.instagram_product_posts.update({
      where: { id: row.id },
      data: { status: (rateLimited || accountBlocked) ? 'queued' : 'failed', error_message: err.message },
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

// Posts at most one queued new-product row at a time, in pairs (see randomProductPostGapMs),
// derived from the last actual post time (not an in-memory timer, so it
// self-corrects across restarts instead of bursting) -- never before
// PRODUCT_POST_START_TIME each day, and never more than totalDailyPostCap()
// posts in a single calendar day, even if the queue has backlog from a
// slower day and the rate alone would allow more. Only considers products
// that have actually gone live (an admin publish can lag well behind
// import) -- skips (not blocks on) a row whose photo file is missing, same
// defensive pattern as eligibleStoryProducts.
// Instagram's own publishing cap is 50 posts per rolling 24h, stories
// included -- confirmed live 2026-10-02: 46 product posts + 4 stories in the
// previous 24h, then "User is performing too many actions" (code 9 /
// 2207042). totalDailyPostCap() is per *calendar* day, so a busy afternoon
// plus the next morning could still hit it. Counted from our own DB (no API
// call), leaving IG_ROLLING_RESERVE slots for the day's 4 stories and 2
// reels (reels live in instagram_content too, so they're counted below).
const IG_ROLLING_LIMIT = 50;
const IG_ROLLING_RESERVE = 7;
async function igPostsInLast24h() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [products, stories] = await Promise.all([
    prisma.instagram_product_posts.count({ where: { status: 'posted', posted_at: { gte: since } } }),
    prisma.instagram_content.count({ where: { status: 'posted', posted_at: { gte: since } } }),
  ]);
  return products + stories;
}

async function maybePostQueuedProduct() {
  if (currentHHMM() < PRODUCT_POST_START_TIME) return;
  if (Date.now() < productPostPausedUntil) return;
  if (Date.now() < nextProductPostAllowedAt) return;

  // A post takes ~1 minute (create + poll + publish), and the interval
  // below is measured from the last *finished* post -- so a tick landing
  // mid-post still saw the previous post as >10 min old and started a
  // second one right alongside it (confirmed live: pairs of posts under a
  // minute apart, e.g. 05:23:36/05:24:29 and 06:09:28/06:10:12 UTC).
  const inFlight = await prisma.instagram_product_posts.count({ where: { status: 'posting' } });
  if (inFlight > 0) return;

  const last = await prisma.instagram_product_posts.findFirst({
    where: { status: 'posted' },
    orderBy: { posted_at: 'desc' },
  });
  if (last && Date.now() - new Date(last.posted_at).getTime() < PRODUCT_POST_MIN_INTERVAL_MS) return;

  const [postedToday, dailyCap] = await Promise.all([productPostsMadeToday(), totalDailyPostCap()]);
  if (postedToday >= dailyCap) return; // today's combined per-brand cap already reached
  if (await igPostsInLast24h() >= IG_ROLLING_LIMIT - IG_ROLLING_RESERVE) return; // Instagram's rolling 24h cap (see above)
  // Then ask Instagram itself -- its count can be higher than ours (see
  // getPublishingQuota). One cheap GET; when full, check again in 15 min
  // rather than every tick. If the check itself fails, fall through to the
  // attempt below, whose own error handling (rate limit / blocked) applies.
  try {
    const quota = await getPublishingQuota();
    if (quota.used >= quota.total - IG_ROLLING_RESERVE) {
      nextProductPostAllowedAt = Date.now() + 15 * 60 * 1000;
      return;
    }
  } catch (err) {
    if (isRateLimitError(err) || isAccountBlockedError(err)) {
      productPostPausedUntil = Math.max(productPostPausedUntil, Date.now() + (isAccountBlockedError(err) ? PRODUCT_POST_ACCOUNT_BLOCK_BACKOFF_MS : PRODUCT_POST_RATE_LIMIT_BACKOFF_MS));
      return;
    }
  }

  const next = await prisma.instagram_product_posts.findFirst({
    where: { status: 'queued', products: { is_active: true, is_live: true } },
    orderBy: { created_at: 'asc' },
    include: { products: { include: { product_media: true, categories: { select: { label_en: true } } } } },
  });
  if (!next) return;

  // Claim it atomically before doing any real work: tick() runs every 60s
  // via setInterval, which does NOT wait for a slow previous tick to finish
  // -- a carousel post (several images, each its own create+poll round trip)
  // can easily take longer than 60s, so two overlapping tick() calls could
  // otherwise both `findFirst` the same still-'queued' row and both actually
  // post it to the real Instagram account (confirmed live 2026-09-29 -- one
  // product posted twice; the DB only ever showed one row because both
  // updates targeted the same id, the second silently overwriting the
  // first's ig_media_id). This update only succeeds for whichever tick gets
  // here first; a losing concurrent tick sees claimed.count === 0 and bails.
  const claimed = await prisma.instagram_product_posts.updateMany({
    where: { id: next.id, status: 'queued' },
    data: { status: 'posting' },
  });
  if (claimed.count === 0) return; // another concurrent tick already claimed this row

  const hasRealPhoto = (next.products.product_media || [])
    .some(m => fs.existsSync(path.join(UPLOADS_DIR, path.basename(m.url))));
  if (!hasRealPhoto) {
    await prisma.instagram_product_posts.update({
      where: { id: next.id },
      data: { status: 'skipped', error_message: 'missing image file' },
    });
    return;
  }
  nextProductPostAllowedAt = Date.now() + randomProductPostGapMs();
  await postQueuedProductToInstagram(next);
}

async function runStockCheck(site) {
  if (!(await claimSiteRun(site.id, 'stock_check_in_progress').catch(() => false))) return;
  try {
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

// Product posts are queued per import run, i.e. every day brings a fresh
// batch (up to each site's daily_ig_post_limit) -- so anything still queued
// from an earlier day (typically left over because Instagram's rate limit
// never cleared before midnight) is dropped rather than carried over and
// stacked on top of the new day's batch. Runs once per day, on the first
// tick after local midnight (and again after a restart -- harmless, it only
// ever touches rows queued before today).
async function expireStaleQueuedProductPosts() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await prisma.instagram_product_posts.updateMany({
    where: { status: 'queued', created_at: { lt: startOfDay } },
    data: { status: 'skipped', error_message: 'not posted on the day it was queued' },
  });
  if (count) console.log(`[scheduler] skipped ${count} product post(s) left over from an earlier day`);
}

async function tick() {
  const today = currentDateStr();
  if (ranSoldOutSweepOn !== today) {
    ranSoldOutSweepOn = today;
    await deactivateExpiredSoldOutProducts().catch(err => console.error('[scheduler] sold-out expiry sweep failed:', err));
    await expireStaleQueuedProductPosts().catch(err => console.error('[scheduler] stale product-post expiry failed:', err));
  }

  const nowHHMM = currentHHMM();

  // Generate the two morning drafts an hour+ ahead of their post time, and
  // the two evening drafts likewise -- gives a review window in admin.html's
  // Instagram Content tab before autoDeploySlot posts them for real.
  if (INSTAGRAM_ENABLED && nowHHMM === GEN_MORNING_TIME && ranMorningGenOn !== today) {
    ranMorningGenOn = today;
    await generateMorningSingleStory().catch(err => console.error('[scheduler] morning single story generation failed:', err));
    await generateMorningCollageStory().catch(err => console.error('[scheduler] morning collage story generation failed:', err));
  }
  if (INSTAGRAM_ENABLED && nowHHMM === GEN_EVENING_TIME && ranEveningGenOn !== today) {
    ranEveningGenOn = today;
    await generateEveningSingleStory().catch(err => console.error('[scheduler] evening single story generation failed:', err));
    await generateEveningCollageStory().catch(err => console.error('[scheduler] evening collage story generation failed:', err));
  }

  // Reels: drafted at their genTime (utils/reelPlan.js). Not posted
  // automatically (REEL_AUTO_POST): the API can't add Instagram's own
  // (trending) music, so the user posts them from the app with music.
  for (const [slot, def] of Object.entries(REEL_SLOTS)) {
    if (INSTAGRAM_ENABLED && nowHHMM === def.genTime && ranReelGenOn[slot] !== today) {
      ranReelGenOn[slot] = today;
      await generateReel(slot).catch(err => console.error(`[scheduler] reel ${slot} generation failed:`, err));
    }
    if (REEL_AUTO_POST && INSTAGRAM_ENABLED && nowHHMM === def.time && ranReelDeployOn[slot] !== today) {
      ranReelDeployOn[slot] = today;
      await autoDeploySlot(slot).catch(err => console.error(`[scheduler] reel ${slot} auto-deploy failed:`, err));
    }
  }

  // Auto-post each slot's draft at its scheduled time (no-op if it was
  // already manually deployed or deleted during the review window).
  if (INSTAGRAM_ENABLED && nowHHMM === MORNING_SINGLE_TIME && ranMorningSingleDeployOn !== today) {
    ranMorningSingleDeployOn = today;
    await autoDeploySlot(MORNING_SINGLE_TIME).catch(err => console.error('[scheduler] morning single auto-deploy failed:', err));
  }
  if (INSTAGRAM_ENABLED && nowHHMM === MORNING_COLLAGE_TIME && ranMorningCollageDeployOn !== today) {
    ranMorningCollageDeployOn = today;
    await autoDeploySlot(MORNING_COLLAGE_TIME).catch(err => console.error('[scheduler] morning collage auto-deploy failed:', err));
  }
  if (INSTAGRAM_ENABLED && nowHHMM === EVENING_SINGLE_TIME && ranEveningSingleDeployOn !== today) {
    ranEveningSingleDeployOn = today;
    await autoDeploySlot(EVENING_SINGLE_TIME).catch(err => console.error('[scheduler] evening single auto-deploy failed:', err));
  }
  if (INSTAGRAM_ENABLED && nowHHMM === EVENING_COLLAGE_TIME && ranEveningCollageDeployOn !== today) {
    ranEveningCollageDeployOn = today;
    await autoDeploySlot(EVENING_COLLAGE_TIME).catch(err => console.error('[scheduler] evening collage auto-deploy failed:', err));
  }
  if (INSTAGRAM_ENABLED) await maybeRetryRateLimitedStories().catch(err => console.error('[scheduler] story rate-limit retry failed:', err));

  // Fetched every tick (not just when ranThisMinute is about to change) so
  // maybeAutoPublish below can check its own interval independently of the
  // site-import/stock-check schedule times.
  const settings = await prisma.sync_settings.findUnique({ where: { id: 1 } });

  if (ranThisMinute !== nowHHMM) {
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
  // pairs 3-4 min apart, 15-30 min between pairs -- runs every tick, self-throttles internally.
  if (INSTAGRAM_ENABLED) await maybePostQueuedProduct().catch(err => console.error('[scheduler] product post drip-feed failed:', err));

  await maybeAutoPublish(settings).catch(err => console.error('[scheduler] auto-publish failed:', err));
}

// Unlike the Instagram post/story pipelines, re-running publishAllChanges()
// twice back to back is harmless (it just re-snapshots the same already-
// published rows), so this only needs a simple in-memory interval guard, not
// an atomic DB claim -- there's no "posted twice to a real external service"
// risk here.
let lastAutoPublishAt = 0;
async function maybeAutoPublish(settings) {
  if (!settings || !settings.auto_publish_enabled) return;
  const intervalMs = Math.max(1, settings.auto_publish_interval_minutes || 30) * 60 * 1000;
  if (Date.now() - lastAutoPublishAt < intervalMs) return;
  lastAutoPublishAt = Date.now();
  await publishAllChanges();
  // Persisted (not just the in-memory guard above) so admin.html's Deploy tab
  // can show "last auto-published at" -- otherwise a run happening on schedule
  // is indistinguishable from one that never fires, since new dirty products
  // from an in-progress import can make the pending-count badge look
  // unchanged either way.
  await prisma.sync_settings.update({ where: { id: 1 }, data: { auto_publish_last_run: new Date() } });
}

function start() {
  // A sync mid-flight when the process restarts (deploy, crash, manual
  // restart) never gets to write its final status — the in_progress flag
  // would otherwise stay stuck true forever, permanently disabling that
  // site's Sync Now buttons. Nothing can genuinely be in progress right
  // after boot, so clear both flags for every site once at startup.
  // Only claims older than SITE_RUN_STALE_MS, though: staging and
  // production share the database, and staging restarts on every push —
  // clearing every flag here used to wipe the other process's live claim.
  prisma.sites.updateMany({
    where: { OR: [{ import_in_progress: true }, { stock_check_in_progress: true }], updated_at: { lt: new Date(Date.now() - SITE_RUN_STALE_MS) } },
    data: { import_in_progress: false, stock_check_in_progress: false },
  }).catch(err => console.error('[scheduler] failed to clear stale in-progress flags:', err));

  // Same reasoning: a leftover Puppeteer temp profile dir in /tmp is only
  // possible if the process that launched it is dead, which is guaranteed
  // true for every one of them right after this process just booted.
  cleanupStaleChromeProfiles().catch(err => console.error('[scheduler] failed to clean up stale Chrome profiles:', err));

  // Same reasoning again: a row stuck in 'posting' (the atomic-claim state
  // in maybePostQueuedProduct) means the process died mid-post -- possibly
  // AFTER Instagram already received it, so requeuing risks a duplicate
  // post, but leaving it stuck 'posting' forever guarantees it never gets
  // retried or reviewed either. Back to 'queued' is the same tradeoff
  // deploy/crash recovery already makes for imports above; a real double-
  // post from this is rare (needs a crash in the exact multi-second window
  // between the atomic claim and the actual Graph API call finishing).
  prisma.instagram_product_posts.updateMany({
    where: { status: 'posting' },
    data: { status: 'queued' },
  }).catch(err => console.error('[scheduler] failed to reset stale posting rows:', err));

  // Same reset for the Story pipeline's own atomic-claim state (see
  // instagramContentController.js#deployStoryById) -- 'draft' rather than
  // 'queued' is the equivalent rest state here.
  prisma.instagram_content.updateMany({
    where: { status: 'posting' },
    data: { status: 'draft' },
  }).catch(err => console.error('[scheduler] failed to reset stale story posting rows:', err));

  setInterval(() => { tick().catch(err => console.error('[scheduler] tick error:', err)); }, 60 * 1000);
  console.log(`[scheduler] site sync scheduler started${INSTAGRAM_ENABLED ? '' : ' (Instagram posting disabled on this instance)'}`);
}

module.exports = { start, rebuildStoryForSlot };
