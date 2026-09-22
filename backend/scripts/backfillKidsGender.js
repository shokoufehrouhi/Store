// One-off: retags already-imported products whose name is clearly a kids/
// baby item (Defacto/Zara both had separate "Kız Çocuk"/"Erkek Çocuk"/
// "Bebek"/"Yenidoğan" listings, previously mapped to male/female/unisex
// before the site had its own Kids nav) to gender='kids', so they show up
// under the new Kids menu instead of mixed into Women/Men.
// Run manually once after deploying the 'kids' gender_type enum value:
// node scripts/backfillKidsGender.js
const prisma = require('../prisma/client');

const KIDS_KEYWORD = /çocuk|bebek|yenidoğan/i;

(async () => {
  const candidates = await prisma.products.findMany({
    where: { gender: { in: ['male', 'female', 'unisex'] } },
    select: { id: true, name_tr: true, gender: true },
  });
  // toLocaleLowerCase('tr') isn't needed here since the regex itself is
  // case-insensitive and doesn't rely on manual lowercasing — the Turkish-I
  // trap only bites when you lowercase then compare, not with a /i regex.
  const kidsProducts = candidates.filter(p => KIDS_KEYWORD.test(p.name_tr));
  if (!kidsProducts.length) { console.log('nothing to retag'); return; }

  for (const p of kidsProducts) {
    await prisma.products.update({
      where: { id: p.id },
      data: { gender: 'kids', is_dirty: true },
    });
    console.log(`retagged #${p.id} (${p.gender} -> kids): ${p.name_tr}`);
  }
  console.log(`done: ${kidsProducts.length} product(s) retagged`);
})();
