const prisma = require('../prisma/client');

async function getAll(req, res, next) {
  try {
    const { category, subcategory, gender, tag } = req.query;
    const where = { is_active: true };
    if (category)    where.categories    = { key: category };
    if (subcategory) where.subcategories = { key: subcategory };
    if (gender)      where.gender        = gender;
    if (tag)         where.tag           = tag;

    const rows = await prisma.products.findMany({
      where,
      include: {
        categories:     { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        subcategories:  { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        product_colors: { include: { colors: true } },
        product_sizes:  true,
        product_media:  { orderBy: { sort_order: 'asc' } },
        _count:         { select: { order_items: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    const products = rows.map(p => ({ ...p, sales: p._count.order_items, _count: undefined }));
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const product = await prisma.products.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        categories:     true,
        subcategories:  true,
        product_colors: { include: { colors: true } },
        product_sizes:  true,
        product_media:  { orderBy: { sort_order: 'asc' } },
      },
    });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { category_id, subcategory_id, gender, name_fa, name_en, name_tr,
            desc_fa, desc_en, desc_tr, gradient, tag, price, stock, delivery_days } = req.body;
    const product = await prisma.products.create({
      data: { category_id, subcategory_id, gender, name_fa, name_en, name_tr,
              desc_fa, desc_en, desc_tr, gradient, tag, price, stock,
              delivery_days: delivery_days != null ? Number(delivery_days) : 5 },
    });
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const product = await prisma.products.update({
      where: { id: Number(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await prisma.products.update({
      where: { id: Number(req.params.id) },
      data: { is_active: false },
    });
    res.json({ success: true, message: 'Product deactivated' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, remove };
