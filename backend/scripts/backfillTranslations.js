// One-off/reusable: fills in name_fa/name_en/desc_fa/desc_en for products
// that were imported from a single-language site (name_tr set, name_fa/
// name_en left empty, OR left as a Turkish-fallback stopgap where
// name_fa/desc_fa === name_tr/desc_tr) using the free MyMemory translation API.
// Run manually after each site import: node scripts/backfillTranslations.js
const prisma = require('../prisma/client');
const { translateText } = require('../utils/translate');

const needsTranslation = (val, fallback) => !val || val === fallback;

(async () => {
  const candidates = await prisma.products.findMany({
    where: { name_tr: { not: '' } },
  });
  const products = candidates.filter(p =>
    needsTranslation(p.name_fa, p.name_tr) ||
    needsTranslation(p.name_en, p.name_tr) ||
    (p.desc_tr && (needsTranslation(p.desc_fa, p.desc_tr) || needsTranslation(p.desc_en, p.desc_tr)))
  );
  if (!products.length) { console.log('nothing to translate'); return; }

  for (const p of products) {
    try {
      const data = {};
      if (needsTranslation(p.name_fa, p.name_tr)) data.name_fa = await translateText(p.name_tr, 'tr', 'fa');
      if (needsTranslation(p.name_en, p.name_tr)) data.name_en = await translateText(p.name_tr, 'tr', 'en');
      if (p.desc_tr && needsTranslation(p.desc_fa, p.desc_tr)) data.desc_fa = await translateText(p.desc_tr, 'tr', 'fa');
      if (p.desc_tr && needsTranslation(p.desc_en, p.desc_tr)) data.desc_en = await translateText(p.desc_tr, 'tr', 'en');
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
