// One-off: site importers apply site.markup_percent on top of the source
// site's already-discounted price (see backend/utils/siteImport.js) — with
// a big enough markup, that marked-up discounted_price can end up ABOVE the
// product's own original price, showing customers a "discount" that costs
// more than the "original" on the same page. The importers now refuse to
// create a product in that state, but this retroactively hides any that
// were already imported before that guard existed.
// Run manually once: node scripts/hideBrokenDiscounts.js
const prisma = require('../prisma/client');

(async () => {
  const broken = await prisma.products.findMany({
    where: { is_active: true, discounted_price: { not: null } },
    select: { id: true, name_tr: true, price: true, discounted_price: true },
  });
  const toHide = broken.filter(p => Number(p.discounted_price) > Number(p.price));
  if (!toHide.length) { console.log('nothing to hide'); return; }

  for (const p of toHide) {
    await prisma.products.update({
      where: { id: p.id },
      data: { is_active: false, is_dirty: true },
    });
    console.log(`hid #${p.id} (discounted_price ${p.discounted_price} > price ${p.price}): ${p.name_tr}`);
  }
  console.log(`done: ${toHide.length} product(s) hidden`);
})();
