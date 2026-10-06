// One-off (2026-10-06): cleans up the colors table.
// 1. Duplicates — the same color created more than once under another
//    spelling ("Siyah" and "Si̇yah", "Krem" / "Krema" / "Krem Rengi"):
//    colors whose Turkish or English names match once normalized
//    (utils/colorHex.js#normalizeColorName) are merged into one. The kept
//    color is the one with a real hex, then the most used one. Products,
//    stock rows, order items, cart items (by key) and published product
//    snapshots are moved over to it; the duplicate is deleted once nothing
//    points at it. Groups holding two DIFFERENT real hexes are left alone.
// 2. Grey swatches — colors still on the #CCCCCC placeholder get a hex from
//    their name (utils/colorHex.js#guessColorHex) where it can tell.
// The importers no longer create either (see siteImport.js#findColorByName).
// Dry run first (prints what would change):
//   node scripts/fixColors.js
// Then for real:
//   node scripts/fixColors.js --apply
const prisma = require('../prisma/client');
const { PLACEHOLDER_HEX, normalizeColorName, guessColorHex } = require('../utils/colorHex');

const isPlaceholder = (hex) => String(hex || '').toUpperCase() === PLACEHOLDER_HEX;

(async () => {
  const apply = process.argv.includes('--apply');
  const colors = await prisma.colors.findMany({ orderBy: { id: 'asc' } });
  const usage = new Map((await prisma.product_colors.groupBy({ by: ['color_id'], _count: true })).map((u) => [u.color_id, u._count]));

  // Union colors sharing a normalized Turkish or English name.
  const parent = new Map(colors.map((c) => [c.id, c.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const byName = new Map();
  for (const c of colors) {
    for (const n of [c.name_tr, c.name_en]) {
      const k = normalizeColorName(n);
      if (!k) continue;
      if (byName.has(k)) parent.set(find(c.id), find(byName.get(k)));
      else byName.set(k, c.id);
    }
  }
  const groups = new Map();
  for (const c of colors) {
    const r = find(c.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(c);
  }

  const merges = []; // { keep, drop: [...] }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const realHexes = new Set(g.filter((c) => !isPlaceholder(c.hex)).map((c) => c.hex.toUpperCase()));
    if (realHexes.size > 1) { console.log(`skip (different colors): ${g.map((c) => `${c.id}:${c.name_tr}:${c.hex}`).join(', ')}`); continue; }
    const sorted = [...g].sort((a, b) => (isPlaceholder(a.hex) - isPlaceholder(b.hex)) || ((usage.get(b.id) || 0) - (usage.get(a.id) || 0)) || (a.id - b.id));
    merges.push({ keep: sorted[0], drop: sorted.slice(1) });
  }

  console.log(`== ${merges.length} duplicate group(s):`);
  for (const m of merges) {
    console.log(`  keep ${m.keep.id} "${m.keep.name_tr}/${m.keep.name_en}" ${m.keep.hex} (${usage.get(m.keep.id) || 0} products) <- ${m.drop.map((d) => `${d.id} "${d.name_tr}/${d.name_en}" (${usage.get(d.id) || 0})`).join(', ')}`);
  }

  let deleted = 0;
  let kept = 0;
  if (apply) {
    for (const { keep, drop } of merges) {
      for (const d of drop) {
        // product_colors: move, or fold into the product's existing row.
        for (const row of await prisma.product_colors.findMany({ where: { color_id: d.id } })) {
          const existing = await prisma.product_colors.findUnique({ where: { product_id_color_id: { product_id: row.product_id, color_id: keep.id } } });
          if (existing) {
            if (row.is_available && !existing.is_available) await prisma.product_colors.update({ where: { product_id_color_id: { product_id: row.product_id, color_id: keep.id } }, data: { is_available: true } });
            await prisma.product_colors.delete({ where: { product_id_color_id: { product_id: row.product_id, color_id: d.id } } });
          } else {
            await prisma.product_colors.update({ where: { product_id_color_id: { product_id: row.product_id, color_id: d.id } }, data: { color_id: keep.id } });
          }
        }
        // product_inventory: same; the larger quantity wins.
        for (const row of await prisma.product_inventory.findMany({ where: { color_id: d.id } })) {
          const existing = await prisma.product_inventory.findFirst({ where: { product_id: row.product_id, color_id: keep.id, size_label: row.size_label } });
          if (existing) {
            if (row.quantity > existing.quantity) await prisma.product_inventory.update({ where: { id: existing.id }, data: { quantity: row.quantity } });
            await prisma.product_inventory.delete({ where: { id: row.id } });
          } else {
            await prisma.product_inventory.update({ where: { id: row.id }, data: { color_id: keep.id } });
          }
        }
        // order_items: moved unless that order already has the kept color for the same product and size.
        for (const row of await prisma.order_items.findMany({ where: { color_id: d.id } })) {
          const clash = await prisma.order_items.findFirst({ where: { order_id: row.order_id, product_id: row.product_id, color_id: keep.id, size_label: row.size_label } });
          if (!clash) await prisma.order_items.update({ where: { id: row.id }, data: { color_id: keep.id } });
        }
        // cart_items reference the color by key.
        for (const row of await prisma.cart_items.findMany({ where: { color_key: d.key } })) {
          const clash = await prisma.cart_items.findFirst({ where: { customer_id: row.customer_id, product_id: row.product_id, color_key: keep.key, size_label: row.size_label } });
          if (clash) await prisma.cart_items.delete({ where: { id: row.id } });
          else await prisma.cart_items.update({ where: { id: row.id }, data: { color_key: keep.key } });
        }
        // Published snapshots list color ids; the live site reads those.
        const snaps = await prisma.$queryRawUnsafe(
          `SELECT id, published_data FROM products WHERE published_data->'product_colors' @> $1::jsonb`,
          JSON.stringify([{ color_id: d.id }]),
        );
        for (const p of snaps) {
          const data = p.published_data;
          if (!Array.isArray(data?.product_colors)) continue;
          const seen = new Set();
          data.product_colors = data.product_colors
            .map((pc) => (pc.color_id === d.id ? { ...pc, color_id: keep.id } : pc))
            .filter((pc) => (seen.has(pc.color_id) ? false : seen.add(pc.color_id)));
          await prisma.products.update({ where: { id: p.id }, data: { published_data: data } });
        }
        const left = await prisma.order_items.count({ where: { color_id: d.id } });
        if (left) { kept++; console.log(`  kept ${d.id} "${d.name_tr}": ${left} order item(s) still use it`); continue; }
        await prisma.colors.delete({ where: { id: d.id } });
        deleted++;
      }
      // A real hex from a merged duplicate is worth keeping.
      if (isPlaceholder(keep.hex)) {
        const real = drop.find((d) => !isPlaceholder(d.hex));
        if (real) await prisma.colors.update({ where: { id: keep.id }, data: { hex: real.hex } });
      }
    }
  }

  // Grey swatches -> a hex from the name.
  const greys = (await prisma.colors.findMany({ orderBy: { id: 'asc' } })).filter((c) => isPlaceholder(c.hex));
  const fills = greys.map((c) => ({ c, hex: guessColorHex(c.name_tr, c.name_en) })).filter((f) => f.hex);
  console.log(`== ${fills.length} of ${greys.length} grey color(s) get a hex:`);
  for (const f of fills) console.log(`  ${f.c.id} "${f.c.name_tr} / ${f.c.name_en}" -> ${f.hex}`);
  if (apply) for (const f of fills) await prisma.colors.update({ where: { id: f.c.id }, data: { hex: f.hex } });

  console.log(apply
    ? `merged ${merges.length} group(s): deleted ${deleted} duplicate(s)${kept ? `, kept ${kept} still used by orders` : ''}; filled ${fills.length} grey color(s)`
    : 'dry run — re-run with --apply to do it');
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
