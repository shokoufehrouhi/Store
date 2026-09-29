const prisma = require('../prisma/client');

// Queues up to site.daily_ig_post_limit of this import run's genuinely-new
// products (importedResults, the `imported` array an importer returns) for
// an automatic Instagram feed post later -- see scheduler.js#
// maybePostQueuedProduct for the actual posting drip-feed. Shared by both
// the scheduled import (scheduler.js#runImport) and the manual "Import
// Products Now" button (sitesController.js#syncImport), which are two
// separate code paths -- this must be called from both, or a manually
// triggered import silently skips queueing new products for Instagram.
async function queueNewProductsForInstagram(site, importedResults) {
  const ok = (importedResults || []).filter(r => !r.error);
  const toQueue = ok.slice(0, site.daily_ig_post_limit);
  if (toQueue.length) {
    await prisma.instagram_product_posts.createMany({
      data: toQueue.map(r => ({ product_id: r.id })),
    });
  }
  return toQueue.length;
}

module.exports = { queueNewProductsForInstagram };
