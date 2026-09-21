const prisma = require('../prisma/client');

async function listSites(req, res, next) {
  try {
    const rows = await prisma.sites.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function createSite(req, res, next) {
  try {
    const { name, url, is_active, discount_check_mode } = req.body;
    if (!name?.trim())  return res.status(400).json({ success: false, message: 'name_required' });
    if (!url?.trim())   return res.status(400).json({ success: false, message: 'url_required' });
    const row = await prisma.sites.create({
      data: {
        name:                 name.trim(),
        url:                  url.trim(),
        is_active:            is_active !== undefined ? !!is_active : true,
        discount_check_mode:  discount_check_mode === 'auto' ? 'auto' : 'manual',
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
}

async function updateSite(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, url, is_active, discount_check_mode } = req.body;
    if (!name?.trim())  return res.status(400).json({ success: false, message: 'name_required' });
    if (!url?.trim())   return res.status(400).json({ success: false, message: 'url_required' });
    const existing = await prisma.sites.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'not_found' });
    const row = await prisma.sites.update({
      where: { id },
      data: {
        name:                 name.trim(),
        url:                  url.trim(),
        is_active:            is_active !== undefined ? !!is_active : existing.is_active,
        discount_check_mode:  discount_check_mode === 'auto' ? 'auto' : 'manual',
        updated_at:           new Date(),
      },
    });
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
}

async function deleteSite(req, res, next) {
  try {
    const id = Number(req.params.id);
    await prisma.sites.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { listSites, createSite, updateSite, deleteSite };
