const prisma = require('../prisma/client');
const fs     = require('fs');
const path   = require('path');
const { createStoryContainer, publishContainer, isRateLimitError, isAccountBlockedError } = require('../utils/instagramPublish');

// GET /api/admin/instagram-content
async function listStories(req, res, next) {
  try {
    const stories = await prisma.instagram_content.findMany({
      orderBy: { created_at: 'desc' },
      take: 60,
    });
    res.json({ success: true, data: stories });
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
  try {
    const creationId = await createStoryContainer(publicUrl);
    const mediaId = await publishContainer(creationId);
    await prisma.instagram_content.update({
      where: { id },
      data: { status: 'posted', ig_media_id: mediaId, posted_at: new Date(), error_message: null },
    });
  } catch (err) {
    await prisma.instagram_content.update({
      where: { id },
      data: { status: 'failed', error_message: err.message },
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

// POST /api/admin/instagram-content/rebuild  { slot: '11:00' | '11:30' | '19:00' | '19:30' }
// Regenerates today's story for that slot (see scheduler.js#rebuildStoryForSlot).
// Required lazily: scheduler.js itself requires this controller.
async function rebuildStory(req, res, next) {
  try {
    const { rebuildStoryForSlot } = require('../scheduler');
    await rebuildStoryForSlot(String(req.body?.slot || ''));
    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
}

module.exports = { listStories, deployStory, deleteStory, deployStoryById, rebuildStory };
