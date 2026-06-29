const prisma  = require('../prisma/client');
const path    = require('path');
const fs      = require('fs');
const { sendOrderEmail, label } = require('../utils/mailer');

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
        categories:        { select: { key: true, label_fa: true } },
        subcategories:     { select: { key: true, label_fa: true } },
        product_colors:    { include: { colors: true } },
        product_sizes:     true,
        product_media:     { orderBy: { sort_order: 'asc' } },
        product_inventory: { include: { colors: { select: { id: true, hex: true, name_fa: true, name_en: true } } }, orderBy: [{ color_id: 'asc' }, { size_label: 'asc' }] },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: products });
  } catch (err) { next(err); }
}

async function createProduct(req, res, next) {
  try {
    const {
      category_id, subcategory_id, gender, code, name_fa, name_en, name_tr,
      desc_fa, desc_en, desc_tr, gradient, tag, price, discounted_price, stock, delivery_days,
      colors, sizes, media, inventory,
    } = req.body;

    let finalCode = code?.trim() || null;
    if (!finalCode) {
      const last = await prisma.products.findFirst({
        where: { code: { startsWith: 'SHIL' } },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
      const nextNum = last?.code ? Number(last.code.replace('SHIL', '')) + 1 : 100;
      finalCode = 'SHIL' + String(nextNum).padStart(8, '0');
    }

    const product = await prisma.products.create({
      data: {
        category_id:    Number(category_id),
        subcategory_id: subcategory_id ? Number(subcategory_id) : null,
        gender:         gender || 'unisex',
        code:          finalCode,
        name_fa,
        name_en: name_en || name_fa,
        name_tr: name_tr || name_fa,
        desc_fa:       desc_fa   || null,
        desc_en:       desc_en   || null,
        desc_tr:       desc_tr   || null,
        gradient:      gradient  || null,
        tag:           tag       || null,
        price:            price     || 0,
        discounted_price: discounted_price != null && discounted_price !== '' ? Number(discounted_price) : null,
        stock:            stock     || 0,
        delivery_days:    delivery_days != null ? Number(delivery_days) : 5,
        product_colors: colors?.length ? {
          create: colors.map(c => ({ color_id: Number(c.id), is_available: c.is_available !== false })),
        } : undefined,
        product_sizes: sizes?.length ? {
          create: sizes.map(s => ({ size_label: s.label, is_available: s.is_available !== false })),
        } : undefined,
        product_media: media?.length ? {
          create: media.map((m, i) => ({ type: m.type, url: m.url, sort_order: i })),
        } : undefined,
      },
      include: {
        categories:        { select: { key: true, label_fa: true } },
        product_colors:    { include: { colors: true } },
        product_sizes:     true,
        product_media:     { orderBy: { sort_order: 'asc' } },
        product_inventory: true,
      },
    });
    if (inventory?.length) {
      await prisma.product_inventory.createMany({
        data: inventory.map(i => ({
          product_id: product.id,
          color_id:   i.color_id ? Number(i.color_id) : null,
          size_label: i.size_label || null,
          quantity:   Number(i.quantity) || 0,
        })),
        skipDuplicates: true,
      });
    }
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
}

async function updateProduct(req, res, next) {
  try {
    const id = Number(req.params.id);
    const {
      category_id, subcategory_id, gender, code, name_fa, name_en, name_tr,
      desc_fa, desc_en, desc_tr, gradient, tag, price, discounted_price, stock, is_active, delivery_days,
      colors, sizes, media, inventory,
    } = req.body;

    await prisma.product_colors.deleteMany({ where: { product_id: id } });
    await prisma.product_sizes.deleteMany({ where:  { product_id: id } });
    await prisma.product_inventory.deleteMany({ where: { product_id: id } });

    const existingMedia = await prisma.product_media.findMany({ where: { product_id: id }, orderBy: { sort_order: 'asc' } });
    const existingCount = existingMedia.length;

    const product = await prisma.products.update({
      where: { id },
      data: {
        category_id:    Number(category_id),
        subcategory_id: subcategory_id ? Number(subcategory_id) : null,
        gender:         gender || 'unisex',
        code:          code?.trim() || null,
        name_fa,
        name_en: name_en || name_fa,
        name_tr: name_tr || name_fa,
        desc_fa:       desc_fa   || null,
        desc_en:       desc_en   || null,
        desc_tr:       desc_tr   || null,
        gradient:      gradient  || null,
        tag:           tag       || null,
        price:            price     || 0,
        discounted_price: discounted_price != null && discounted_price !== '' ? Number(discounted_price) : null,
        stock:            stock     || 0,
        delivery_days:    delivery_days != null ? Number(delivery_days) : 5,
        is_active:        is_active !== undefined ? Boolean(is_active) : true,
        updated_at:    new Date(),
        product_colors: colors?.length ? {
          create: colors.map(c => ({ color_id: Number(c.id), is_available: c.is_available !== false })),
        } : undefined,
        product_sizes: sizes?.length ? {
          create: sizes.map(s => ({ size_label: s.label, is_available: s.is_available !== false })),
        } : undefined,
        product_media: media?.length ? {
          create: media.map((m, i) => ({ type: m.type, url: m.url, sort_order: existingCount + i })),
        } : undefined,
      },
      include: {
        categories:        { select: { key: true, label_fa: true } },
        product_colors:    { include: { colors: true } },
        product_sizes:     true,
        product_media:     { orderBy: { sort_order: 'asc' } },
        product_inventory: true,
      },
    });
    if (inventory?.length) {
      await prisma.product_inventory.createMany({
        data: inventory.map(i => ({
          product_id: id,
          color_id:   i.color_id ? Number(i.color_id) : null,
          size_label: i.size_label || null,
          quantity:   Number(i.quantity) || 0,
        })),
        skipDuplicates: true,
      });
    }
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

// ─── Admin Orders ──────────────────────────────────────────────────────────────

const ADMIN_ORDER_INCLUDE = {
  customers:   { select: { id: true, full_name: true, email: true, mobile: true, preferred_lang: true } },
  addresses:   true,
  order_items: {
    include: {
      products: { select: { id: true, code: true, name_fa: true, name_en: true, name_tr: true, delivery_days: true } },
      colors:   true,
    },
  },
};

async function getAdminOrders(req, res, next) {
  try {
    const orders = await prisma.orders.findMany({
      include: ADMIN_ORDER_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
}

async function setPaymentInfo(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'preorder') {
      return res.status(400).json({ success: false, message: 'Order must be in preorder status' });
    }
    const { iban, bank_name, account_holder } = req.body;
    const updated = await prisma.orders.update({
      where: { id },
      data:  { iban, bank_name, account_holder, status: 'payment_needed', updated_at: new Date() },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = [
        { label: label('bank_name', ol),      value: bank_name },
        { label: label('account_holder', ol), value: account_holder },
        { label: label('iban', ol),           value: iban, dir: 'ltr' },
        { label: label('order_total', ol),    value: Number(updated.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' TL', dir: 'ltr' },
      ];
      sendOrderEmail(updated.customers, updated, 'payment_needed', extraInfo).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function approvePayment(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'approval_needed') {
      return res.status(400).json({ success: false, message: 'Order must be in approval_needed status' });
    }

    const updated = await prisma.orders.update({
      where: { id },
      data:  { status: 'preparing', updated_at: new Date() },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const attachFiles = [];
      if (order.payment_receipt_url) {
        const receiptPath = path.join(__dirname, '../public', order.payment_receipt_url);
        const ext = path.extname(order.payment_receipt_url).toLowerCase();
        const mime = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg');
        const stat = fs.statSync(receiptPath);
        if (stat.size <= 8 * 1024 * 1024) {
          attachFiles.push({ filename: 'payment_receipt' + ext, path: receiptPath, contentType: mime });
        }
      }
      sendOrderEmail(updated.customers, updated, 'preparing', [], attachFiles).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function rejectPayment(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'approval_needed') {
      return res.status(400).json({ success: false, message: 'Order must be in approval_needed status' });
    }
    const { reason } = req.body;
    const updated = await prisma.orders.update({
      where: { id },
      data:  {
        status:                   'payment_needed',
        payment_rejection_reason: reason || null,
        payment_receipt_url:      null,
        updated_at:               new Date(),
      },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = reason ? [{ label: label('reject_reason', ol), value: reason }] : [];
      const attachFiles = [];
      if (order.payment_receipt_url) {
        const receiptPath = path.join(__dirname, '../public', order.payment_receipt_url);
        const ext = path.extname(order.payment_receipt_url).toLowerCase();
        const mime = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg');
        const stat = fs.statSync(receiptPath);
        if (stat.size <= 8 * 1024 * 1024) {
          attachFiles.push({ filename: 'payment_receipt' + ext, path: receiptPath, contentType: mime });
        }
      }
      sendOrderEmail(updated.customers, updated, 'rejected', extraInfo, attachFiles).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function setShipping(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'preparing') {
      return res.status(400).json({ success: false, message: 'Order must be in preparing status' });
    }
    const { carrier_name, tracking_number } = req.body;
    const updated = await prisma.orders.update({
      where: { id },
      data:  { carrier_name, tracking_number, status: 'delivery', shipped_at: new Date(), updated_at: new Date() },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = [
        { label: label('carrier', ol),  value: carrier_name },
        { label: label('tracking', ol), value: tracking_number, dir: 'ltr' },
      ];
      sendOrderEmail(updated.customers, updated, 'delivery', extraInfo).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function markDelivered(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'delivery') {
      return res.status(400).json({ success: false, message: 'Order must be in delivery status' });
    }
    const updated = await prisma.orders.update({
      where: { id },
      data:  { status: 'delivered', delivered_at: new Date(), updated_at: new Date() },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      sendOrderEmail(updated.customers, updated, 'delivered').catch(() => {});
    }
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
  getAdminOrders, setPaymentInfo, approvePayment, rejectPayment, setShipping, markDelivered,
};
