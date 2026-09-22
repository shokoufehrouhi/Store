// Keeps a subcategory's is_active flag as an automatic reflection of whether
// it has any active products (via products.subcategory_id directly, or via
// the product_categories extra-categories join table) — never a manual
// setting. Off when empty, back on the moment a product lands in it.
const prisma = require('../prisma/client');

async function subcategoryHasActiveProducts(subcategoryId) {
  const [primary, extra] = await Promise.all([
    prisma.products.count({ where: { subcategory_id: subcategoryId, is_active: true } }),
    prisma.product_categories.count({ where: { subcategory_id: subcategoryId, products: { is_active: true } } }),
  ]);
  return (primary + extra) > 0;
}

async function syncSubcategoryActiveState(subcategoryId) {
  if (!subcategoryId) return;
  const hasProducts = await subcategoryHasActiveProducts(subcategoryId);
  const sub = await prisma.subcategories.findUnique({ where: { id: subcategoryId }, select: { is_active: true } });
  if (sub && sub.is_active !== hasProducts) {
    await prisma.subcategories.update({ where: { id: subcategoryId }, data: { is_active: hasProducts, is_dirty: true } });
  }
}

async function reconcileAllSubcategories() {
  const subs = await prisma.subcategories.findMany({ select: { id: true } });
  for (const s of subs) await syncSubcategoryActiveState(s.id);
}

module.exports = { syncSubcategoryActiveState, reconcileAllSubcategories };
