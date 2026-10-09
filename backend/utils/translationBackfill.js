// Fills in name_fa/name_en/desc_fa/desc_en for products imported from a
// single-language site whose translation failed at import (name_fa/name_en
// left empty, or left as a Turkish-fallback stopgap equal to name_tr/
// desc_tr) — using translateText (MyMemory, falling back to Azure
// Translator, see translate.js). Run by the scheduler after every nightly
// import and by scripts/backfillTranslations.js by hand: a failure at
// import time (quota spent, or the server's network dropping for a moment
// — "fetch failed", 2026-10-08) used to stay untranslated until someone
// ran the script.
const prisma = require('../prisma/client');
const { translateText, sleep } = require('./translate');

const needsTranslation = (val, fallback) => !val || val === fallback;

// Spaced out to stay under MyMemory's burst rate limit — 4 calls/product
// back-to-back with no gap gets HTTP 429'd almost every time.
//
// Many "Turkish" names are English already (MISSHA, Kiko…): tr->en gives
// the same text back, so the field still equals name_tr and keeps being
// picked up. Saving that would mark the product changed every night for
// nothing — it's left as is instead.
async function translateField(data, key, text, lang, log) {
  try {
    const translated = await translateText(text, 'tr', lang);
    if (translated.trim() !== text.trim()) data[key] = translated;
  } catch (err) {
    log(`  [field error] ${key}: ${err.message}`);
  }
  await sleep(1200);
}

async function backfillTranslations({ log = console.log } = {}) {
  const candidates = await prisma.products.findMany({
    where: { name_tr: { not: '' } },
  });
  // A product is picked up if ANY field still needs translation — the loop
  // below only calls the API for the specific field(s) that need it, so an
  // already-translated field is never re-called. Requiring EVERY field to
  // still be untranslated (tried previously) meant a product that partially
  // failed on one field would never be picked up again, leaving it stuck.
  const products = candidates.filter(p =>
    needsTranslation(p.name_fa, p.name_tr) ||
    needsTranslation(p.name_en, p.name_tr) ||
    (p.desc_tr && (needsTranslation(p.desc_fa, p.desc_tr) || needsTranslation(p.desc_en, p.desc_tr)))
  );
  const result = { candidates: products.length, updated: 0, unchanged: 0 };

  for (const p of products) {
    // Collected per-field (not one try/catch around all four) so one failed
    // field doesn't throw away translations that already succeeded for
    // this product — partial progress still gets saved.
    const data = {};
    if (needsTranslation(p.name_fa, p.name_tr)) await translateField(data, 'name_fa', p.name_tr, 'fa', log);
    if (needsTranslation(p.name_en, p.name_tr)) await translateField(data, 'name_en', p.name_tr, 'en', log);
    if (p.desc_tr && needsTranslation(p.desc_fa, p.desc_tr)) await translateField(data, 'desc_fa', p.desc_tr, 'fa', log);
    if (p.desc_tr && needsTranslation(p.desc_en, p.desc_tr)) await translateField(data, 'desc_en', p.desc_tr, 'en', log);

    if (Object.keys(data).length) {
      data.is_dirty = true;
      data.updated_at = new Date();
      try {
        await prisma.products.update({ where: { id: p.id }, data });
        result.updated++;
        log(`[ok] #${p.id} ${p.name_tr}`);
      } catch (err) {
        result.unchanged++;
        log(`[db error] #${p.id} ${p.name_tr} — ${err.message}`);
      }
    } else {
      result.unchanged++;
      log(`[skip] #${p.id} ${p.name_tr} — nothing new (already in that language, or failed)`);
    }
  }
  return result;
}

module.exports = { backfillTranslations };
