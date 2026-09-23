// One-off: 6 early products (ids 67-72, among the very first Defacto test
// imports) have brand: "DeFacto" while every other Defacto product (203 of
// them) has brand: "Defacto" — supplier_shop_name is "Defacto" (correct)
// on these same 6 rows, so only the brand field itself diverged, most
// likely a manual admin-panel edit early in testing. Because the frontend
// brand filter groups products by the exact string value of p.brand (see
// frontend/main.js's brand-checkbox list), this split one real brand into
// two separate filter options — checking "DeFacto" showed only 6 products
// (1 page) while the real 203 sat under a separate "Defacto" checkbox,
// which is what the user was reporting as "only one page of results."
// Run manually once: node scripts/fixDefactoBrandCasing.js
const prisma = require('../prisma/client');

(async () => {
  const result = await prisma.products.updateMany({
    where: { brand: 'DeFacto' },
    data: { brand: 'Defacto', is_dirty: true },
  });
  console.log(`done: ${result.count} product(s) normalized from "DeFacto" to "Defacto"`);
})();
