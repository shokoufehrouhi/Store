// One-off: queued Instagram feed posts whose product has since been taken
// off the site (is_active false) — e.g. the ArmaLife colors folded into one
// product by mergeArmaLifeColors.js on 2026-10-05, or Mango/Lefties products
// whose discount ended. scheduler.js never posts them (it only picks posts
// of active, live products) and expires them at midnight anyway; this just
// marks them 'skipped' now so the admin list stops showing them as waiting
// (they also show without a photo there, since a merged product's photos
// moved to the product it was merged into).
// Dry run first (prints what would change):
//   node scripts/skipQueuedPostsOfInactiveProducts.js
// Then for real:
//   node scripts/skipQueuedPostsOfInactiveProducts.js --apply
const prisma = require('../prisma/client');

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.instagram_product_posts.findMany({
    where: { status: 'queued', products: { is_active: false } },
    select: { id: true, product_id: true, products: { select: { code: true, name_tr: true, supplier_shop_name: true } } },
  });
  for (const r of rows) {
    console.log(`#${r.id} ${r.products.code} (${r.products.supplier_shop_name}) "${r.products.name_tr}"`);
  }
  if (apply && rows.length) {
    await prisma.instagram_product_posts.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { status: 'skipped', error_message: 'product taken off the site' },
    });
  }
  console.log(apply ? `skipped ${rows.length} post(s)` : `${rows.length} post(s) would be skipped — re-run with --apply to do it`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
