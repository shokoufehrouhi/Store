const prisma = require('../prisma/client');

const ADMIN_USER  = 'Admin';
const ADMIN_PASS  = 'Admin@12893';
const ADMIN_TOKEN = 'akhgar-admin-9f3k2m8x7n1p4q6r';

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function login(req, res) {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: ADMIN_TOKEN });
  }
  return res.status(401).json({ success: false, message: 'نام کاربری یا رمز اشتباه است' });
}

// ─── Categories ────────────────────────────────────────────────────────────────

async function getCategories(req, res, next) {
  try {
    const cats = await prisma.categories.findMany({
      include: { subcategories: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
}

async function createCategory(req, res, next) {
  try {
    const { key, label_fa, label_en, label_tr } = req.body;
    const cat = await prisma.categories.create({
      data: { key, label_fa, label_en: label_en || label_fa, label_tr: label_tr || label_fa },
    });
    res.status(201).json({ success: true, data: cat });
  } catch (err) { next(err); }
}

async function updateCategory(req, res, next) {
  try {
    const { key, label_fa, label_en, label_tr } = req.body;
    const cat = await prisma.categories.update({
      where: { id: Number(req.params.id) },
      data: { key, label_fa, label_en: label_en || label_fa, label_tr: label_tr || label_fa },
    });
    res.json({ success: true, data: cat });
  } catch (err) { next(err); }
}

async function deleteCategory(req, res, next) {
  try {
    await prisma.categories.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Subcategories ─────────────────────────────────────────────────────────────

async function getSubcategories(req, res, next) {
  try {
    const subs = await prisma.subcategories.findMany({
      include: { categories: { select: { id: true, key: true, label_fa: true } } },
      orderBy: { id: 'asc' },
    });
    res.json({ success: true, data: subs });
  } catch (err) { next(err); }
}

async function createSubcategory(req, res, next) {
  try {
    const { category_id, key, label_fa, label_en, label_tr } = req.body;
    const sub = await prisma.subcategories.create({
      data: {
        category_id: Number(category_id),
        key,
        label_fa,
        label_en: label_en || label_fa,
        label_tr: label_tr || label_fa,
      },
    });
    res.status(201).json({ success: true, data: sub });
  } catch (err) { next(err); }
}

async function updateSubcategory(req, res, next) {
  try {
    const { category_id, key, label_fa, label_en, label_tr } = req.body;
    const sub = await prisma.subcategories.update({
      where: { id: Number(req.params.id) },
      data: {
        category_id: Number(category_id),
        key,
        label_fa,
        label_en: label_en || label_fa,
        label_tr: label_tr || label_fa,
      },
    });
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
}

async function deleteSubcategory(req, res, next) {
  try {
    await prisma.subcategories.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Colors ────────────────────────────────────────────────────────────────────

async function getColors(req, res, next) {
  try {
    const colors = await prisma.colors.findMany({ orderBy: { name_fa: 'asc' } });
    res.json({ success: true, data: colors });
  } catch (err) { next(err); }
}

async function createColor(req, res, next) {
  try {
    const { key, hex, name_fa, name_en, name_tr } = req.body;
    const color = await prisma.colors.create({
      data: { key, hex, name_fa, name_en: name_en || name_fa, name_tr: name_tr || name_fa },
    });
    res.status(201).json({ success: true, data: color });
  } catch (err) { next(err); }
}

async function updateColor(req, res, next) {
  try {
    const { key, hex, name_fa, name_en, name_tr } = req.body;
    const color = await prisma.colors.update({
      where: { id: Number(req.params.id) },
      data: { key, hex, name_fa, name_en: name_en || name_fa, name_tr: name_tr || name_fa },
    });
    res.json({ success: true, data: color });
  } catch (err) { next(err); }
}

async function deleteColor(req, res, next) {
  try {
    await prisma.colors.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Sizes ─────────────────────────────────────────────────────────────────────

async function getSizes(req, res, next) {
  try {
    const sizes = await prisma.sizes.findMany({ orderBy: { sort_order: 'asc' } });
    res.json({ success: true, data: sizes });
  } catch (err) { next(err); }
}

async function createSize(req, res, next) {
  try {
    const { label, sort_order } = req.body;
    const size = await prisma.sizes.create({ data: { label: label.trim(), sort_order: Number(sort_order) || 0 } });
    res.status(201).json({ success: true, data: size });
  } catch (err) { next(err); }
}

async function updateSize(req, res, next) {
  try {
    const { label, sort_order } = req.body;
    const size = await prisma.sizes.update({
      where: { id: Number(req.params.id) },
      data: { label: label.trim(), sort_order: Number(sort_order) || 0 },
    });
    res.json({ success: true, data: size });
  } catch (err) { next(err); }
}

async function deleteSize(req, res, next) {
  try {
    await prisma.sizes.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Media upload ──────────────────────────────────────────────────────────────

async function uploadMedia(req, res) {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ success: true, url });
}

// ─── Media delete ──────────────────────────────────────────────────────────────

async function deleteMedia(req, res, next) {
  try {
    const id = Number(req.params.id);
    const media = await prisma.product_media.findUnique({ where: { id } });
    if (!media) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.product_media.delete({ where: { id } });

    if (media.url.startsWith('/uploads/')) {
      const path = require('path');
      const fs   = require('fs');
      const file = path.join(__dirname, '../public', media.url);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Products ──────────────────────────────────────────────────────────────────

async function getProducts(req, res, next) {
  try {
    const products = await prisma.products.findMany({
      include: {
        categories:     { select: { key: true, label_fa: true } },
        subcategories:  { select: { key: true, label_fa: true } },
        product_colors: { include: { colors: true } },
        product_sizes:  true,
        product_media:  { orderBy: { sort_order: 'asc' } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: products });
  } catch (err) { next(err); }
}

async function createProduct(req, res, next) {
  try {
    const {
      category_id, subcategory_id, gender, name_fa, name_en, name_tr,
      desc_fa, desc_en, desc_tr, gradient, tag, price, stock, delivery_days,
      color_ids, sizes, media,
    } = req.body;

    const product = await prisma.products.create({
      data: {
        category_id:    Number(category_id),
        subcategory_id: subcategory_id ? Number(subcategory_id) : null,
        gender:         gender || 'unisex',
        name_fa,
        name_en: name_en || name_fa,
        name_tr: name_tr || name_fa,
        desc_fa:       desc_fa   || null,
        desc_en:       desc_en   || null,
        desc_tr:       desc_tr   || null,
        gradient:      gradient  || null,
        tag:           tag       || null,
        price:         price     || 0,
        stock:         stock     || 0,
        delivery_days: delivery_days != null ? Number(delivery_days) : 5,
        product_colors: color_ids?.length ? {
          create: color_ids.map(id => ({ color_id: Number(id), is_available: true })),
        } : undefined,
        product_sizes: sizes?.length ? {
          create: sizes.map(s => ({ size_label: s, is_available: true })),
        } : undefined,
        product_media: media?.length ? {
          create: media.map((m, i) => ({ type: m.type, url: m.url, sort_order: i })),
        } : undefined,
      },
      include: {
        categories:     { select: { key: true, label_fa: true } },
        product_colors: { include: { colors: true } },
        product_sizes:  true,
        product_media:  { orderBy: { sort_order: 'asc' } },
      },
    });
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
}

async function updateProduct(req, res, next) {
  try {
    const id = Number(req.params.id);
    const {
      category_id, subcategory_id, gender, name_fa, name_en, name_tr,
      desc_fa, desc_en, desc_tr, gradient, tag, price, stock, is_active, delivery_days,
      color_ids, sizes, media,
    } = req.body;

    await prisma.product_colors.deleteMany({ where: { product_id: id } });
    await prisma.product_sizes.deleteMany({ where:  { product_id: id } });

    const existingMedia = await prisma.product_media.findMany({ where: { product_id: id }, orderBy: { sort_order: 'asc' } });
    const existingCount = existingMedia.length;

    const product = await prisma.products.update({
      where: { id },
      data: {
        category_id:    Number(category_id),
        subcategory_id: subcategory_id ? Number(subcategory_id) : null,
        gender:         gender || 'unisex',
        name_fa,
        name_en: name_en || name_fa,
        name_tr: name_tr || name_fa,
        desc_fa:       desc_fa   || null,
        desc_en:       desc_en   || null,
        desc_tr:       desc_tr   || null,
        gradient:      gradient  || null,
        tag:           tag       || null,
        price:         price     || 0,
        stock:         stock     || 0,
        delivery_days: delivery_days != null ? Number(delivery_days) : 5,
        is_active:     is_active !== undefined ? Boolean(is_active) : true,
        updated_at:    new Date(),
        product_colors: color_ids?.length ? {
          create: color_ids.map(cid => ({ color_id: Number(cid), is_available: true })),
        } : undefined,
        product_sizes: sizes?.length ? {
          create: sizes.map(s => ({ size_label: s, is_available: true })),
        } : undefined,
        product_media: media?.length ? {
          create: media.map((m, i) => ({ type: m.type, url: m.url, sort_order: existingCount + i })),
        } : undefined,
      },
      include: {
        categories:     { select: { key: true, label_fa: true } },
        product_colors: { include: { colors: true } },
        product_sizes:  true,
        product_media:  { orderBy: { sort_order: 'asc' } },
      },
    });
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

async function deleteProduct(req, res, next) {
  try {
    await prisma.products.update({
      where: { id: Number(req.params.id) },
      data:  { is_active: false },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Admin Customers ───────────────────────────────────────────────────────────

async function getAdminCustomers(req, res, next) {
  try {
    const customers = await prisma.customers.findMany({
      orderBy: { created_at: 'desc' },
      select: {
        id: true, full_name: true, email: true, mobile: true,
        registered_by: true, preferred_lang: true, is_active: true, created_at: true,
      },
    });
    res.json({ success: true, data: customers });
  } catch (err) { next(err); }
}

async function updateAdminCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { full_name, email, mobile, is_active, preferred_lang } = req.body;

    if (email) {
      const taken = await prisma.customers.findFirst({ where: { email, NOT: { id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    if (mobile) {
      const taken = await prisma.customers.findFirst({ where: { mobile, NOT: { id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Mobile already in use' });
    }

    const data = { updated_at: new Date() };
    if (full_name      !== undefined) data.full_name      = full_name;
    if (email          !== undefined) data.email          = email || null;
    if (mobile         !== undefined) data.mobile         = mobile || null;
    if (is_active      !== undefined) data.is_active      = Boolean(is_active);
    if (preferred_lang !== undefined) data.preferred_lang = preferred_lang;

    const updated = await prisma.customers.update({
      where: { id },
      data,
      select: { id: true, full_name: true, email: true, mobile: true, registered_by: true, preferred_lang: true, is_active: true, created_at: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

module.exports = {
  login, uploadMedia, deleteMedia,
  getCategories, createCategory, updateCategory, deleteCategory,
  getSubcategories, createSubcategory, updateSubcategory, deleteSubcategory,
  getColors, createColor, updateColor, deleteColor,
  getSizes, createSize, updateSize, deleteSize,
  getAdminCustomers, updateAdminCustomer,
  getProducts, createProduct, updateProduct, deleteProduct,
};
