const prisma = require('../prisma/client');

// Queues up to site.daily_ig_post_limit of this import run's genuinely-new
// products (importedResults, the `imported` array an importer returns) for
// an automatic Instagram feed post later -- see scheduler.js#
// maybePostQueuedProduct for the actual posting drip-feed. Shared by both
// the scheduled import (scheduler.js#runImport) and the manual "Import
// Products Now" button (sitesController.js#syncImport), which are two
// separate code paths -- this must be called from both, or a manually
// triggered import silently skips queueing new products for Instagram.
//
// The cap is per calendar day, not per run: it used to be applied to each
// run on its own, so every extra manual import the same day queued another
// full daily_ig_post_limit on top -- confirmed live 2026-09-30: Mavi (limit
// 10) had 130 posts queued after 13 manual imports, 173 queued in total.
// Anything already queued/posted today for this site counts toward it
// ('skipped' rows never actually used a slot, so those don't).
async function queueNewProductsForInstagram(site, importedResults) {
  const ok = (importedResults || []).filter(r => !r.error);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const alreadyToday = await prisma.instagram_product_posts.count({
    where: {
      created_at: { gte: startOfDay },
      status: { not: 'skipped' },
      products: { supplier_shop_name: site.name },
    },
  });
  const toQueue = ok.slice(0, Math.max(0, site.daily_ig_post_limit - alreadyToday));
  if (toQueue.length) {
    await prisma.instagram_product_posts.createMany({
      data: toQueue.map(r => ({ product_id: r.id })),
    });
  }
  return toQueue.length;
}

module.exports = { queueNewProductsForInstagram };
