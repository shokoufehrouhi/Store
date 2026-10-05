// One-off: until 2026-10-05 the importers' keyword table matched "tshirt"
// inside "sweatshirt", so imported sweatshirts were filed as T-shirts
// (Clothing subcategory 1, or Sports 26) instead of Sweatshirt (5, or
// Sports 30). Fixed for new imports in utils/siteImport.js; this moves the
// ones already imported. Only names that say sweatshirt and nothing
// T-shirt-like are touched. Moved products are marked dirty — publish them
// from the admin panel for the storefront to pick it up.
// Dry run first (prints what would change):
//   node scripts/fixSweatshirtSubcategory.js
// Then for real:
//   node scripts/fixSweatshirtSubcategory.js --apply
const prisma = require('../prisma/client');
const { syncSubcategoryActiveState } = require('../utils/subcategorySync');

const MOVES = [
  { category_id: 1, from: 1, to: 5 },   // Clothing: T-Shirt -> Sweatshirt
  { category_id: 7, from: 26, to: 30 }, // Sports: Sports T-Shirts -> Track Jacket (sweatshirts)
];

(async () => {
  const apply = process.argv.includes('--apply');
  let total = 0;
  for (const m of MOVES) {
    const rows = await prisma.products.findMany({
      where: { category_id: m.category_id, subcategory_id: m.from },
      select: { id: true, code: true, name_tr: true, supplier_shop_name: true },
    });
    const wrong = rows.filter(p => /sweatshirt/i.test(p.name_tr) && !/tişört|t-shirt|\btshirt/i.test(p.name_tr));
    for (const p of wrong) console.log(`${p.code} (${p.supplier_shop_name || '-'}) "${p.name_tr}": subcategory ${m.from} -> ${m.to}`);
    if (apply && wrong.length) {
      await prisma.products.updateMany({
        where: { id: { in: wrong.map(p => p.id) } },
        data: { subcategory_id: m.to, is_dirty: true, updated_at: new Date() },
      });
      await syncSubcategoryActiveState(m.from);
      await syncSubcategoryActiveState(m.to);
    }
    total += wrong.length;
  }
  console.log(apply ? `moved ${total} product(s)` : `${total} product(s) would move — re-run with --apply to do it`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
