// One-off: site importers apply site.markup_percent on top of the source
// site's already-discounted price (see backend/utils/siteImport.js). With a
// big enough markup, that marked-up discounted_price can end up ABOVE the
// product's own original price (showing customers a "discount" that costs
// more than the "original" on the same page — hidden entirely) or exactly
// AT it (0% real saving left — kept visible, but retagged from 'discount'
// to 'original' so it doesn't show up wherever the site filters by
// tag=discount despite having nothing actually discounted). The importers
// now handle both cases themselves going forward; this retroactively fixes
// any product already imported before those guards existed.
// Run manually once: node scripts/hideBrokenDiscounts.js
const prisma = require('../prisma/client');

(async () => {
  const candidates = await prisma.products.findMany({
    where: { is_active: true, discounted_price: { not: null } },
    select: { id: true, name_tr: true, price: true, discounted_price: true, tag: true },
  });
  const toHide = candidates.filter(p => Number(p.discounted_price) > Number(p.price));
  const toRetag = candidates.filter(p => Number(p.discounted_price) === Number(p.price) && p.tag === 'discount');

  if (!toHide.length && !toRetag.length) { console.log('nothing to fix'); return; }

  for (const p of toHide) {
    await prisma.products.update({
      where: { id: p.id },
      data: { is_active: false, is_dirty: true },
    });
    console.log(`hid #${p.id} (discounted_price ${p.discounted_price} > price ${p.price}): ${p.name_tr}`);
  }
  for (const p of toRetag) {
    await prisma.products.update({
      where: { id: p.id },
      data: { tag: 'original', is_dirty: true },
    });
    console.log(`retagged #${p.id} (discounted_price ${p.discounted_price} == price ${p.price}) discount -> original: ${p.name_tr}`);
  }
  console.log(`done: ${toHide.length} hidden, ${toRetag.length} retagged`);
})();
