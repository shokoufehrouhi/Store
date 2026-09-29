const prisma = require('../prisma/client');
const { checkSiteStock, importSite } = require('../utils/siteSync');
const { queueNewProductsForInstagram } = require('../utils/instagramProductQueue');

async function listSites(req, res, next) {
  try {
    const rows = await prisma.sites.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function createSite(req, res, next) {
  try {
    const { name, url, logo_url, is_active, discount_check_mode, markup_percent, daily_ig_post_limit } = req.body;
    if (!name?.trim())  return res.status(400).json({ success: false, message: 'name_required' });
    if (!url?.trim())   return res.status(400).json({ success: false, message: 'url_required' });
    const row = await prisma.sites.create({
      data: {
        name:                        name.trim(),
        url:                         url.trim(),
        logo_url:                    logo_url?.trim() || null,
        is_active:                   is_active !== undefined ? !!is_active : true,
        discount_check_mode:         discount_check_mode === 'auto' ? 'auto' : 'manual',
        markup_percent:              markup_percent != null && markup_percent !== '' ? Number(markup_percent) : 40,
        daily_ig_post_limit:         daily_ig_post_limit != null && daily_ig_post_limit !== '' ? Number(daily_ig_post_limit) : 5,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
}

async function updateSite(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, url, logo_url, is_active, discount_check_mode, markup_percent, daily_ig_post_limit } = req.body;
    if (!name?.trim())  return res.status(400).json({ success: false, message: 'name_required' });
    if (!url?.trim())   return res.status(400).json({ success: false, message: 'url_required' });
    const existing = await prisma.sites.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'not_found' });
    const newMarkup = markup_percent != null && markup_percent !== '' ? Number(markup_percent) : existing.markup_percent;
    const newIgLimit = daily_ig_post_limit != null && daily_ig_post_limit !== '' ? Number(daily_ig_post_limit) : existing.daily_ig_post_limit;
    const row = await prisma.sites.update({
      where: { id },
      data: {
        name:                        name.trim(),
        url:                         url.trim(),
        // logo_url isn't part of the Sync tab's own markup-save request body
        // (see admin.html#saveSyncMarkup) — undefined there means "leave it
        // alone", not "clear it", same fallback pattern as markup_percent.
        logo_url:                    logo_url !== undefined ? (logo_url?.trim() || null) : existing.logo_url,
        is_active:                   is_active !== undefined ? !!is_active : existing.is_active,
        discount_check_mode:         discount_check_mode === 'auto' ? 'auto' : 'manual',
        markup_percent:              newMarkup,
        daily_ig_post_limit:         newIgLimit,
        updated_at:                  new Date(),
      },
    });

    // Re-price every already-imported product from this site so a markup %
    // change takes effect immediately, not just on the next import.
    if (newMarkup !== existing.markup_percent) {
      const products = await prisma.products.findMany({
        where: { supplier_shop_name: row.name, cost_price: { not: null } },
        select: { id: true, cost_price: true },
      });
      await Promise.all(products.map(p => prisma.products.update({
        where: { id: p.id },
        data: {
          discounted_price: Math.round(Number(p.cost_price) * (1 + newMarkup / 100) * 100) / 100,
          is_dirty: true,
          updated_at: new Date(),
        },
      })));
    }

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

// The schedule form and the auto-publish toggle each save independently
// (different cards in admin.html, saved by different buttons), so a request
// from one only carries its own fields -- undefined here means "untouched by
// this request", not "clear it". Falling back to the existing row (rather
// than blanket `|| null`) keeps the other card's last-saved value intact.
async function updateSyncSettings(req, res, next) {
  try {
    const { import_schedule_time, stock_check_schedule_time, auto_publish_enabled, auto_publish_interval_minutes } = req.body;
    const existing = await prisma.sync_settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const settings = await prisma.sync_settings.update({
      where: { id: 1 },
      data: {
        import_schedule_time: import_schedule_time !== undefined ? (import_schedule_time || null) : existing.import_schedule_time,
        stock_check_schedule_time: stock_check_schedule_time !== undefined ? (stock_check_schedule_time || null) : existing.stock_check_schedule_time,
        auto_publish_enabled: auto_publish_enabled !== undefined ? !!auto_publish_enabled : existing.auto_publish_enabled,
        auto_publish_interval_minutes: (auto_publish_interval_minutes !== undefined && auto_publish_interval_minutes !== '')
          ? Math.max(1, Number(auto_publish_interval_minutes) || existing.auto_publish_interval_minutes)
          : existing.auto_publish_interval_minutes,
        updated_at: new Date(),
      },
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

    importSite(site, { limit: 30 })
      .then(async result => {
        // Same queueing as the scheduled import (scheduler.js#runImport) --
        // these are two separate code paths, easy to forget to keep in sync.
        await queueNewProductsForInstagram(site, result.imported);
        return prisma.sites.update({
          where: { id },
          data: {
            import_in_progress: false,
            last_import_at: new Date(),
            last_import_status: `imported ${result.imported.filter(r => !r.error).length}, ${result.imported.filter(r => r.error).length} errors, ${result.skipped || 0} skipped`,
          },
        });
      })
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
