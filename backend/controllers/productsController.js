const prisma = require('../prisma/client');

async function getAll(req, res, next) {
  try {
    const { category, subcategory, gender, tag } = req.query;
    const where = { is_live: true };
    if (gender) where.gender = gender;
    if (tag)    where.tag    = tag;
    if (category || subcategory) {
      const primaryMatch = {};
      const extraMatch   = {};
      if (category)    { primaryMatch.categories    = { key: category };    extraMatch.categories    = { key: category };    }
      if (subcategory) { primaryMatch.subcategories = { key: subcategory }; extraMatch.subcategories = { key: subcategory }; }
      where.OR = [ primaryMatch, { product_categories: { some: extraMatch } } ];
    }

    const rows = await prisma.products.findMany({
      where,
      include: {
        categories:        { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        subcategories:     { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        product_colors:    { include: { colors: true } },
        product_sizes:     true,
        product_media:     { orderBy: { sort_order: 'asc' } },
        product_inventory: { select: { color_id: true, size_label: true, quantity: true } },
        product_categories: { include: { categories: { select: { key: true } }, subcategories: { select: { key: true } } } },
        _count:            { select: { order_items: true, customer_product_photos: { where: { is_approved: true } } } },
      },
      orderBy: { created_at: 'desc' },
    });
    const products = rows.map(p => ({ ...p, cost_price: undefined, sales: p._count.order_items, has_customer_photos: p._count.customer_product_photos > 0, _count: undefined }));
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const product = await prisma.products.findFirst({
      where: { id: Number(req.params.id), is_live: true },
      include: {
        categories:        true,
        subcategories:     true,
        product_colors:    { include: { colors: true } },
        product_sizes:     true,
        product_media:     { orderBy: { sort_order: 'asc' } },
        product_inventory: { select: { color_id: true, size_label: true, quantity: true } },
      },
    });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: { ...product, cost_price: undefined } });
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
    const { category_id, subcategory_id, gender, name_fa, name_en, name_tr,
            desc_fa, desc_en, desc_tr, gradient, tag, price, discounted_price,
            stock, delivery_days, is_active, emoji } = req.body;
    const data = {};
    if (category_id    != null) data.category_id    = category_id;
    if (subcategory_id != null) data.subcategory_id = subcategory_id;
    if (gender         != null) data.gender         = gender;
    if (name_fa        != null) data.name_fa        = name_fa;
    if (name_en        != null) data.name_en        = name_en;
    if (name_tr        != null) data.name_tr        = name_tr;
    if (desc_fa        != null) data.desc_fa        = desc_fa;
    if (desc_en        != null) data.desc_en        = desc_en;
    if (desc_tr        != null) data.desc_tr        = desc_tr;
    if (gradient       != null) data.gradient       = gradient;
    if (emoji          != null) data.emoji          = emoji;
    if (tag            != null) data.tag            = tag;
    if (price          != null) data.price          = price;
    if (discounted_price != null) data.discounted_price = discounted_price;
    if (stock          != null) data.stock          = stock;
    if (delivery_days  != null) data.delivery_days  = Number(delivery_days);
    if (is_active      != null) data.is_active      = Boolean(is_active);
    const product = await prisma.products.update({ where: { id: Number(req.params.id) }, data });
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
