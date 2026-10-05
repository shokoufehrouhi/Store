// One-off: ArmaLife was first imported one product per color (2026-10-05);
// this folds every color of a model into one product. See
// mergeArmaLifeColors in utils/siteImport.js for what exactly it changes.
// Dry run first (prints the plan, writes nothing):
//   node scripts/mergeArmaLifeColors.js
// Then for real:
//   node scripts/mergeArmaLifeColors.js --apply
const prisma = require('../prisma/client');
const { mergeArmaLifeColors } = require('../utils/siteImport');

(async () => {
  const apply = process.argv.includes('--apply');
  const site = await prisma.sites.findFirst({ where: { name: 'ArmaLife' } });
  if (!site) throw new Error('no sites row named ArmaLife');
  const log = await mergeArmaLifeColors(site, { apply });
  for (const line of log) console.log(line);
  console.log(apply ? `done, ${log.length} line(s)` : `dry run only (${log.length} line(s)) — re-run with --apply to write`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
