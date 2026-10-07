const prisma = require('../prisma/client');
const fs     = require('fs');
const path   = require('path');
const {
  createStoryContainer, publishContainer, isRateLimitError, isAccountBlockedError, isMissingContainerError,
  createReelContainer, REEL_READY_TIMEOUT_MS,
} = require('../utils/instagramPublish');
const { reelGroupFor, reelCaption } = require('../utils/reelPlan');

// See isMissingContainerError -- a brand-new container is the fix, so one
// automatic retry instead of leaving the story 'failed' until someone
// re-deploys it by hand (2026-10-03's 19:00 story went up ~2h late that way).
const MISSING_CONTAINER_RETRY_DELAY_MS = 60 * 1000;

async function createAndPublishStory(publicUrl) {
  const creationId = await createStoryContainer(publicUrl)
    .catch(err => { throw Object.assign(err, { stage: 'create_container' }); });
  return publishContainer(creationId);
}

// A reel row's image_url is its MP4; the caption is built from its group
// (by slot and date) and its products' current prices.
async function createAndPublishReel(story, publicUrl) {
  const group = reelGroupFor(story.slot, story.scheduled_date.toISOString().slice(0, 10));
  const products = await prisma.products.findMany({
    where: { id: { in: Array.isArray(story.product_ids) ? story.product_ids : [] } },
    select: { price: true, discounted_price: true },
  });
  const caption = group ? reelCaption(group, products) : '🛍 shilista.com';
  const creationId = await createReelContainer(publicUrl, caption)
    .catch(err => { throw Object.assign(err, { stage: 'create_container' }); });
  return publishContainer(creationId, { readyTimeoutMs: REEL_READY_TIMEOUT_MS });
}

