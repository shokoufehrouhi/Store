// One-off: products imported twice. Until 2026-10-06 staging and production
// both ran every site's import at the same time against the shared database
// (fixed with claimSiteRun in utils/siteSync.js), and the link-based
// importers compared exact URLs, so a product Defacto/Koton/Zara renamed
// came back as a second copy (fixed with productLinkKey). This finds every
// group of products of one site with the same product (same productLinkKey
// of their link) and keeps the oldest ACTIVE one; the other active ones are
// taken off the site (is_active/is_live false), not deleted, so orders and
// carts that point at them keep working. Groups with no active product, or
// only one, are left alone, and so are suppliers without an importer
// (products an admin added by hand).
// Dry run first (prints what would change):
//   node scripts/deactivateDuplicateProducts.js
// Then for real:
//   node scripts/deactivateDuplicateProducts.js --apply
// Afterwards, queued Instagram posts of the hidden copies can be cleared
// with scripts/skipQueuedPostsOfInactiveProducts.js.
const prisma = require('../prisma/client');
const { productLinkKey } = require('../utils/siteImport');
const { syncSubcategoryActiveState } = require('../utils/subcategorySync');
const { hasImporter } = require('../utils/siteSync');

(async () => {
  const apply = process.argv.includes('--apply');
  const products = await prisma.products.findMany({
    where: { product_link: { not: null }, supplier_shop_name: { not: null } },
    select: { id: true, code: true, name_tr: true, is_active: true, supplier_shop_name: true, product_link: true, subcategory_id: true },
    orderBy: { id: 'asc' },
  });
  const groups = new Map();
  for (const p of products) {
    if (!hasImporter(p.supplier_shop_name)) continue;
    const key = `${p.supplier_shop_name}|${productLinkKey(p.product_link)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const toHide = [];
  const perSite = {};
  for (const group of groups.values()) {
    const active = group.filter((p) => p.is_active);
    if (active.length < 2) continue;
    const [keep, ...extra] = active;
    console.log(`${keep.supplier_shop_name}: keep ${keep.code} "${keep.name_tr}" — hide ${extra.map((p) => p.code).join(', ')}`);
    toHide.push(...extra);
    perSite[keep.supplier_shop_name] = (perSite[keep.supplier_shop_name] || 0) + extra.length;
  }
  console.log('per site:', JSON.stringify(perSite));
  if (apply && toHide.length) {
    await prisma.products.updateMany({
      where: { id: { in: toHide.map((p) => p.id) } },
      data: { is_active: false, is_live: false, is_dirty: false, updated_at: new Date() },
    });
    for (const id of new Set(toHide.map((p) => p.subcategory_id).filter(Boolean))) await syncSubcategoryActiveState(id);
  }
  console.log(apply ? `hid ${toHide.length} duplicate product(s)` : `${toHide.length} duplicate product(s) would be hidden — re-run with --apply to do it`);
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
