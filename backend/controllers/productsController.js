const prisma = require('../prisma/client');

// Merges a frozen published_data snapshot with data that must always stay
// live/real-time regardless of publish state: product_inventory (orders
// decrement it directly, see ordersController.js) and the shared colors
// table (never itself publish-gated, so color hex/name edits stay instant).
function mergeLiveColors(snapshot, colorsById) {
  const data = { ...snapshot };
  if (Array.isArray(data.product_colors)) {
    data.product_colors = data.product_colors.map(pc => ({ ...pc, colors: colorsById.get(pc.color_id) || null }));
  }
  return data;
}

async function getAll(req, res, next) {
  try {
    const { category, subcategory, gender, tag } = req.query;

    const [rows, allColors] = await Promise.all([
      prisma.products.findMany({
        where: { is_live: true },
        select: {
          id: true, created_at: true, published_data: true,
          _count: { select: { order_items: true, customer_product_photos: { where: { is_approved: true } } } },
        },
        orderBy: { created_at: 'desc' },
      }),
      prisma.colors.findMany(),
    ]);
    const colorsById = new Map(allColors.map(c => [c.id, c]));
    const ids = rows.map(r => r.id);
    const inventory = ids.length
      ? await prisma.product_inventory.findMany({ where: { product_id: { in: ids } }, select: { product_id: true, color_id: true, size_label: true, quantity: true } })
      : [];
    const inventoryByProduct = new Map();
    for (const inv of inventory) {
      if (!inventoryByProduct.has(inv.product_id)) inventoryByProduct.set(inv.product_id, []);
      inventoryByProduct.get(inv.product_id).push(inv);
    }

    let products = rows.map(r => ({
      id: r.id,
      ...mergeLiveColors(r.published_data || {}, colorsById),
      product_inventory: inventoryByProduct.get(r.id) || [],
      sales: r._count.order_items,
      has_customer_photos: r._count.customer_product_photos > 0,
    }));

    if (gender) products = products.filter(p => p.gender === gender);
    if (tag)    products = products.filter(p => p.tag === tag);
    if (category) {
      products = products.filter(p =>
        p.categories?.key === category ||
        (p.product_categories || []).some(pc => pc.categories?.key === category));
    }
    if (subcategory) {
      products = products.filter(p =>
        p.subcategories?.key === subcategory ||
        (p.product_categories || []).some(pc => pc.subcategories?.key === subcategory));
    }

    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const row = await prisma.products.findFirst({
      where: { id: Number(req.params.id), is_live: true },
      select: { id: true, published_data: true },
    });
    if (!row) return res.status(404).json({ success: false, message: 'Product not found' });

    const [inventory, allColors] = await Promise.all([
      prisma.product_inventory.findMany({ where: { product_id: row.id }, select: { color_id: true, size_label: true, quantity: true } }),
      prisma.colors.findMany(),
    ]);
    const colorsById = new Map(allColors.map(c => [c.id, c]));

    res.json({
      success: true,
      data: {
        id: row.id,
        ...mergeLiveColors(row.published_data || {}, colorsById),
        product_inventory: inventory,
      },
    });
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
