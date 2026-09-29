const prisma = require('../prisma/client');
const fs     = require('fs');
const path   = require('path');
const { createStoryContainer, publishContainer } = require('../utils/instagramPublish');

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

// POST /api/admin/instagram-content/:id/deploy — actually posts to the real
// Instagram account. A row's own image_url is used directly (not re-saved/
// deleted like scheduler.js's old ephemeral flow), since it's meant to stay
// visible in the admin tab after posting.
async function deployStory(req, res, next) {
  try {
    const id = Number(req.params.id);
    const story = await prisma.instagram_content.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ success: false, message: 'not_found' });
    if (story.status === 'posted') return res.status(409).json({ success: false, message: 'already_posted' });

    const publicUrl = `${process.env.FRONTEND_URL}${story.image_url}`;
    try {
      const creationId = await createStoryContainer(publicUrl);
      const mediaId = await publishContainer(creationId);
      const updated = await prisma.instagram_content.update({
        where: { id },
        data: { status: 'posted', ig_media_id: mediaId, posted_at: new Date(), error_message: null },
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      await prisma.instagram_content.update({
        where: { id },
        data: { status: 'failed', error_message: err.message },
      });
      res.status(502).json({ success: false, message: err.message });
    }
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

module.exports = { listStories, deployStory, deleteStory };
