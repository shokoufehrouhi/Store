// Products never shown in Instagram posts, stories or reels (user rules
// 2026-11-15 / 2026-11-18): underwear/sleepwear, socks, house slippers and
// cheap accessories. Matched by subcategory key, plus name keywords for
// products that have no subcategory.
const EXCLUDED_SUBCATEGORY_KEYS = ['underwear', 'socks', 'hair'];
const EXCLUDED_NAME_WORDS = ['çorap', 'iç giyim', 'iç çamaşır', 'külot', 'boxer', 'sütyen', 'pijama', 'gecelik', 'terlik', 'panduf', 'slipper'];
// Accessories (category 3) priced below this (TL, after discount) are skipped.
const ACCESSORY_MIN_PRICE_TL = 500;
const ACCESSORY_CATEGORY_ID = 3;

// Prisma `where` fragment for products.findMany.
const IG_EXCLUDED_WHERE = {
  AND: [
    { OR: [{ subcategory_id: null }, { subcategories: { key: { notIn: EXCLUDED_SUBCATEGORY_KEYS } } }] },
    ...EXCLUDED_NAME_WORDS.map(w => ({ NOT: { name_tr: { contains: w, mode: 'insensitive' } } })),
    { NOT: { category_id: ACCESSORY_CATEGORY_ID, OR: [
      { discounted_price: { lt: ACCESSORY_MIN_PRICE_TL } },
      { discounted_price: null, price: { lt: ACCESSORY_MIN_PRICE_TL } },
    ] } },
  ],
};

module.exports = { IG_EXCLUDED_WHERE, EXCLUDED_SUBCATEGORY_KEYS, EXCLUDED_NAME_WORDS, ACCESSORY_MIN_PRICE_TL };
