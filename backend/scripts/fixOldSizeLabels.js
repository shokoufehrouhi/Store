// Fixes size labels that older imports stored wrong (2026-10-09):
//
// - Zara, LC Waikiki: size_label is VarChar(10), and labels with a part in
//   brackets were cut off — "2 yaş (92 cm)" became "2 yaş (92 ", "EU 46
//   (US 36)" became "EU 46 (US ", "19-22 (12-18 Ay)" became "19-22 (12-".
//   The import now drops the "(…)" part first; this does the same to the
//   stored labels ("EU 46 (US " -> "46", as Zara's import keeps the EU size).
// - Koton: jeans imported before 445191a (2026-09-30) stored the length
//   ("Boy") as one more size next to the waists. Each old Koton product's
//   page is read again with the current reader; where it has a length
//   group, its sizes become the import's "waist/length" labels (in-stock
//   combinations only).
//
// Only product_sizes and product_inventory change (no cart or order held
// these labels when written); the product is marked dirty so the next
// publish updates the live snapshot.
//
// Usage (on the server, from backend/):
//   node -r dotenv/config scripts/fixOldSizeLabels.js [--koton] [--apply]
const prisma = require('../prisma/client');

const apply = process.argv.includes('--apply');
const withKoton = process.argv.includes('--koton');
const KOTON_FIX_DATE = new Date('2026-10-01T00:00:00Z'); // 445191a went live 2026-09-30

function cleanLabel(label) {
  return String(label)
    .replace(/^EU\s+(\S+)\s*\(.*$/, '$1')
    .split(' (')[0]
    .trim()
    .slice(0, 10);
}

// Renames a product's labels (old -> new). A new label the product already
// has is merged into that row instead (available if either was, larger
// quantity) — product_sizes and product_inventory are unique per label.
async function renameLabels(productId, renames) {
  const sizes = await prisma.product_sizes.findMany({ where: { product_id: productId } });
  const inventory = await prisma.product_inventory.findMany({ where: { product_id: productId } });
  const ops = [];
  for (const [from, to] of renames) {
    for (const row of sizes.filter(s => s.size_label === from)) {
      const target = sizes.find(s => s.size_label === to);
      if (target) {
        ops.push(prisma.product_sizes.update({ where: { id: target.id }, data: { is_available: target.is_available || row.is_available } }));
        ops.push(prisma.product_sizes.delete({ where: { id: row.id } }));
      } else {
        ops.push(prisma.product_sizes.update({ where: { id: row.id }, data: { size_label: to } }));
        row.size_label = to;
      }
    }
    for (const row of inventory.filter(i => i.size_label === from)) {
      const target = inventory.find(i => i.size_label === to && i.color_id === row.color_id);
      if (target) {
        ops.push(prisma.product_inventory.update({ where: { id: target.id }, data: { quantity: Math.max(target.quantity, row.quantity) } }));
        ops.push(prisma.product_inventory.delete({ where: { id: row.id } }));
      } else {
        ops.push(prisma.product_inventory.update({ where: { id: row.id }, data: { size_label: to } }));
        row.size_label = to;
      }
    }
  }
  ops.push(prisma.products.update({ where: { id: productId }, data: { is_dirty: true, updated_at: new Date() } }));
  await prisma.$transaction(ops);
}

async function fixCutLabels() {
  const rows = await prisma.product_sizes.findMany({
    where: { products: { brand: { in: ['Zara', 'LCWaikiki'] } } },
    select: { product_id: true, size_label: true },
  });
  const byProduct = new Map();
  for (const r of rows) {
    const to = cleanLabel(r.size_label);
    if (to === r.size_label || !to) continue;
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id).push([r.size_label, to]);
  }
  const examples = new Map();
  for (const renames of byProduct.values()) for (const [f, t] of renames) if (!examples.has(f)) examples.set(f, t);
  console.log(`cut labels: ${byProduct.size} product(s), ${[...byProduct.values()].flat().length} label(s)`);
  console.log('  e.g. ' + [...examples].slice(0, 12).map(([f, t]) => `"${f}" -> "${t}"`).join(', '));
  if (!apply) return;
  for (const [productId, renames] of byProduct) await renameLabels(productId, renames);
  console.log('  applied');
}

async function fixKotonJeans() {
  const { withBrowser } = require('../utils/siteSync');
  const { scrapeKotonProduct } = require('../utils/siteImport');
  const products = await prisma.products.findMany({
    where: {
      brand: 'Koton', created_at: { lt: KOTON_FIX_DATE }, product_link: { not: null },
      product_sizes: { some: {}, none: { size_label: { contains: '/' } } },
    },
    select: { id: true, product_link: true, product_sizes: { select: { size_label: true } }, product_inventory: { select: { color_id: true } } },
    orderBy: { id: 'asc' },
  });
  console.log(`Koton: ${products.length} old product(s) to check`);
  const totals = { jeans: 0, fixed: 0, notJeans: 0, noneInStock: 0, failed: 0 };
  await withBrowser(async (pm) => {
    for (const p of products) {
      try {
        const data = await scrapeKotonProduct(pm, p.product_link);
        if (!data.sizes.some(s => s.size.includes('/'))) {
          // Either not a jean, or a jean with no waist x length in stock.
          if (data.hasSizeOptions && !data.sizes.length) totals.noneInStock++; else totals.notJeans++;
          continue;
        }
        totals.jeans++;
        const old = p.product_sizes.map(s => s.size_label).join(',');
        const sizes = data.sizes.map(s => s.size.slice(0, 10));
        console.log(`  ${p.id}: ${old} -> ${sizes.join(',')}`);
        if (!apply) continue;
        const colorId = p.product_inventory[0]?.color_id ?? null;
        await prisma.$transaction([
          prisma.product_sizes.deleteMany({ where: { product_id: p.id } }),
          prisma.product_inventory.deleteMany({ where: { product_id: p.id } }),
          prisma.product_sizes.createMany({ data: sizes.map(size_label => ({ product_id: p.id, size_label, is_available: true })) }),
          prisma.product_inventory.createMany({ data: sizes.map(size_label => ({ product_id: p.id, color_id: colorId, size_label, quantity: 10 })) }),
          prisma.products.update({ where: { id: p.id }, data: { stock: sizes.length * 10, is_dirty: true, updated_at: new Date() } }),
        ]);
        totals.fixed++;
      } catch (err) {
        totals.failed++;
        console.log(`  ${p.id}: failed — ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1500)); // Koton blocks bursts (HTTP 405)
    }
  });
  console.log(JSON.stringify(totals));
}

(async () => {
  if (!apply) console.log('DRY RUN — nothing changes (add --apply)');
  await fixCutLabels();
  if (withKoton) await fixKotonJeans();
  await prisma.$disconnect();
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
