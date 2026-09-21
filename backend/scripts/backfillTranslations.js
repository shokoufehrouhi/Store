// One-off/reusable: fills in name_fa/name_en/desc_fa/desc_en for products
// that were imported from a single-language site (name_tr set, name_fa/
// name_en left empty) using the free MyMemory translation API.
// Run manually after each site import: node scripts/backfillTranslations.js
const prisma = require('../prisma/client');
const { translateText } = require('../utils/translate');

(async () => {
  const products = await prisma.products.findMany({
    where: {
      name_tr: { not: '' },
      OR: [{ name_fa: '' }, { name_en: '' }],
    },
  });
  if (!products.length) { console.log('nothing to translate'); return; }

  for (const p of products) {
    try {
      const data = {};
      if (!p.name_fa) data.name_fa = await translateText(p.name_tr, 'tr', 'fa');
      if (!p.name_en) data.name_en = await translateText(p.name_tr, 'tr', 'en');
      if (p.desc_tr && !p.desc_fa) data.desc_fa = await translateText(p.desc_tr, 'tr', 'fa');
      if (p.desc_tr && !p.desc_en) data.desc_en = await translateText(p.desc_tr, 'tr', 'en');
      if (Object.keys(data).length) {
        data.is_dirty = true;
        data.updated_at = new Date();
        await prisma.products.update({ where: { id: p.id }, data });
        console.log(`[ok] #${p.id} ${p.name_tr}`);
      }
    } catch (err) {
      console.log(`[error] #${p.id} ${p.name_tr} — ${err.message}`);
    }
  }
  await prisma.$disconnect();
})().catch(err => { console.error(err); process.exit(1); });
