// Products never shown in Instagram posts, stories or reels (user rule
// 2026-11-15): underwear/sleepwear and socks. Matched by subcategory key, plus
// name keywords for products that have no subcategory.
const EXCLUDED_SUBCATEGORY_KEYS = ['underwear', 'socks'];
const EXCLUDED_NAME_WORDS = ['çorap', 'iç giyim', 'iç çamaşır', 'külot', 'boxer', 'sütyen', 'pijama', 'gecelik'];

// Prisma `where` fragment for products.findMany.
const IG_EXCLUDED_WHERE = {
  AND: [
    { OR: [{ subcategory_id: null }, { subcategories: { key: { notIn: EXCLUDED_SUBCATEGORY_KEYS } } }] },
    ...EXCLUDED_NAME_WORDS.map(w => ({ NOT: { name_tr: { contains: w, mode: 'insensitive' } } })),
  ],
};

module.exports = { IG_EXCLUDED_WHERE, EXCLUDED_SUBCATEGORY_KEYS, EXCLUDED_NAME_WORDS };
