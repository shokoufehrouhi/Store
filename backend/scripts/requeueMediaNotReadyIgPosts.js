// One-off: product posts that failed with Instagram's "Media ID is not
// available" (code 9007 / subcode 2207027 — "Medya yayınlanmaya hazır değil.
// Lütfen biraz bekle"). That only meant Instagram hadn't finished with the
// photos yet; since 2026-10-06 publishContainer retries it, but rows that
// failed before then stay 'failed'. This puts them back in the queue —
// only those whose product is still on the site (active and live).
// Requeued rows still count toward the day's post cap, and any not posted
// by midnight are skipped like every other leftover queued row.
// Dry run first (prints what would change):
//   node scripts/requeueMediaNotReadyIgPosts.js
// Then for real:
//   node scripts/requeueMediaNotReadyIgPosts.js --apply
const prisma = require('../prisma/client');

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.instagram_product_posts.findMany({
    where: {
      status: 'failed',
      error_message: { contains: '2207027' },
      products: { is_active: true, is_live: true },
    },
    select: { id: true, created_at: true, products: { select: { code: true, name_tr: true, supplier_shop_name: true } } },
    orderBy: { id: 'asc' },
  });
  for (const r of rows) {
    console.log(`#${r.id} ${r.created_at.toISOString().slice(0, 10)} ${r.products.code} (${r.products.supplier_shop_name}) "${r.products.name_tr}"`);
  }
  if (apply && rows.length) {
    await prisma.instagram_product_posts.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { status: 'queued', error_message: null },
    });
  }
  console.log(apply ? `requeued ${rows.length} post(s)` : `${rows.length} post(s) would be requeued — re-run with --apply to do it`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
