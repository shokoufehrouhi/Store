// One-off: removes product photos that don't load on the live site (404),
// so a product shows its real first photo instead of a broken one.
// Happened 2026-10-05 to the first Lefties imports after the API rewrite:
// their first "photo" was a tiny color swatch that never became a real
// file. Checked against the uploads folder on this server's disk (the same
// folder the site serves /uploads from) — an HTTP check against
// https://shilista.com didn't work from the VPS itself (every request
// failed, and the first version silently counted that as "not broken").
// A product left with no photos at all is
// only reported — for Lefties the next stock check downloads its photos
// again. Changed products are marked dirty: publish them from the admin.
// Dry run first (prints what would change), for one site:
//   node scripts/removeBrokenProductImages.js Lefties
// Then for real:
//   node scripts/removeBrokenProductImages.js Lefties --apply
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');

(async () => {
  const apply = process.argv.includes('--apply');
  const site = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!site) throw new Error('usage: node scripts/removeBrokenProductImages.js <site name> [--apply]');

  const products = await prisma.products.findMany({
    where: { supplier_shop_name: site, product_media: { some: {} } },
    select: { id: true, code: true, name_tr: true, product_media: { select: { id: true, url: true } } },
  });
  if (!fs.existsSync(UPLOAD_DIR) || !fs.readdirSync(UPLOAD_DIR).length) {
    throw new Error(`uploads folder ${UPLOAD_DIR} is missing or empty — run this from the backend folder that serves the site's photos`);
  }
  let removed = 0;
  for (const p of products) {
    const broken = [];
    for (const m of p.product_media) {
      if (!m.url.startsWith('/uploads/')) continue;
      if (!fs.existsSync(path.join(UPLOAD_DIR, path.basename(m.url)))) broken.push(m);
    }
    if (!broken.length) continue;
    const left = p.product_media.length - broken.length;
    console.log(`${p.code} "${p.name_tr}": ${broken.length} broken of ${p.product_media.length}${left ? '' : ' — NO photos left'}`);
    removed += broken.length;
    if (apply) {
      await prisma.product_media.deleteMany({ where: { id: { in: broken.map(m => m.id) } } });
      await prisma.products.update({ where: { id: p.id }, data: { is_dirty: true, updated_at: new Date() } });
    }
  }
  console.log(apply ? `removed ${removed} broken photo(s)` : `${removed} broken photo(s) would be removed — re-run with --apply to do it`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
