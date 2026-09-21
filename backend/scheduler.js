// In-process scheduler for per-site product import / stock-check jobs whose
// times are set on the `sites` row (admin panel: Sites tab, per-site schedule
// fields). Runs entirely inside the API process — no system crontab entry
// needed, so changing a site's schedule in the admin panel takes effect
// immediately without touching the VPS.
const prisma = require('./prisma/client');
const { checkSiteStock, importSite } = require('./utils/siteSync');

const ranThisMinute = new Set();

function currentHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function runImport(site) {
  try {
    await prisma.sites.update({ where: { id: site.id }, data: { import_in_progress: true } });
    const result = await importSite(site, { limit: 10 });
    const ok = result.imported.filter(r => !r.error).length;
    const failed = result.imported.filter(r => r.error).length;
    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `imported ${ok}, ${failed} errors` },
    });
  } catch (err) {
    await prisma.sites.update({
      where: { id: site.id },
      data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `error: ${err.message}` },
    }).catch(() => {});
  }
}

async function runStockCheck(site) {
  try {
    await prisma.sites.update({ where: { id: site.id }, data: { stock_check_in_progress: true } });
    const results = await checkSiteStock(site);
    const soldOut = results.filter(r => r.status === 'sold_out').length;
    await prisma.sites.update({
      where: { id: site.id },
      data: { stock_check_in_progress: false, last_stock_check_at: new Date(), last_stock_check_status: `checked ${results.length}, ${soldOut} sold out` },
    });
  } catch (err) {
    await prisma.sites.update({
      where: { id: site.id },
      data: { stock_check_in_progress: false, last_stock_check_at: new Date(), last_stock_check_status: `error: ${err.message}` },
    }).catch(() => {});
  }
}

async function tick() {
  const nowHHMM = currentHHMM();
  const sites = await prisma.sites.findMany({ where: { is_active: true } });
  for (const site of sites) {
    if (site.import_schedule_time === nowHHMM) {
      const key = `${site.id}:import:${nowHHMM}`;
      if (!ranThisMinute.has(key)) { ranThisMinute.add(key); runImport(site); }
    }
    if (site.stock_check_schedule_time === nowHHMM) {
      const key = `${site.id}:stock:${nowHHMM}`;
      if (!ranThisMinute.has(key)) { ranThisMinute.add(key); runStockCheck(site); }
    }
  }
  if (ranThisMinute.size > 500) ranThisMinute.clear();
}

function start() {
  setInterval(() => { tick().catch(err => console.error('[scheduler] tick error:', err)); }, 60 * 1000);
  console.log('[scheduler] site sync scheduler started');
}

module.exports = { start };
