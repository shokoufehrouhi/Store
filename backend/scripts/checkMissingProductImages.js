// Read-only check: lists every product with zero product_media rows, so we
// can confirm backfillMissingProductImages.js actually cleared them all
// (or see what's left — some products can genuinely have no usable image
// left on the source site anymore, e.g. it went out of stock/discontinued,
// which the backfill logs but can't fix).
// Run: node scripts/checkMissingProductImages.js
const prisma = require('../prisma/client');

(async () => {
  const products = await prisma.products.findMany({
    where: { product_media: { none: {} } },
    select: { id: true, code: true, name_tr: true, product_link: true, supplier_shop_name: true },
    orderBy: { id: 'asc' },
  });
  console.log(`${products.length} product(s) with zero images:`);
  products.forEach(p => {
    console.log(`#${p.id} ${p.code} [${p.supplier_shop_name || 'manual'}] ${p.name_tr}${p.product_link ? ' - ' + p.product_link : ''}`);
  });
})();
