// The daily Instagram Reels plan (user's choice, 2026-10-06): two reels a
// day, at 12:00 and 20:00, each showing the discounted products of one
// group, by weekday:
//   Saturday   12 men's clothing   20 women's clothing
//   Sunday     12 kids' clothing   20 cosmetics
//   Monday     12 lifestyle        20 women's clothing
//   Tuesday    12 cosmetics        20 men's clothing
//   Wednesday  12 lifestyle        20 bags & shoes
//   Thursday   12 lifestyle        20 women's clothing
//   Friday     12 men's clothing   20 women's clothing
// Like the stories, each is generated as a draft two hours ahead (10:00 and
// 18:00) and posted automatically at its time unless the admin deletes it.

const REEL_SLOTS = {
  'reel-12:00': { time: '12:00', genTime: '10:00' },
  'reel-20:00': { time: '20:00', genTime: '18:00' },
};

// `where` narrows the products table to the group (combined with the usual
// "active, live, has a photo, discounted" conditions by the caller).
const REEL_GROUPS = {
  men:       { headline: 'تخفیف‌های لباس مردانه',  tags: ['#لباس_مردانه', '#مد_مردانه'], where: { gender: 'male', category_id: { in: [1, 7] } } },
  women:     { headline: 'تخفیف‌های لباس زنانه',   tags: ['#لباس_زنانه', '#مد_زنانه'],   where: { gender: 'female', category_id: { in: [1, 7] } } },
  kids:      { headline: 'تخفیف‌های لباس بچگانه',  tags: ['#لباس_بچگانه', '#کودک'],      where: { gender: 'kids', category_id: { in: [1, 7] } } },
  cosmetics: { headline: 'تخفیف‌های آرایشی',       tags: ['#آرایشی', '#لوازم_آرایش'],   where: { category_id: 10 } },
  lifestyle: { headline: 'تخفیف‌های خانه و دکور',  tags: ['#دکوراسیون', '#لایف_استایل'], where: { category_id: 8 } },
  bagsShoes: { headline: 'تخفیف‌های کیف و کفش',    tags: ['#کیف', '#کفش'],              where: { OR: [{ category_id: 2 }, { subcategory_id: 13 }] } },
};

// Date#getDay(): 0 Sunday ... 6 Saturday.
const WEEKLY_PLAN = {
  6: { 'reel-12:00': 'men',       'reel-20:00': 'women' },
  0: { 'reel-12:00': 'kids',      'reel-20:00': 'cosmetics' },
  1: { 'reel-12:00': 'lifestyle', 'reel-20:00': 'women' },
  2: { 'reel-12:00': 'cosmetics', 'reel-20:00': 'men' },
  3: { 'reel-12:00': 'lifestyle', 'reel-20:00': 'bagsShoes' },
  4: { 'reel-12:00': 'lifestyle', 'reel-20:00': 'women' },
  5: { 'reel-12:00': 'men',       'reel-20:00': 'women' },
};

// The group for a slot on a given local date ("YYYY-MM-DD").
function reelGroupFor(slot, dateStr) {
  const weekday = new Date(`${dateStr}T12:00:00`).getDay();
  const key = WEEKLY_PLAN[weekday]?.[slot];
  return key ? { key, ...REEL_GROUPS[key] } : null;
}

const toFaDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

function reelCaption(group, products) {
  const cuts = products
    .filter((p) => p.discounted_price != null && Number(p.discounted_price) < Number(p.price))
    .map((p) => Math.round((Number(p.price) - Number(p.discounted_price)) / Number(p.price) * 100));
  const best = cuts.length ? Math.max(...cuts) : 0;
  const lines = [`🔥 ${group.headline}`];
  if (best > 0) lines.push(`تا ${toFaDigits(best)}٪ تخفیف روی محصولات منتخب امروز`);
  lines.push('', '🛍 shilista.com', '', ['#Shilista', '#شیلیستا', '#تخفیف', ...group.tags].join(' '));
  return lines.join('\n');
}

module.exports = { REEL_SLOTS, REEL_GROUPS, reelGroupFor, reelCaption };
