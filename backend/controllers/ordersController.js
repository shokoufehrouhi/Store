const prisma  = require('../prisma/client');
const fs      = require('fs');
const path    = require('path');
const { sendOrderEmail } = require('../utils/mailer');

// ─── Shared include for order queries ─────────────────────────────────────────
const ORDER_INCLUDE = {
  customers:   { select: { id: true, full_name: true, email: true, mobile: true, preferred_lang: true } },
  addresses:   true,
  order_items: {
    include: {
      products: { select: { id: true, code: true, name_fa: true, name_en: true, name_tr: true, delivery_days: true } },
      colors: true,
    },
  },
};

// ─── Session auth helper ──────────────────────────────────────────────────────
async function getCustomerFromSession(req, res) {
  const token = req.headers['x-session-token'];
  if (!token) {
    res.status(401).json({ success: false, message: 'Session expired' });
    return null;
  }
  const session = await prisma.sessions.findFirst({
    where: { id: token, is_active: true, expires_at: { gt: new Date() } },
  });
  if (!session) {
    res.status(401).json({ success: false, message: 'Session expired' });
    return null;
  }
  await prisma.sessions.update({
    where: { id: token },
    data:  { last_activity: new Date(), expires_at: new Date(Date.now() + 30 * 60 * 1000) },
  });
  return session.customer_id;
}

// ─── createPreorder: POST /api/orders ────────────────────────────────────────
async function createPreorder(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const { items, note, lang, address_id } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: 'items are required' });
    }
    const safeLang = ['fa', 'en', 'tr'].includes(lang) ? lang : 'fa';

    const total = items.reduce(function(sum, i) { return sum + (Number(i.unit_price) * Number(i.qty)); }, 0);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.orders.create({
        data: {
          customer_id:    customerId,
          address_id:     address_id ? Number(address_id) : null,
          status:         'preorder',
          channel:        'online',
          note:           note || null,
          lang:           safeLang,
          total_amount:   total,
          order_items: {
            create: items.map(function(i) {
              return {
                product_id: i.product_id,
                color_id:   i.color_id   || null,
                size_label: i.size_label || null,
                qty:        i.qty,
                unit_price: i.unit_price,
              };
            }),
          },
        },
        include: ORDER_INCLUDE,
      });
      for (const item of items) {
        await tx.$executeRaw`
          UPDATE product_inventory
          SET quantity = GREATEST(0, quantity - ${item.qty})
          WHERE product_id  = ${item.product_id}
            AND color_id    IS NOT DISTINCT FROM ${item.color_id || null}
            AND size_label  IS NOT DISTINCT FROM ${item.size_label || null}
        `;
      }
      return created;
    });

    sendOrderEmail(order.customers, order, 'preorder', []).catch(() => {});
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

// ─── getMyOrders: GET /api/orders/my ─────────────────────────────────────────
async function getMyOrders(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const orders = await prisma.orders.findMany({
      where:   { customer_id: customerId },
      include: ORDER_INCLUDE,
      orderBy: { created_at: 'desc' },
    });

    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
}

// ─── getMyOrder: GET /api/orders/:id ─────────────────────────────────────────
async function getMyOrder(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const order = await prisma.orders.findUnique({
      where:   { id: Number(req.params.id) },
      include: ORDER_INCLUDE,
    });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.customer_id !== customerId) return res.status(403).json({ success: false, message: 'Forbidden' });

    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

// ─── cancelOrder: DELETE /api/orders/:id ─────────────────────────────────────
async function cancelOrder(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const order = await prisma.orders.findUnique({
      where: { id: Number(req.params.id) },
      include: { order_items: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.customer_id !== customerId) return res.status(403).json({ success: false, message: 'Forbidden' });

    if (order.status !== 'preorder' && order.status !== 'payment_needed') {
      return res.status(400).json({ success: false, message: 'Cannot cancel order in current status' });
    }

    const fullOrder = await prisma.orders.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });

    await prisma.$transaction(async (tx) => {
      await tx.orders.update({
        where: { id: order.id },
        data:  { status: 'cancelled', updated_at: new Date() },
      });
      for (const item of order.order_items) {
        await tx.$executeRaw`
          UPDATE product_inventory
          SET quantity = quantity + ${item.qty}
          WHERE product_id  = ${item.product_id}
            AND color_id    IS NOT DISTINCT FROM ${item.color_id}
            AND size_label  IS NOT DISTINCT FROM ${item.size_label}
        `;
      }
    });

    if (fullOrder && fullOrder.customers) {
      sendOrderEmail(fullOrder.customers, fullOrder, 'cancelled').catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── uploadReceipt: POST /api/orders/:id/receipt ─────────────────────────────
async function uploadReceipt(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const order = await prisma.orders.findUnique({ where: { id: Number(req.params.id) } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.customer_id !== customerId) return res.status(403).json({ success: false, message: 'Forbidden' });

    if (order.status !== 'payment_needed') {
      return res.status(400).json({ success: false, message: 'Receipt can only be uploaded when status is payment_needed' });
    }

    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const okExt  = /\.(jpg|jpeg|png|pdf)$/i.test(req.file.originalname);
    const okMime = ['image/jpeg', 'image/png', 'application/pdf'].includes(req.file.mimetype);
    if (!okExt && !okMime) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, errorCode: 'invalid_file_type' });
    }

    const receiptUrl = '/uploads/' + req.file.filename;

    const updated = await prisma.orders.update({
      where: { id: order.id },
      data: {
        payment_receipt_url:       receiptUrl,
        status:                    'approval_needed',
        payment_rejection_reason:  null,
        updated_at:                new Date(),
      },
      include: ORDER_INCLUDE,
    });

    const receiptPath = req.file.path;
    const ext = path.extname(req.file.filename).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg');
    const attachFiles = req.file.size <= 8 * 1024 * 1024
      ? [{ filename: 'payment_receipt' + ext, path: receiptPath, contentType: mime }]
      : [];
    sendOrderEmail(updated.customers, updated, 'receipt_received', [], attachFiles)
      .catch((err) => { console.error('[receipt email] error:', err); });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPreorder, getMyOrders, getMyOrder, cancelOrder, uploadReceipt };
