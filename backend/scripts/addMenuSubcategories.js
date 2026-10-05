// One-off (2026-10-05): the "All Products" menu is built from categories and
// their subcategories, and ~800 products had no subcategory because the
// right one didn't exist (dresses, shirts, skirts, every shoe, most
// accessories). This
//   1. creates the subcategories in MENU_SUBCATEGORY_DEFS (utils/siteImport.js)
//      that don't exist yet,
//   2. files every active product without a subcategory (Clothing, Shoes,
//      Accessories, Cosmetics) using the same keyword tables the importers
//      now use,
//   3. moves clothing that Koton's importer filed under Accessories because
//      of a word in its own name ("Kemerli Pantolon", "Metal Aksesuarlı
//      Bluz") back to Clothing.
// New subcategories and moved products are marked dirty: publish them from
// the admin panel for the site's menu to show them.
// Dry run first (prints what would change):
//   node scripts/addMenuSubcategories.js
// Then for real:
//   node scripts/addMenuSubcategories.js --apply
const prisma = require('../prisma/client');
const { loadSubcategoryIds, guessSubcategoryId, MENU_SUBCATEGORY_DEFS } = require('../utils/siteImport');
const { syncSubcategoryActiveState } = require('../utils/subcategorySync');

const CLOTHING_WORDS = /pantolon|şort|etek|bluz|gömlek|elbise|ceket|blazer|tulum|tişört|kazak|hırka|yelek|jean|tayt|eşofman|sweatshirt|mont|kaban|palto|trençkot|body|atlet|pijama|sabahlık|tunik/i;
// No "kemer" (belt) here: "Kemer Detaylı Şort" is shorts with a belt detail,
// while a real belt ("Deri Kemer") has no clothing word and stays put.
const ACCESSORY_WORDS = /çanta|cüzdan|kartlık|kolye|küpe|bileklik|yüzük|şapka|bere\b|kasket|atkı|şal\b|eldiven|gözlük|toka|anahtarlık|fular|çorap|kulaklık/i;

(async () => {
  const apply = process.argv.includes('--apply');

  // 1. subcategories
  const created = [];
  const planned = []; // dry run only: stand-in ids so the preview below works
  for (const [categoryId, defs] of Object.entries(MENU_SUBCATEGORY_DEFS)) {
    for (const [key, [label_tr, label_en, label_fa]] of Object.entries(defs)) {
      const exists = await prisma.subcategories.findFirst({ where: { category_id: Number(categoryId), key } });
      if (exists) continue;
      created.push(`${categoryId}:${key} "${label_en}"`);
      planned.push({ id: -(planned.length + 1), key, category_id: Number(categoryId), label_en: `${label_en} (new)` });
      if (apply) {
        await prisma.subcategories.create({ data: { category_id: Number(categoryId), key, label_tr, label_en, label_fa, is_dirty: true } });
      }
    }
  }
  console.log(`${created.length} new subcategor${created.length === 1 ? 'y' : 'ies'}: ${created.join(', ') || '-'}`);
  await loadSubcategoryIds(apply ? [] : planned);
  const subs = await prisma.subcategories.findMany({ select: { id: true, key: true, label_en: true } });
  const subName = new Map([...subs, ...planned].map(s => [s.id, s.label_en]));

  // 2 + 3. products
  const products = await prisma.products.findMany({
    where: { is_active: true, category_id: { in: [1, 2, 3, 10] } },
    select: { id: true, code: true, name_tr: true, category_id: true, subcategory_id: true, supplier_shop_name: true },
  });
  const changes = [];
  for (const p of products) {
    const isMisfiledClothing = p.category_id === 3 && CLOTHING_WORDS.test(p.name_tr) && !ACCESSORY_WORDS.test(p.name_tr);
    if (!isMisfiledClothing && p.subcategory_id != null) continue;
    const category_id = isMisfiledClothing ? 1 : p.category_id;
    const subcategory_id = guessSubcategoryId(p.name_tr, category_id);
    if (category_id === p.category_id && subcategory_id == null) continue;
    changes.push({ p, category_id, subcategory_id, moved: isMisfiledClothing });
  }

  const summary = new Map();
  for (const c of changes) {
    const k = `${c.moved ? 'Accessories -> Clothing / ' : ''}${c.subcategory_id ? subName.get(c.subcategory_id) : '-'}`;
    summary.set(k, (summary.get(k) || 0) + 1);
  }
  for (const [k, n] of [...summary].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
  for (const c of changes.filter(c => c.moved).slice(0, 30)) console.log(`  moved: ${c.p.code} (${c.p.supplier_shop_name}) "${c.p.name_tr}"`);

  if (apply) {
    const touched = new Set();
    for (const c of changes) {
      await prisma.products.update({
        where: { id: c.p.id },
        data: { category_id: c.category_id, subcategory_id: c.subcategory_id, is_dirty: true, updated_at: new Date() },
      });
      if (c.p.subcategory_id) touched.add(c.p.subcategory_id);
      if (c.subcategory_id) touched.add(c.subcategory_id);
    }
    // Every new subcategory too, so one nothing landed in (e.g. Heels,
    // Sunglasses today) stays switched off instead of showing up empty.
    for (const [categoryId, defs] of Object.entries(MENU_SUBCATEGORY_DEFS)) {
      for (const key of Object.keys(defs)) {
        const s = await prisma.subcategories.findFirst({ where: { category_id: Number(categoryId), key }, select: { id: true } });
        if (s) touched.add(s.id);
      }
    }
    for (const id of touched) await syncSubcategoryActiveState(id);
  }
  const left = products.filter(p => p.subcategory_id == null).length - changes.filter(c => c.subcategory_id && c.p.subcategory_id == null).length;
  console.log(apply ? `updated ${changes.length} product(s)` : `${changes.length} product(s) would change — re-run with --apply to do it`);
  console.log(`products still without a subcategory afterwards: ~${left}`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
