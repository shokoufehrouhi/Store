// One-off: products imported by Defacto/LCWaikiki before getOrCreateColorId
// existed (see backend/utils/siteImport.js) were left with color_id: null
// throughout — e.g. SHIL00000594 ("Mürdüm Crop Flare Kadın Jean Pantolon")
// has 8 product_inventory rows, all color_id: null, and an empty
// product_colors, even though "Mürdüm" is a perfectly real color the title
// leads with (same convention getOrCreateColorId already relies on for new
// imports from these two sites). This backfills those specific two sites
// only — Zara's title doesn't lead with color (color is the last segment)
// and MadameCoco's color field doubles as scent names, so this leading-
// word extraction isn't safe to apply there.
// Run manually once: node scripts/backfillMissingColors.js
const prisma = require('../prisma/client');
const { extractLeadingColorWord, getOrCreateColorId } = require('../utils/siteImport');

(async () => {
  const candidates = await prisma.products.findMany({
    where: {
      supplier_shop_name: { in: ['Defacto', 'LCWaikiki'] },
      product_colors: { none: {} },
    },
    select: { id: true, name_tr: true, product_inventory: { select: { id: true, color_id: true } } },
  });
  // Only ones where every inventory row is genuinely uncolored — a product
  // with a real color already set on *some* rows isn't this bug.
  const toFix = candidates.filter(p => p.product_inventory.every(i => i.color_id == null));
  if (!toFix.length) { console.log('nothing to backfill'); return; }

  let fixed = 0, unresolved = 0;
  for (const p of toFix) {
    const word = extractLeadingColorWord(p.name_tr);
    const colorId = await getOrCreateColorId(word);
    if (!colorId) {
      console.log(`#${p.id} could not resolve a color from "${word}": ${p.name_tr}`);
      unresolved++;
      continue;
    }
    await prisma.product_colors.create({ data: { product_id: p.id, color_id: colorId, is_available: true } });
    if (p.product_inventory.length) {
      await prisma.product_inventory.updateMany({
        where: { product_id: p.id, color_id: null },
        data: { color_id: colorId },
      });
    }
    console.log(`#${p.id} backfilled color_id=${colorId} (from "${word}"): ${p.name_tr}`);
    fixed++;
  }
  console.log(`done: ${fixed} product(s) backfilled, ${unresolved} left unresolved`);
})();
