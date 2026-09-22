// One-off/reusable: fills in name_fa/name_en/desc_fa/desc_en for products
// that were imported from a single-language site (name_tr set, name_fa/
// name_en left empty, OR left as a Turkish-fallback stopgap where
// name_fa/desc_fa === name_tr/desc_tr) using the free MyMemory translation API.
// Run manually after each site import: node scripts/backfillTranslations.js
const prisma = require('../prisma/client');
const { translateText, sleep } = require('../utils/translate');

const needsTranslation = (val, fallback) => !val || val === fallback;

// Spaced out (not just retried) to stay under MyMemory's burst rate limit —
// 4 calls/product back-to-back with no gap gets HTTP 429'd almost every time.
async function translateField(data, key, text, lang) {
  try {
    data[key] = await translateText(text, 'tr', lang);
  } catch (err) {
    console.log(`  [field error] ${key}: ${err.message}`);
  }
  await sleep(1200);
}

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
    // Collected per-field (not one try/catch around all four) so one failed
    // field doesn't throw away translations that already succeeded for
    // this product — partial progress still gets saved.
    const data = {};
    if (needsTranslation(p.name_fa, p.name_tr)) await translateField(data, 'name_fa', p.name_tr, 'fa');
    if (needsTranslation(p.name_en, p.name_tr)) await translateField(data, 'name_en', p.name_tr, 'en');
    if (p.desc_tr && needsTranslation(p.desc_fa, p.desc_tr)) await translateField(data, 'desc_fa', p.desc_tr, 'fa');
    if (p.desc_tr && needsTranslation(p.desc_en, p.desc_tr)) await translateField(data, 'desc_en', p.desc_tr, 'en');

    if (Object.keys(data).length) {
      data.is_dirty = true;
      data.updated_at = new Date();
      try {
        await prisma.products.update({ where: { id: p.id }, data });
        console.log(`[ok] #${p.id} ${p.name_tr}`);
      } catch (err) {
        console.log(`[db error] #${p.id} ${p.name_tr} — ${err.message}`);
      }
    } else {
      console.log(`[skip] #${p.id} ${p.name_tr} — all fields failed`);
    }
  }
  await prisma.$disconnect();
})().catch(err => { console.error(err); process.exit(1); });