// GET /api/admin/instagram-content
async function listStories(req, res, next) {
  try {
    const stories = await prisma.instagram_content.findMany({
      orderBy: { created_at: 'desc' },
      take: 60,
    });
    // Reels are posted by hand from the app (to add music), so each gets
    // the suggested caption to copy — the same text 🚀 would post.
    const reelProductIds = [...new Set(stories.filter(s => s.kind === 'reel').flatMap(s => (Array.isArray(s.product_ids) ? s.product_ids : [])))];
    const prices = new Map((reelProductIds.length ? await prisma.products.findMany({
      where: { id: { in: reelProductIds } },
      select: { id: true, price: true, discounted_price: true },
    }) : []).map(p => [p.id, p]));
    const data = stories.map((s) => {
      if (s.kind !== 'reel') return s;
      const group = reelGroupFor(s.slot, s.scheduled_date.toISOString().slice(0, 10));
      const products = (Array.isArray(s.product_ids) ? s.product_ids : []).map(id => prices.get(id)).filter(Boolean);
      return { ...s, caption: group ? reelCaption(group, products) : '🛍 shilista.com' };
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// Actually posts a draft/failed row to the real Instagram account. Shared by
// the manual Deploy button (below) and scheduler.js's auto-deploy at each
// story's scheduled slot time -- same code path either way, so "what
// clicking Deploy does" and "what happens automatically" never diverge.
// Returns { rateLimited: true } (or accountBlocked) when Instagram refused
// with a rate-limit (or account-level) error, so scheduler.js can pause
// product posts and retry the story later (the row itself is still marked
// 'failed' either way).
async function deployStoryById(id) {
  const story = await prisma.instagram_content.findUnique({ where: { id } });
  if (!story || story.status === 'posted') return;

  // Atomic claim, same race-prevention pattern as scheduler.js's
  // maybePostQueuedProduct: two concurrent callers -- e.g. staging and
  // production each running their own scheduler against this one shared DB,
  // or a manual Deploy click racing the scheduled auto-deploy -- could
  // otherwise both pass the check above and both actually post the same
  // story to the real Instagram account. Confirmed live 2026-09-29 (staging
  // + production both auto-generating AND auto-deploying the same evening
  // slot ~1 minute apart, one real double-post). This update only succeeds
  // if status hasn't changed since we just read it above.
  const claimed = await prisma.instagram_content.updateMany({
    where: { id, status: story.status },
    data: { status: 'posting' },
  });
  if (claimed.count === 0) return; // another caller already claimed this row

  const publicUrl = `${process.env.FRONTEND_URL}${story.image_url}`;
  const publish = () => (story.kind === 'reel' ? createAndPublishReel(story, publicUrl) : createAndPublishStory(publicUrl));
  try {
    let mediaId;
    try {
      mediaId = await publish();
    } catch (err) {
      if (!isMissingContainerError(err)) throw err;
      console.warn(`[instagram] story ${id}: container ${err.creationId} not found at ${err.stage}, retrying with a new container in ${MISSING_CONTAINER_RETRY_DELAY_MS / 1000}s`);
      await new Promise(r => setTimeout(r, MISSING_CONTAINER_RETRY_DELAY_MS));
      mediaId = await publish();
    }
    await prisma.instagram_content.update({
      where: { id },
      data: { status: 'posted', ig_media_id: mediaId, posted_at: new Date(), error_message: null },
    });
  } catch (err) {
    // Also logged: error_message is cleared once a later re-deploy succeeds,
    // which otherwise leaves no trace of what went wrong the first time.
    console.error(`[instagram] story ${id} failed${err.stage ? ` at ${err.stage}` : ''}: ${err.message}`);
    await prisma.instagram_content.update({
      where: { id },
      data: { status: 'failed', error_message: `${err.stage ? `[${err.stage}] ` : ''}${err.message}` },
    }).catch(() => {});
    return { rateLimited: isRateLimitError(err), accountBlocked: isAccountBlockedError(err) };
  }
  return { rateLimited: false, accountBlocked: false, posted: true };
}

// POST /api/admin/instagram-content/:id/deploy — manual trigger, same-day
// early posting ahead of the scheduled auto-deploy (see scheduler.js).
//
// Fire-and-forget, like adminController.js#deployToProduction: Instagram's
// own processing (waitUntilContainerReady's poll loop) can run past nginx's
// default 60s proxy_read_timeout for /api/admin/ -- the browser would see
// the request fail while the post actually goes through server-side a few
// seconds later, showing "failed" in the UI for a story that really posted.
// The frontend polls GET /admin/instagram-content instead of waiting on
// this response (see admin.html#deployIgContent).
async function deployStory(req, res, next) {
  try {
    const id = Number(req.params.id);
    const story = await prisma.instagram_content.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ success: false, message: 'not_found' });
    if (story.status === 'posted') return res.status(409).json({ success: false, message: 'already_posted' });

    res.json({ success: true, data: { started: true } });
    await deployStoryById(id);
  } catch (err) { next(err); }
}

// DELETE /api/admin/instagram-content/:id — discard a draft/failed row without posting
async function deleteStory(req, res, next) {
  try {
    const story = await prisma.instagram_content.findUnique({ where: { id: Number(req.params.id) } });
    if (!story) return res.status(404).json({ success: false, message: 'not_found' });
    if (story.image_url) {
      const filePath = path.join(__dirname, '../public', story.image_url);
      fs.unlink(filePath, () => {});
    }
    await prisma.instagram_content.delete({ where: { id: story.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// POST /api/admin/instagram-content/rebuild  { slot: '11:00' | '11:30' | '19:00' | '19:30' | 'reel-…' }
// The AI reel ('reel-08:00') only starts here ({ started: true }) and appears minutes later.
// Regenerates today's story for that slot (see scheduler.js#rebuildStoryForSlot).
// Required lazily: scheduler.js itself requires this controller.
async function rebuildStory(req, res, next) {
  try {
    const { rebuildStoryForSlot } = require('../scheduler');
    const result = await rebuildStoryForSlot(String(req.body?.slot || ''));
    res.json({ success: true, started: !!result?.started });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
}

module.exports = { listStories, deployStory, deleteStory, deployStoryById, rebuildStory };
