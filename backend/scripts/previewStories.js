// Generates today's two story images from the most recently added products
// and saves them locally for review — does NOT post to Instagram. Run:
//   node scripts/previewStories.js
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const { buildSingleProductStory, buildCollageStory } = require('../utils/storyBuilder');

const OUT_DIR = path.join(__dirname, '../../story_previews');

async function main() {
  const recent = await prisma.products.findMany({
    where: { is_active: true, product_media: { some: {} } },
    include: { product_media: { orderBy: { sort_order: 'asc' }, take: 1 } },
    orderBy: { created_at: 'desc' },
    take: 6,
  });

  if (recent.length < 1) throw new Error('no active products with media found');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const story1Product = recent[0];
  const story1 = await buildSingleProductStory(story1Product);
  fs.writeFileSync(path.join(OUT_DIR, 'story1_single_product.jpg'), story1);
  console.log('story1 ->', story1Product.name_fa);

  const collageProducts = recent.slice(1, 4);
  if (collageProducts.length >= 2) {
    const story2 = await buildCollageStory(collageProducts, {
      headline: 'جدیدترین‌های شیلیستا 🔥',
      subline: 'همین حالا سفارش بده',
    });
    fs.writeFileSync(path.join(OUT_DIR, 'story2_collage.jpg'), story2);
    console.log('story2 ->', collageProducts.map(p => p.name_fa).join(' | '));
  } else {
    console.log('skipped story2: fewer than 2 other recent products available');
  }
}

main().then(() => prisma.$disconnect()).catch(err => { console.error(err); process.exit(1); });
