// Fills in name_fa/name_en/desc_fa/desc_en for products whose translation
// failed at import (see utils/translationBackfill.js). The scheduler also
// runs this after every nightly import; by hand:
//   node -r dotenv/config scripts/backfillTranslations.js
const prisma = require('../prisma/client');
const { backfillTranslations } = require('../utils/translationBackfill');

(async () => {
  const result = await backfillTranslations();
  console.log(result.candidates ? JSON.stringify(result) : 'nothing to translate');
  await prisma.$disconnect();
})().catch(err => { console.error(err); process.exit(1); });
