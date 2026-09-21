const prisma = require('../prisma/client');
const { checkSiteStock, importSite } = require('../utils/siteSync');

async function listSites(req, res, next) {
  try {
    const rows = await prisma.sites.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function createSite(req, res, next) {
  try {
    const { name, url, is_active, discount_check_mode, markup_percent } = req.body;
    if (!name?.trim())  return res.status(400).json({ success: false, message: 'name_required' });
    if (!url?.trim())   return res.status(400).json({ success: false, message: 'url_required' });
    const row = await prisma.sites.create({
      data: {
        name:                        name.trim(),
        url:                         url.trim(),
        is_active:                   is_active !== undefined ? !!is_active : true,
        discount_check_mode:         discount_check_mode === 'auto' ? 'auto' : 'manual',
        markup_percent:              markup_percent != null && markup_percent !== '' ? Number(markup_percent) : 40,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
}

async function updateSite(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, url, is_active, discount_check_mode, markup_percent } = req.body;
    if (!name?.trim())  return res.status(400).json({ success: false, message: 'name_required' });
    if (!url?.trim())   return res.status(400).json({ success: false, message: 'url_required' });
    const existing = await prisma.sites.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'not_found' });
    const row = await prisma.sites.update({
      where: { id },
      data: {
        name:                        name.trim(),
        url:                         url.trim(),
        is_active:                   is_active !== undefined ? !!is_active : existing.is_active,
        discount_check_mode:         discount_check_mode === 'auto' ? 'auto' : 'manual',
        markup_percent:              markup_percent != null && markup_percent !== '' ? Number(markup_percent) : existing.markup_percent,
        updated_at:                  new Date(),
      },
    });
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
}

async function getSyncSettings(req, res, next) {
  try {
    const settings = await prisma.sync_settings.upsert({
      where: { id: 1 }, create: { id: 1 }, update: {},
    });
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}

async function updateSyncSettings(req, res, next) {
  try {
    const { import_schedule_time, stock_check_schedule_time } = req.body;
    const settings = await prisma.sync_settings.upsert({
      where: { id: 1 },
      create: { id: 1, import_schedule_time: import_schedule_time || null, stock_check_schedule_time: stock_check_schedule_time || null },
      update: { import_schedule_time: import_schedule_time || null, stock_check_schedule_time: stock_check_schedule_time || null, updated_at: new Date() },
    });
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}

// Both sync actions can run past nginx's proxy timeout (scraping + image
// download + translation for several products), so — same fix as the deploy
// button — they run in the background and the endpoint returns immediately.
// Progress/result is read back off the site row itself (import_in_progress /
// last_import_status, etc.) via the normal GET /admin/sites list.
async function syncImport(req, res, next) {
  try {
    const id = Number(req.params.id);
    const site = await prisma.sites.findUnique({ where: { id } });
    if (!site) return res.status(404).json({ success: false, message: 'not_found' });
    if (site.import_in_progress) return res.status(409).json({ success: false, message: 'already_in_progress' });

    await prisma.sites.update({ where: { id }, data: { import_in_progress: true } });
    res.json({ success: true, data: { started: true } });

    importSite(site, { limit: 10 })
      .then(result => prisma.sites.update({
        where: { id },
        data: {
          import_in_progress: false,
          last_import_at: new Date(),
          last_import_status: `imported ${result.imported.filter(r => !r.error).length}, ${result.imported.filter(r => r.error).length} errors`,
        },
      }))
      .catch(err => prisma.sites.update({
        where: { id },
        data: { import_in_progress: false, last_import_at: new Date(), last_import_status: `error: ${err.message}` },
      }));
  } catch (err) { next(err); }
}

async function syncStock(req, res, next) {
  try {
    const id = Number(req.params.id);
    const site = await prisma.sites.findUnique({ where: { id } });
    if (!site) return res.status(404).json({ success: false, message: 'not_found' });
    if (site.stock_check_in_progress) return res.status(409).json({ success: false, message: 'already_in_progress' });

    await prisma.sites.update({ where: { id }, data: { stock_check_in_progress: true } });
    res.json({ success: true, data: { started: true } });

    checkSiteStock(site)
      .then(results => prisma.sites.update({
        where: { id },
        data: {
          stock_check_in_progress: false,
          last_stock_check_at: new Date(),
          last_stock_check_status: `checked ${results.length}, ${results.filter(r => r.status === 'sold_out').length} sold out`,
        },
      }))
      .catch(err => prisma.sites.update({
        where: { id },
        data: { stock_check_in_progress: false, last_stock_check_at: new Date(), last_stock_check_status: `error: ${err.message}` },
      }));
  } catch (err) { next(err); }
}

module.exports = { listSites, createSite, updateSite, syncImport, syncStock, getSyncSettings, updateSyncSettings };
