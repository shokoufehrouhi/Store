// Shared by adminController.publishChanges and the one-off backfill script —
// both must build published_data the exact same way so they can't drift apart.

const PRODUCT_INCLUDE = {
  categories:         { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
  subcategories:      { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
  product_colors:     { select: { color_id: true, is_available: true } },
  product_sizes:      { select: { size_label: true, is_available: true } },
  product_media:      { orderBy: { sort_order: 'asc' }, select: { type: true, url: true, sort_order: true } },
  product_categories: { include: { categories: { select: { key: true } }, subcategories: { select: { key: true } } } },
};

// product_inventory is deliberately excluded — it's live operational stock
// (orders decrement it directly, see ordersController.js), not admin content.
function buildProductSnapshot(p) {
  return {
    name_fa: p.name_fa, name_en: p.name_en, name_tr: p.name_tr,
    desc_fa: p.desc_fa, desc_en: p.desc_en, desc_tr: p.desc_tr,
    emoji: p.emoji, gradient: p.gradient, tag: p.tag, gender: p.gender,
    price: p.price != null ? Number(p.price) : 0,
    discounted_price: p.discounted_price != null ? Number(p.discounted_price) : null,
    stock: p.stock,
    delivery_days: p.delivery_days,
    code: p.code, brand: p.brand,
    supplier_shop_name: p.supplier_shop_name, product_link: p.product_link,
    supplier_code: p.supplier_code, supplier_note: p.supplier_note,
    categories: p.categories || null,
    subcategories: p.subcategories || null,
    product_colors: p.product_colors,
    product_sizes: p.product_sizes,
    product_media: p.product_media,
    product_categories: p.product_categories,
  };
}

function buildCategorySnapshot(c) {
  return { key: c.key, label_fa: c.label_fa, label_en: c.label_en, label_tr: c.label_tr };
}

function buildSubcategorySnapshot(s) {
  return { key: s.key, label_fa: s.label_fa, label_en: s.label_en, label_tr: s.label_tr, category_id: s.category_id };
}

module.exports = { PRODUCT_INCLUDE, buildProductSnapshot, buildCategorySnapshot, buildSubcategorySnapshot };
