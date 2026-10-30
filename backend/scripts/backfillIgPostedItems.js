// One-off: ig_posted_items (utils/instagramProductQueue.js#igItemKey) only
// started filling when the "never re-post an item" fix went live, so every
// product posted before that is still unprotected -- delete it, re-import it
// and it would be posted again. This records every already-'posted' row, using
// the same key function the scheduler uses (the site's own product id for
// Defacto/LCW/Koton/Zara links, which plain SQL can't reproduce).
// The most recent post wins when several rows share a key. Existing keys are
// left alone.
// Dry run by default: node scripts/backfillIgPostedItems.js
// Write:               node scripts/backfillIgPostedItems.js --apply
const prisma = require('../prisma/client');
const { igItemKey } = require('../utils/instagramProductQueue');

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.instagram_product_posts.findMany({
    where: { status: 'posted' },
    orderBy: { posted_at: 'asc' },
    select: { ig_media_id: true, posted_at: true, products: { select: { product_link: true, supplier_shop_name: true, supplier_code: true } } },
  });

  const byKey = new Map(); // ascending by posted_at, so later rows overwrite earlier ones
  let noKey = 0;
  for (const r of rows) {
    const key = igItemKey(r.products);
    if (!key) { noKey++; continue; }
    byKey.set(key, { item_key: key, ig_media_id: r.ig_media_id, posted_at: r.posted_at || new Date() });
  }

  const existing = new Set((await prisma.ig_posted_items.findMany({ select: { item_key: true } })).map(r => r.item_key));
  const toAdd = [...byKey.values()].filter(r => !existing.has(r.item_key));
  console.log(`posted rows: ${rows.length}, distinct items: ${byKey.size}, without link/supplier code: ${noKey}, already recorded: ${byKey.size - toAdd.length}, to add: ${toAdd.length}`);

  if (apply && toAdd.length) {
    const { count } = await prisma.ig_posted_items.createMany({ data: toAdd, skipDuplicates: true });
    console.log(`added ${count}`);
  } else if (!apply) {
    console.log('dry run -- nothing written (pass --apply to write)');
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
