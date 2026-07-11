const prisma  = require('../prisma/client');
const path    = require('path');
const fs      = require('fs');
const { sendOrderEmail, label } = require('../utils/mailer');

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function login(req, res) {
  const { username, password } = req.body;
  if (username.toLowerCase() === process.env.ADMIN_USER.toLowerCase() && password === process.env.ADMIN_PASS) {
    return res.json({ success: true, token: process.env.ADMIN_TOKEN });
  }
  return res.status(401).json({ success: false, message: 'Invalid username or password' });
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
      brand, supplier_shop_name, product_link, supplier_code, supplier_note,
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
        stock:              stock     || 0,
        delivery_days:      delivery_days != null ? Number(delivery_days) : 5,
        brand:              brand?.trim()              || null,
        supplier_shop_name: supplier_shop_name?.trim() || null,
        product_link:       product_link?.trim()       || null,
        supplier_code:      supplier_code?.trim()      || null,
        supplier_note:      supplier_note?.trim()      || null,
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
      category_id, subcategory_id, gender, name_fa, name_en, name_tr,
      desc_fa, desc_en, desc_tr, gradient, tag, price, discounted_price, stock, is_active, delivery_days,
      brand, supplier_shop_name, product_link, supplier_code, supplier_note,
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
        stock:              stock     || 0,
        delivery_days:      delivery_days != null ? Number(delivery_days) : 5,
        is_active:          is_active !== undefined ? Boolean(is_active) : true,
        brand:              brand?.trim()              || null,
        supplier_shop_name: supplier_shop_name?.trim() || null,
        product_link:       product_link?.trim()       || null,
        supplier_code:      supplier_code?.trim()      || null,
        supplier_note:      supplier_note?.trim()      || null,
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
      if (!/^05[0-9]{9}$/.test((mobile || '').replace(/[\s\-]/g, ''))) {
        return res.status(400).json({ success: false, message: 'invalid_mobile' });
      }
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
        rejected_at:              new Date(),
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

async function rejectPreorder(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'preorder') {
      return res.status(400).json({ success: false, message: 'Order must be in preorder status' });
    }
    const { reason } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.orders.update({
        where: { id },
        data:  { status: 'rejected', payment_rejection_reason: reason || null, rejected_at: new Date(), updated_at: new Date() },
        include: ADMIN_ORDER_INCLUDE,
      });
      // refund coupon usage and re-activate if it was auto-deactivated
      if (order.coupon_code && order.discount_amount > 0) {
        await tx.$executeRaw`
          UPDATE coupons
          SET used_count = GREATEST(0, used_count - 1),
              is_active  = CASE
                WHEN is_active = false AND max_uses IS NOT NULL AND GREATEST(0, used_count - 1) < max_uses THEN true
                WHEN is_active = false AND for_all = false AND GREATEST(0, used_count - 1) < (SELECT COUNT(*) FROM coupon_assignments WHERE coupon_id = id) THEN true
                ELSE is_active
              END,
              updated_at = NOW()
          WHERE code = ${order.coupon_code}
        `;
      }
      return u;
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = reason ? [{ label: label('reject_reason', ol), value: reason }] : [];
      sendOrderEmail(updated.customers, updated, 'preorder_rejected', extraInfo).catch(() => {});
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

// ─── Bank Accounts ────────────────────────────────────────────────────────────

async function getBankAccounts(req, res, next) {
  try {
    const accounts = await prisma.bank_accounts.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
    res.json({ success: true, data: accounts });
  } catch (err) { next(err); }
}

async function createBankAccount(req, res, next) {
  try {
    const { bank_name, account_holder, iban, is_active, sort_order } = req.body;
    if (!bank_name || !account_holder || !iban)
      return res.status(400).json({ success: false, message: 'bank_name, account_holder and iban are required' });
    const account = await prisma.bank_accounts.create({
      data: { bank_name, account_holder, iban, is_active: is_active !== false, sort_order: sort_order || 0 },
    });
    res.status(201).json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function updateBankAccount(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { bank_name, account_holder, iban, is_active, sort_order } = req.body;
    const account = await prisma.bank_accounts.update({
      where: { id },
      data: { bank_name, account_holder, iban, is_active, sort_order },
    });
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function deleteBankAccount(req, res, next) {
  try {
    const id = Number(req.params.id);
    await prisma.bank_accounts.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Reports ───────────────────────────────────────────────────────────────────

async function getReports(req, res, next) {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);
    const hasDate = Object.keys(dateFilter).length > 0;
    const orderWhere = hasDate ? { created_at: dateFilter } : {};

    const [
      totalOrders,
      successOrders,
      rejectedOrders,
      cancelledOrders,
      activeOrders,
      revenueAgg,
      totalCustomers,
      newCustomers,
    ] = await Promise.all([
      prisma.orders.count({ where: orderWhere }),
      prisma.orders.count({ where: { ...orderWhere, status: 'delivered' } }),
      prisma.orders.count({ where: { ...orderWhere, status: 'rejected' } }),
      prisma.orders.count({ where: { ...orderWhere, status: 'cancelled' } }),
      prisma.orders.count({ where: { ...orderWhere, status: { in: ['preorder','payment_needed','approval_needed','preparing','delivery'] } } }),
      prisma.orders.aggregate({
        where: { ...orderWhere, status: 'delivered' },
        _sum: { total_amount: true },
        _avg: { total_amount: true },
      }),
      prisma.customers.count(),
      hasDate ? prisma.customers.count({ where: { created_at: dateFilter } }) : prisma.customers.count(),
    ]);

    // Status breakdown via raw SQL
    const statusRows = hasDate
      ? await prisma.$queryRaw`SELECT status, COUNT(*)::int AS cnt FROM orders WHERE created_at >= ${dateFilter.gte} AND created_at <= ${dateFilter.lte} GROUP BY status`
      : await prisma.$queryRaw`SELECT status, COUNT(*)::int AS cnt FROM orders GROUP BY status`;
    const statusMap = {};
    for (const row of statusRows) statusMap[row.status] = Number(row.cnt);

    // Top products via raw SQL (Prisma groupBy doesn't support relation filters)
    let topProductsEnriched = [];
    try {
      const rows = hasDate
        ? await prisma.$queryRaw`
            SELECT oi.product_id, SUM(oi.qty)::int AS total_qty,
                   p.name_fa, p.name_en, p.name_tr, p.code
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN products p ON p.id = oi.product_id
            WHERE o.status = 'delivered'
              AND o.created_at >= ${dateFilter.gte}
              AND o.created_at <= ${dateFilter.lte}
            GROUP BY oi.product_id, p.name_fa, p.name_en, p.name_tr, p.code
            ORDER BY total_qty DESC
            LIMIT 5`
        : await prisma.$queryRaw`
            SELECT oi.product_id, SUM(oi.qty)::int AS total_qty,
                   p.name_fa, p.name_en, p.name_tr, p.code
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN products p ON p.id = oi.product_id
            WHERE o.status = 'delivered'
            GROUP BY oi.product_id, p.name_fa, p.name_en, p.name_tr, p.code
            ORDER BY total_qty DESC
            LIMIT 5`;
      topProductsEnriched = rows.map(r => ({
        product_id: r.product_id,
        qty:        Number(r.total_qty),
        name_fa:    r.name_fa,
        name_en:    r.name_en,
        name_tr:    r.name_tr,
        code:       r.code,
      }));
    } catch (_) {}

    res.json({
      success: true,
      data: {
        orders: {
          total:     totalOrders,
          delivered: successOrders,
          rejected:  rejectedOrders,
          cancelled: cancelledOrders,
          active:    activeOrders,
          byStatus:  statusMap,
        },
        revenue: {
          total: Number(revenueAgg._sum.total_amount || 0),
          avg:   Math.round(Number(revenueAgg._avg.total_amount || 0)),
        },
        customers: {
          total: totalCustomers,
          new:   newCustomers,
        },
        topProducts: topProductsEnriched,
      },
    });
  } catch (err) { next(err); }
}

// ─── Financial Report ──────────────────────────────────────────────────────────

async function getFinancialReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);
    const hasDate = Object.keys(dateFilter).length > 0;

    const where = {
      status: 'delivered',
      ...(hasDate ? { created_at: dateFilter } : {}),
    };

    const [summary, byBank, orders] = await Promise.all([
      prisma.orders.aggregate({
        where,
        _sum:   { total_amount: true },
        _count: { id: true },
        _avg:   { total_amount: true },
        _max:   { total_amount: true },
        _min:   { total_amount: true },
      }),

      // Breakdown per bank account
      hasDate
        ? prisma.$queryRaw`
            SELECT
              COALESCE(bank_name, '—')      AS bank_name,
              COALESCE(account_holder, '—') AS account_holder,
              COALESCE(iban, '—')           AS iban,
              COUNT(*)::int                 AS order_count,
              SUM(total_amount)::float      AS total_amount
            FROM orders
            WHERE status = 'delivered'
              AND created_at >= ${dateFilter.gte}
              AND created_at <= ${dateFilter.lte}
            GROUP BY bank_name, account_holder, iban
            ORDER BY total_amount DESC`
        : prisma.$queryRaw`
            SELECT
              COALESCE(bank_name, '—')      AS bank_name,
              COALESCE(account_holder, '—') AS account_holder,
              COALESCE(iban, '—')           AS iban,
              COUNT(*)::int                 AS order_count,
              SUM(total_amount)::float      AS total_amount
            FROM orders
            WHERE status = 'delivered'
            GROUP BY bank_name, account_holder, iban
            ORDER BY total_amount DESC`,

      prisma.orders.findMany({
        where,
        orderBy:  { created_at: 'desc' },
        select: {
          id:             true,
          created_at:     true,
          total_amount:   true,
          bank_name:      true,
          account_holder: true,
          iban:           true,
          note:           true,
          customers: { select: { id: true, full_name: true, mobile: true, email: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalRevenue:  Math.round(Number(summary._sum.total_amount  || 0)),
          orderCount:    summary._count.id,
          avgOrder:      Math.round(Number(summary._avg.total_amount  || 0)),
          maxOrder:      Math.round(Number(summary._max.total_amount  || 0)),
          minOrder:      Math.round(Number(summary._min.total_amount  || 0)),
        },
        byBank: byBank.map(r => ({
          bank_name:      r.bank_name,
          account_holder: r.account_holder,
          iban:           r.iban,
          orderCount:     Number(r.order_count),
          totalAmount:    Math.round(Number(r.total_amount || 0)),
        })),
        orders: orders.map(o => ({
          id:             o.id,
          created_at:     o.created_at,
          total_amount:   Math.round(Number(o.total_amount || 0)),
          bank_name:      o.bank_name,
          account_holder: o.account_holder,
          iban:           o.iban,
          customer_name:  o.customers?.full_name || '—',
          customer_phone: o.customers?.mobile || o.customers?.email || '—',
        })),
      },
    });
  } catch (err) { next(err); }
}

// ─── Customer Reports ──────────────────────────────────────────────────────────

async function getCustomerReports(req, res, next) {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalCustomers, newToday, newThisWeek, newThisMonth, topCustomers] = await Promise.all([
      prisma.customers.count({ where: { is_active: true } }),
      prisma.customers.count({ where: { created_at: { gte: startOfToday } } }),
      prisma.customers.count({ where: { created_at: { gte: startOfWeek  } } }),
      prisma.customers.count({ where: { created_at: { gte: startOfMonth } } }),
      prisma.$queryRaw`
        SELECT
          c.id,
          c.full_name,
          c.email,
          c.mobile,
          COUNT(o.id)::int           AS order_count,
          SUM(o.total_amount)::float AS total_spent
        FROM customers c
        JOIN orders o ON o.customer_id = c.id AND o.status = 'delivered'
        GROUP BY c.id, c.full_name, c.email, c.mobile
        ORDER BY order_count DESC, total_spent DESC
        LIMIT 50
      `,
    ]);

    res.json({
      success: true,
      data: {
        totalCustomers,
        newToday,
        newThisWeek,
        newThisMonth,
        topCustomers: topCustomers.map(r => ({
          id:          r.id,
          full_name:   r.full_name,
          email:       r.email,
          mobile:      r.mobile,
          orderCount:  Number(r.order_count),
          totalSpent:  Math.round(Number(r.total_spent || 0)),
        })),
      },
    });
  } catch (err) { next(err); }
}

// ─── Coupon Report ────────────────────────────────────────────────────────────
async function getCouponReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const dateFilter = from && to
      ? { created_at: { gte: new Date(from), lte: new Date(to + 'T23:59:59Z') } }
      : {};

    // All coupons with their used orders
    const coupons = await prisma.coupons.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        coupon_assignments: {
          include: { customers: { select: { id: true, full_name: true, email: true, mobile: true } } },
        },
      },
    });

    // Orders that used a coupon
    const orders = await prisma.orders.findMany({
      where: { coupon_code: { not: null }, ...dateFilter },
      select: {
        id: true, coupon_code: true, created_at: true,
        total_amount: true, original_amount: true, discount_amount: true, status: true,
        customers: { select: { id: true, full_name: true, email: true, mobile: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    // Group orders by coupon_code
    const ordersByCode = {};
    for (const o of orders) {
      const c = o.coupon_code;
      if (!ordersByCode[c]) ordersByCode[c] = [];
      ordersByCode[c].push(o);
    }

    const report = coupons.map((cp) => {
      const cpOrders = ordersByCode[cp.code] || [];
      const totalDiscount   = cpOrders.reduce((s, o) => s + Number(o.discount_amount), 0);
      const totalFinal      = cpOrders.reduce((s, o) => s + Number(o.total_amount),    0);
      const totalOriginal   = cpOrders.reduce((s, o) => s + Number(o.original_amount || o.total_amount), 0);
      return {
        id:          cp.id,
        code:        cp.code,
        type:        cp.type,
        value:       Number(cp.value),
        is_active:   cp.is_active,
        for_all:     cp.for_all,
        used_count:  cp.used_count,
        max_uses:    cp.max_uses,
        starts_at:   cp.starts_at,
        expires_at:  cp.expires_at,
        assignments: (cp.coupon_assignments || []).map((a) => a.customers),
        orders:      cpOrders,
        stats: {
          order_count:    cpOrders.length,
          total_original: totalOriginal,
          total_discount: totalDiscount,
          total_final:    totalFinal,
        },
      };
    });

    const globalStats = {
      total_coupons_used: orders.length,
      total_discount:     orders.reduce((s, o) => s + Number(o.discount_amount), 0),
      total_revenue:      orders.reduce((s, o) => s + Number(o.total_amount),    0),
    };

    res.json({ success: true, data: { coupons: report, stats: globalStats } });
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
  getAdminOrders, setPaymentInfo, approvePayment, rejectPayment, rejectPreorder, setShipping, markDelivered,
  getBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount,
  getReports, getFinancialReport, getCustomerReports, getCouponReport,
};
