// One-off: adminController.js's resolveProductTag() now auto-forces a
// product to tag='sold_out' when every one of its sizes has 0 stock across
// all colors (fixed 2026-09-23), or — for a color-only product with no
// sizes at all, e.g. a bag with just color swatches — every color has 0
// stock (fixed 2026-09-25, found via SHIL00000110 on staging: one color,
// qty 0, stayed tagged manually since the original fix only ever checked
// sizes). Both fixes only run on the next admin create/update, so products
// already fully out of stock before either fix stayed stuck on their old
// tag with product_sizes/product_colors.is_available still true. Confirmed
// live via /api/products: SHIL00000100 (id 23) has stock:0, every
// product_inventory row quantity:0, but tag:"new" and every product_sizes
// row is_available:true. This backfills every product already in either
// state, mirroring resolveProductTag's own two branches exactly (sizes
// checked first — a full color×size matrix only ever needs the size
// check, since summing inventory by size already nets out every color).
// Run manually once: node scripts/backfillSoldOutTags.js
const prisma = require('../prisma/client');

async function applySoldOut(p, staleLabel) {
  if (p.tag === 'sold_out') return false;
  await prisma.products.update({ where: { id: p.id }, data: { tag: 'sold_out', is_dirty: true } });
  console.log(`#${p.id} tag ${p.tag || '(none)'} -> sold_out (${staleLabel}): ${p.name_tr}`);
  return true;
}

(async () => {
  let tagged = 0;
  let staleFixed = 0;

  const sizedProducts = await prisma.products.findMany({
    where: { product_sizes: { some: {} } },
    select: {
      id: true, name_tr: true, tag: true,
      product_sizes:     { select: { size_label: true, is_available: true } },
      product_inventory: { select: { size_label: true, quantity: true } },
    },
  });
  for (const p of sizedProducts) {
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
      staleFixed += staleSizes.length;
    }
    if (await applySoldOut(p, 'sizes')) tagged++;
  }

  const colorOnlyProducts = await prisma.products.findMany({
    where: { product_colors: { some: {} }, product_sizes: { none: {} } },
    select: {
      id: true, name_tr: true, tag: true,
      product_colors:    { select: { color_id: true, is_available: true } },
      product_inventory: { select: { color_id: true, quantity: true } },
    },
  });
  for (const p of colorOnlyProducts) {
    const qtyByColor = new Map();
    for (const inv of p.product_inventory) {
      if (inv.color_id == null) continue;
      qtyByColor.set(inv.color_id, (qtyByColor.get(inv.color_id) || 0) + inv.quantity);
    }
    if (!qtyByColor.size) continue;

    const allSoldOut = p.product_colors.every(c =>
      qtyByColor.has(c.color_id) ? qtyByColor.get(c.color_id) <= 0 : c.is_available === false
    );
    if (!allSoldOut) continue;

    const staleColors = p.product_colors.filter(c => c.is_available !== false).map(c => c.color_id);
    if (staleColors.length) {
      await prisma.product_colors.updateMany({
        where: { product_id: p.id, color_id: { in: staleColors } },
        data: { is_available: false },
      });
      staleFixed += staleColors.length;
    }
    if (await applySoldOut(p, 'colors')) tagged++;
  }

  console.log(`done: ${tagged} product(s) tagged sold_out, ${staleFixed} stale product_sizes/product_colors row(s) marked unavailable`);
})();
