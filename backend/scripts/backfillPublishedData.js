// One-off: run once after adding is_dirty/published_data columns, before
// restarting the app with code that reads published_data. Freezes whatever
// is currently active/live right now as the initial "published" baseline.
const prisma = require('../prisma/client');
const { PRODUCT_INCLUDE, buildProductSnapshot, buildCategorySnapshot, buildSubcategorySnapshot } = require('../utils/publishSnapshot');

async function main() {
  // Only rows already is_live: true need an immediate snapshot — that's
  // exactly what the new getAll/categories code will try to serve the
  // instant it deploys. is_live: false rows stay hidden either way, so
  // they're left as-is (is_dirty stays at its default `true`) and will get
  // a proper snapshot the next time someone clicks Publish.
  const products = await prisma.products.findMany({ where: { is_live: true }, include: PRODUCT_INCLUDE });
  const categories = await prisma.categories.findMany({ where: { is_live: true } });
  const subcategories = await prisma.subcategories.findMany({ where: { is_live: true } });

  await prisma.$transaction(
    products.map(p => prisma.products.update({
      where: { id: p.id },
      data: { published_data: buildProductSnapshot(p), is_dirty: false },
    }))
  );
  await prisma.$transaction(
    categories.map(c => prisma.categories.update({
      where: { id: c.id },
      data: { published_data: buildCategorySnapshot(c), is_dirty: false },
    }))
  );
  await prisma.$transaction(
    subcategories.map(s => prisma.subcategories.update({
      where: { id: s.id },
      data: { published_data: buildSubcategorySnapshot(s), is_dirty: false },
    }))
  );

  console.log(`Backfilled ${products.length} products, ${categories.length} categories, ${subcategories.length} subcategories.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
