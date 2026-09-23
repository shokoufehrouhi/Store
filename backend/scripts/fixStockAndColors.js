// One-off: two related data-consistency issues found live on production
// (confirmed via /api/products: 43 products affected by the first, 1 by the
// second, as of 2026-09-23):
//
// 1. products.stock (the aggregate shown everywhere in the UI) can drift out
//    of sync with the real sum of that product's own product_inventory rows
//    — e.g. SHIL00000600 had product_inventory quantities summing to 42 but
//    stock still read 70. The admin panel's edit-product form was found to
//    always submit stock:0 in its save payload regardless of what was
//    actually entered in the per-color/size quantity inputs (fixed
//    separately in frontend/admin.html — this script only backfills
//    already-broken data, it doesn't touch anything going forward).
// 2. product_inventory can reference a color_id that has no matching
//    product_colors row for that product, meaning the product never shows
//    that color as a selectable swatch at all even though stock is tracked
//    against it.
//
// Run manually once: node scripts/fixStockAndColors.js
const prisma = require('../prisma/client');

(async () => {
  const products = await prisma.products.findMany({
    where: { product_inventory: { some: {} } },
    select: {
      id: true, name_tr: true, stock: true,
      product_inventory: { select: { color_id: true, quantity: true } },
      product_colors: { select: { color_id: true } },
    },
  });

  let stockFixed = 0;
  let colorsAdded = 0;

  for (const p of products) {
    const invSum = p.product_inventory.reduce((sum, i) => sum + i.quantity, 0);
    if (invSum !== p.stock) {
      await prisma.products.update({ where: { id: p.id }, data: { stock: invSum, is_dirty: true } });
      console.log(`#${p.id} stock ${p.stock} -> ${invSum}: ${p.name_tr}`);
      stockFixed++;
    }

    const existingColorIds = new Set(p.product_colors.map(c => c.color_id));
    const invColorIds = new Set(p.product_inventory.map(i => i.color_id).filter(Boolean));
    for (const colorId of invColorIds) {
      if (!existingColorIds.has(colorId)) {
        await prisma.product_colors.create({
          data: { product_id: p.id, color_id: colorId, is_available: true },
        });
        console.log(`#${p.id} added missing product_colors row for color_id=${colorId}: ${p.name_tr}`);
        colorsAdded++;
      }
    }
  }

  console.log(`done: ${stockFixed} product(s) had stock recomputed, ${colorsAdded} missing product_colors row(s) added`);
})();
