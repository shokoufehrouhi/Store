// One-off cleanup of active products with no colors, sizes or inventory
// rows that sat at stock 0 while not tagged sold_out (found 2026-10-03):
//
// - Zara: the importer hardcoded stock 0 for colorless one-size items
//   (perfumes) — scrapeZaraProduct never read their availability (fixed in
//   the same commit). All 6 were confirmed InStock on zara.com the same
//   day, so they get the importers' usual in-stock placeholder of 10.
// - KikoMilano: these really were out of stock — KikoMilano() saves a
//   variant-less product with stock 0 only when its page showed the
//   notify-me button — but still carried tag 'discount'. Tagged sold_out
//   (scheduler.js deactivates them 5 days after sold_out_at).
//
// Products a person zeroed by saving them in admin (the admin.html bug fixed
// in daad414, e.g. 2 Flying Tiger items) are left alone: their real stock
// isn't knowable from here, it's set by hand in admin. MClub is left to its
// own "Sync Stock".
//
// Dry run by default; pass --apply to write. Changed products are marked
// is_dirty, so they need a Publish in admin to reach the live site.
// Run: node scripts/fixZeroStockNoVariantProducts.js [--apply]
const prisma = require('../prisma/client');

const ZARA_RESTORED_STOCK = 10;
const apply = process.argv.includes('--apply');

function stuckAtZero(site) {
  return prisma.products.findMany({
    where: {
      supplier_shop_name: site,
      is_active: true,
      stock: 0,
      OR: [{ tag: null }, { tag: { not: 'sold_out' } }],
      product_colors: { none: {} },
      product_sizes: { none: {} },
      product_inventory: { none: {} },
    },
    select: { id: true, code: true, name_tr: true, tag: true },
    orderBy: { id: 'asc' },
  });
}

(async () => {
  const zara = await stuckAtZero('Zara');
  const kiko = await stuckAtZero('KikoMilano');
  for (const p of zara) console.log(`Zara #${p.id} ${p.code}: stock 0 -> ${ZARA_RESTORED_STOCK} — ${p.name_tr}`);
  for (const p of kiko) console.log(`Kiko #${p.id} ${p.code}: tag ${p.tag || '(none)'} -> sold_out — ${p.name_tr}`);
  console.log(`\nZara: ${zara.length}, KikoMilano: ${kiko.length}`);

  if (!apply) {
    console.log('Dry run — nothing changed. Re-run with --apply to write.');
  } else {
    const now = new Date();
    const z = await prisma.products.updateMany({
      where: { id: { in: zara.map(p => p.id) }, stock: 0 },
      data: { stock: ZARA_RESTORED_STOCK, is_dirty: true, updated_at: now },
    });
    const k = await prisma.products.updateMany({
      where: { id: { in: kiko.map(p => p.id) }, stock: 0, NOT: { tag: 'sold_out' } },
      data: { tag: 'sold_out', sold_out_at: now, is_dirty: true, updated_at: now },
    });
    console.log(`Updated Zara ${z.count}, KikoMilano ${k.count}. Publish in admin to make it live.`);
  }
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
