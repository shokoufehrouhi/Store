// One-off: adminController.js's resolveProductTag() now auto-forces a
// product to tag='sold_out' when every one of its sizes has 0 stock across
// all colors (fixed 2026-09-23) — but that logic only runs on the next
// admin create/update, so products that were already fully out of stock
// before the fix stayed stuck on their old tag with product_sizes.is_available
// still true. Confirmed live via /api/products: SHIL00000100 (id 23) has
// stock:0, every product_inventory row quantity:0, but tag:"new" and every
// product_sizes row is_available:true. This backfills every product already
// in that state — same size-only scope as the live fix (color-only /
// no-variant products are untouched, matching resolveProductTag).
// Run manually once: node scripts/backfillSoldOutTags.js
const prisma = require('../prisma/client');

(async () => {
  const products = await prisma.products.findMany({
    where: { product_sizes: { some: {} } },
    select: {
      id: true, name_tr: true, tag: true,
      product_sizes:     { select: { size_label: true, is_available: true } },
      product_inventory: { select: { size_label: true, quantity: true } },
    },
  });

  let tagged = 0;
  let sizesFixed = 0;

  for (const p of products) {
    const qtyBySize = new Map();
    for (const inv of p.product_inventory) {
      if (!inv.size_label) continue;
      qtyBySize.set(inv.size_label, (qtyBySize.get(inv.size_label) || 0) + inv.quantity);
    }
    if (!qtyBySize.size) continue;

    const allSoldOut = p.product_sizes.every(s =>
      qtyBySize.has(s.size_label) ? qtyBySize.get(s.size_label) <= 0 : s.is_available === false
    );
    if (!allSoldOut) continue;

    const staleSizes = p.product_sizes.filter(s => s.is_available !== false).map(s => s.size_label);
    if (staleSizes.length) {
      await prisma.product_sizes.updateMany({
        where: { product_id: p.id, size_label: { in: staleSizes } },
        data: { is_available: false },
      });
      sizesFixed += staleSizes.length;
    }
    if (p.tag !== 'sold_out') {
      await prisma.products.update({ where: { id: p.id }, data: { tag: 'sold_out', is_dirty: true } });
      console.log(`#${p.id} tag ${p.tag || '(none)'} -> sold_out: ${p.name_tr}`);
      tagged++;
    }
  }

  console.log(`done: ${tagged} product(s) tagged sold_out, ${sizesFixed} stale product_sizes row(s) marked unavailable`);
})();
