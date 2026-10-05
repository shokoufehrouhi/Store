// One-off (2026-10-05): imported products sitting at stock 0 with nothing
// in stock in any size/color, yet not tagged sold_out — 60 on the live
// site, mostly Zara and Koton. Their importers used to import a product
// even when every size was already sold out (fixed in the same commit), and
// the generic stock check can't read those sites, so nothing ever tagged
// them. They're tagged sold_out here; scheduler.js takes sold-out products
// off the site 5 days after sold_out_at.
//
// Left alone: products with no source site (added by hand in admin — their
// stock is set by hand) and MClub (its own "Sync Stock" handles it).
// Changed products are marked dirty: publish them from the admin.
// Dry run first (prints what would change):
//   node scripts/tagZeroStockSoldOut.js
// Then for real:
//   node scripts/tagZeroStockSoldOut.js --apply
const prisma = require('../prisma/client');

(async () => {
  const apply = process.argv.includes('--apply');
  const products = await prisma.products.findMany({
    where: {
      is_active: true,
      stock: 0,
      OR: [{ tag: null }, { tag: { not: 'sold_out' } }],
      supplier_shop_name: { not: null, notIn: ['MClub'] },
    },
    select: { id: true, code: true, name_tr: true, tag: true, supplier_shop_name: true, product_inventory: { select: { quantity: true } } },
    orderBy: { id: 'asc' },
  });
  const zero = products.filter(p => p.product_inventory.every(i => i.quantity === 0));
  for (const p of zero) console.log(`${p.code} (${p.supplier_shop_name}) tag ${p.tag || '-'} "${p.name_tr}"`);
  if (apply && zero.length) {
    await prisma.products.updateMany({
      where: { id: { in: zero.map(p => p.id) } },
      data: { tag: 'sold_out', sold_out_at: new Date(), is_dirty: true, updated_at: new Date() },
    });
  }
  console.log(apply ? `tagged ${zero.length} product(s) sold_out` : `${zero.length} product(s) would be tagged sold_out — re-run with --apply to do it`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
