// In-process scheduler for the two site-sync jobs. Their time is a single
// global setting (sync_settings, one row) — at that time, every active site
// is checked/imported, not a per-site schedule. Per-site control is only the
// manual "Sync Now" button (see sitesController.js#syncImport/syncStock).
// Runs entirely inside the API process — no system crontab entry needed, so
// changing the schedule in the admin panel takes effect immediately.
const prisma = require('./prisma/client');
const { checkSiteStock, importSite } = require('./utils/siteSync');

let ranThisMinute = null; // 'HH:MM' of the last minute we already acted on

function currentHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function runImport(site) {
  try {
    await prisma.sites.update({ where: { id: site.id }, data: { import_in_progress: true } });
    const result = await importSite(site, { limit: 30 });
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
  if (ranThisMinute === nowHHMM) return; // already handled this minute
  const settings = await prisma.sync_settings.findUnique({ where: { id: 1 } });
  if (!settings) return;
  if (settings.import_schedule_time !== nowHHMM && settings.stock_check_schedule_time !== nowHHMM) return;

  ranThisMinute = nowHHMM;
  const sites = await prisma.sites.findMany({ where: { is_active: true } });
  // Sequential, not fire-and-forget: each site gets its own full Puppeteer/
  // Chrome instance (see backend/utils/siteSync.js#withBrowser), and this
  // used to kick off every active site's import at once — confirmed live
  // that at import-heavy site counts (Lefties alone can run 1-2+ hours with
  // no candidate cap, see siteImport.js's own history) that means several
  // simultaneous Chrome processes competing for this VPS's CPU/RAM, not
  // just a slow individual run. One site at a time costs total wall-clock
  // time instead, which is the right tradeoff for an unattended overnight
  // job — nothing is waiting on it to finish quickly.
  if (settings.import_schedule_time === nowHHMM) {
    for (const site of sites) await runImport(site);
  }
  if (settings.stock_check_schedule_time === nowHHMM) {
    for (const site of sites) await runStockCheck(site);
  }
}

function start() {
  // A sync mid-flight when the process restarts (deploy, crash, manual
  // restart) never gets to write its final status — the in_progress flag
  // would otherwise stay stuck true forever, permanently disabling that
  // site's Sync Now buttons. Nothing can genuinely be in progress right
  // after boot, so clear both flags for every site once at startup.
  prisma.sites.updateMany({
    where: { OR: [{ import_in_progress: true }, { stock_check_in_progress: true }] },
    data: { import_in_progress: false, stock_check_in_progress: false },
  }).catch(err => console.error('[scheduler] failed to clear stale in-progress flags:', err));

  setInterval(() => { tick().catch(err => console.error('[scheduler] tick error:', err)); }, 60 * 1000);
  console.log('[scheduler] site sync scheduler started');
}

module.exports = { start };
