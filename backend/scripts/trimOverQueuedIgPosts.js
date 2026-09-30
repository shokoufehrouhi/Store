// One-off: queueNewProductsForInstagram used to apply each site's
// daily_ig_post_limit per import run instead of per day, so repeated manual
// imports on 2026-09-30 queued far past it (Mavi, limit 10: 130 queued;
// Koton, limit 10: 20). Fixed in utils/instagramProductQueue.js; this trims
// today's rows that are already over the limit. Per site, today's rows that
// are posted/posting/failed count first (they already used a slot), then the
// earliest-queued ones fill whatever is left; the rest of today's queued rows
// are marked 'skipped'. Earlier days' rows are left to scheduler.js's own
// midnight expiry.
// Run manually once: node scripts/trimOverQueuedIgPosts.js
const prisma = require('../prisma/client');

(async () => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sites = await prisma.sites.findMany({ select: { name: true, daily_ig_post_limit: true } });

  let totalSkipped = 0;
  for (const site of sites) {
    const rows = await prisma.instagram_product_posts.findMany({
      where: {
        created_at: { gte: startOfDay },
        status: { not: 'skipped' },
        products: { supplier_shop_name: site.name },
      },
      orderBy: { created_at: 'asc' },
      select: { id: true, status: true },
    });
    const used = rows.filter(r => r.status !== 'queued').length;
    const queued = rows.filter(r => r.status === 'queued');
    const room = Math.max(0, site.daily_ig_post_limit - used);
    const extra = queued.slice(room);
    if (extra.length) {
      await prisma.instagram_product_posts.updateMany({
        where: { id: { in: extra.map(r => r.id) } },
        data: { status: 'skipped', error_message: 'over the site\'s daily Instagram post limit' },
      });
    }
    totalSkipped += extra.length;
    console.log(`${site.name}: limit ${site.daily_ig_post_limit}, ${used} already used, ${queued.length} queued -> skipped ${extra.length}`);
  }
  console.log(`skipped ${totalSkipped} row(s) in total`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
