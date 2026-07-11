const prisma = require('../prisma/client');

async function listSuppliers(req, res, next) {
  try {
    const rows = await prisma.suppliers.findMany({ orderBy: { shop_name: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function createSupplier(req, res, next) {
  try {
    const { shop_name, supplier_name, phone, telegram, website, instagram, store_address } = req.body;
    if (!shop_name?.trim()) return res.status(400).json({ success: false, message: 'shop_name_required' });
    const row = await prisma.suppliers.create({
      data: {
        shop_name:     shop_name.trim(),
        supplier_name: supplier_name?.trim() || null,
        phone:         phone?.trim()         || null,
        telegram:      telegram?.trim()      || null,
        website:       website?.trim()       || null,
        instagram:     instagram?.trim()     || null,
        store_address: store_address?.trim() || null,
        card_photo_url: req.file ? '/uploads/' + req.file.filename : null,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
}

async function updateSupplier(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { shop_name, supplier_name, phone, telegram, website, instagram, store_address } = req.body;
    if (!shop_name?.trim()) return res.status(400).json({ success: false, message: 'shop_name_required' });
    const existing = await prisma.suppliers.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'not_found' });
    const data = {
      shop_name:     shop_name.trim(),
      supplier_name: supplier_name?.trim() || null,
      phone:         phone?.trim()         || null,
      telegram:      telegram?.trim()      || null,
      website:       website?.trim()       || null,
      instagram:     instagram?.trim()     || null,
      store_address: store_address?.trim() || null,
      updated_at:    new Date(),
    };
    if (req.file) data.card_photo_url = '/uploads/' + req.file.filename;
    const row = await prisma.suppliers.update({ where: { id }, data });
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
}

async function deleteSupplier(req, res, next) {
  try {
    const id = Number(req.params.id);
    await prisma.suppliers.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { listSuppliers, createSupplier, updateSupplier, deleteSupplier };
