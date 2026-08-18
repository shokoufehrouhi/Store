const prisma  = require('../prisma/client');
const fs      = require('fs');
const path    = require('path');
const { sendOrderEmail, label } = require('../utils/mailer');

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
  order_returns: { orderBy: { requested_at: 'desc' }, take: 1 },
  link_request_items: { orderBy: { id: 'asc' } },
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
    data:  { last_activity: new Date(), expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });
  return session.customer_id;
}

// ─── createPreorder: POST /api/orders ────────────────────────────────────────
async function createPreorder(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const { items, note, lang, address_id, coupon_code } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: 'items are required' });
    }
    const safeLang = ['fa', 'en', 'tr'].includes(lang) ? lang : 'fa';

    // Cap concurrent active preorders per customer (was 1, raised to 3)
    const activePreorderCount = await prisma.orders.count({
      where: { customer_id: customerId, status: 'preorder' },
    });
    if (activePreorderCount >= 3) {
      return res.status(409).json({ success: false, message: 'active_preorder_exists' });
    }

    const originalTotal = items.reduce(function(sum, i) { return sum + (Number(i.unit_price) * Number(i.qty)); }, 0);

    // validate coupon — atomic: read eligibility, then increment inside transaction
    let discountAmount = 0, appliedCode = null, appliedCouponId = null;
    if (coupon_code) {
      const now = new Date();
      const coupon = await prisma.coupons.findFirst({
        where: { code: coupon_code.trim().toUpperCase(), is_active: true,
          OR: [{ starts_at: null }, { starts_at: { lte: now } }],
          AND: [{ OR: [{ expires_at: null }, { expires_at: { gt: now } }] }] },
        include: { coupon_assignments: { where: { customer_id: customerId } } },
      });
      if (coupon && (coupon.for_all || coupon.coupon_assignments.length > 0)) {
        // per-customer single-use check for all coupon types
        let blocked = false;
        const prevUse = await prisma.orders.findFirst({
          where: { customer_id: customerId, coupon_code: coupon.code, status: { notIn: ['cancelled', 'rejected'] } },
          select: { id: true },
        });
        if (prevUse) blocked = true;
        if (!blocked) {
          discountAmount = coupon.type === 'percent'
            ? Math.round(originalTotal * Number(coupon.value) / 100)
            : Math.min(Math.round(Number(coupon.value)), originalTotal);
          appliedCode     = coupon.code;
          appliedCouponId = coupon.id;
        }
      }
    }
    const total = Math.max(0, originalTotal - discountAmount);

    const order = await prisma.$transaction(async (tx) => {
      // Atomic increment — fails silently if limit already reached
      if (appliedCouponId) {
        const updated = await tx.$executeRaw`
          UPDATE coupons
          SET used_count = used_count + 1,
              is_active  = CASE
                WHEN max_uses IS NOT NULL AND (used_count + 1) >= max_uses THEN false
                WHEN for_all = false AND (used_count + 1) >= (SELECT COUNT(*) FROM coupon_assignments WHERE coupon_id = ${appliedCouponId}) THEN false
                ELSE is_active
              END,
              updated_at = NOW()
          WHERE id = ${appliedCouponId}
            AND is_active = true
            AND (max_uses IS NULL OR used_count < max_uses)
        `;
        if (updated === 0) {
          // limit reached between validate and now — clear discount
          discountAmount  = 0;
          appliedCode     = null;
          appliedCouponId = null;
        }
      }

      const finalTotal = Math.max(0, originalTotal - discountAmount);
      const created = await tx.orders.create({
        data: {
          customer_id:     customerId,
          address_id:      address_id ? Number(address_id) : null,
          status:          'preorder',
          channel:         'online',
          note:            note || null,
          lang:            safeLang,
          total_amount:    finalTotal,
          original_amount: discountAmount > 0 ? originalTotal : null,
          discount_amount: discountAmount,
          coupon_code:     appliedCode,
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

    if (order.status !== 'preorder' && order.status !== 'payment_needed' && order.status !== 'link_requested') {
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

    const okExt  = /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|pdf)$/i.test(req.file.originalname);
    const okMime = /^image\//.test(req.file.mimetype) || req.file.mimetype === 'application/pdf';
    if (!okExt && !okMime) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, errorCode: 'invalid_file_type' });
    }

    const { compressUploadedImage } = require('../middleware/upload');
    const receiptUrl = await compressUploadedImage(req);

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


// ─── createLinkRequest: POST /api/orders/link-request ────────────────────────
// Customer asks us to source a product from an external link (not in our own
// catalog, so there's no product_id/price yet) — an admin manually announces a
// price afterward (see adminController.announceQuotePrice), and the customer
// then approves or rejects it (below). This intentionally does not create any
// order_items (order_items.product_id is required/FK'd to our own catalog).
const MAX_LINK_ITEMS = 5;

async function createLinkRequest(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const { items, lang } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'items_required' });
    }
    if (items.length > MAX_LINK_ITEMS) {
      return res.status(400).json({ success: false, message: 'too_many_items' });
    }

    // Validate every item up front — one bad link fails the whole request
    // rather than silently dropping it.
    const cleanItems = [];
    for (const raw of items) {
      const link = (raw?.product_link || '').trim();
      if (!link) return res.status(400).json({ success: false, message: 'product_link_required' });
      if (link.length > 500) return res.status(400).json({ success: false, message: 'product_link_too_long' });
      try {
        const u = new URL(link);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad_protocol');
      } catch (e) {
        return res.status(400).json({ success: false, message: 'invalid_product_link' });
      }
      cleanItems.push({
        product_link: link,
        size:         raw.size  ? String(raw.size).trim().slice(0, 50)   || null : null,
        color:        raw.color ? String(raw.color).trim().slice(0, 50)  || null : null,
        qty:          Math.min(999, Math.max(1, parseInt(raw.qty, 10) || 1)),
        note:         raw.note  ? String(raw.note).trim().slice(0, 2000) || null : null,
      });
    }
    const safeLang = ['fa', 'en', 'tr'].includes(lang) ? lang : 'fa';

    // Cap concurrent link-requests awaiting a price/response per customer
    // (was 1, raised to 3 — mirrors the same cap on createPreorder above).
    // This caps the number of open ORDERS, not links — each order can still
    // hold up to MAX_LINK_ITEMS links.
    const activeRequestCount = await prisma.orders.count({
      where:  { customer_id: customerId, status: { in: ['link_requested', 'price_quoted'] } },
    });
    if (activeRequestCount >= 3) {
      return res.status(409).json({ success: false, message: 'active_link_request_exists' });
    }

    const order = await prisma.orders.create({
      data: {
        customer_id:  customerId,
        status:       'link_requested',
        channel:      'online',
        lang:         safeLang,
        total_amount: 0,
        link_request_items: { create: cleanItems },
      },
      include: ORDER_INCLUDE,
    });

    const ol = order.lang || 'fa';
    const extraInfo = order.link_request_items.map((it, i) => ({
      label: `${label('product_link', ol)} ${order.link_request_items.length > 1 ? '#' + (i + 1) : ''}`.trim(),
      value: it.product_link,
      dir:   'ltr',
    }));
    sendOrderEmail(order.customers, order, 'link_requested', extraInfo).catch(() => {});
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

// Shared terminal-rejection — used both when the customer explicitly rejects
// the whole quote, and when they "approve" but deselect every priced item
// (functionally the same outcome: nothing left to buy).
async function rejectWholeOrder(order) {
  const ol = order.lang || 'fa';
  const reasonText = ({
    fa: 'مشتری با قیمت اعلام‌شده موافقت نکرد.',
    en: 'Customer did not accept the quoted price.',
    tr: 'Müşteri teklif edilen fiyatı kabul etmedi.',
  })[ol] || 'Customer rejected the quote.';

  const updated = await prisma.orders.update({
    where:   { id: order.id },
    data:    { status: 'rejected', payment_rejection_reason: reasonText, rejected_at: new Date(), updated_at: new Date() },
    include: ORDER_INCLUDE,
  });
  sendOrderEmail(updated.customers, updated, 'preorder_rejected', []).catch(() => {});
  return updated;
}

// ─── approveQuote: POST /api/orders/:id/quote/approve ─────────────────────────
// Customer accepts the price an admin announced. With several priced links on
// one order, they don't have to want all of them — body.item_ids picks which
// link_request_items to keep; whichever priced ones are left out get marked
// declined (same rejected/rejection_reason fields the admin's own per-item
// reject uses) and are excluded from the recomputed total_amount. Omitting
// item_ids keeps everything priced (the common single-link case). Either way
// this rejoins the regular preorder pipeline exactly where a cart-based order
// would be (status 'preorder'), so the existing admin "send payment info" step
// needs no changes.
async function approveQuote(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const order = await prisma.orders.findUnique({
      where:   { id: Number(req.params.id) },
      include: { link_request_items: { orderBy: { id: 'asc' } } },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.customer_id !== customerId) return res.status(403).json({ success: false, message: 'Forbidden' });
    if (order.status !== 'price_quoted') {
      return res.status(400).json({ success: false, message: 'Order must be in price_quoted status' });
    }

    const pricedItems = order.link_request_items.filter((it) => !it.rejected && it.unit_price != null);

    if (pricedItems.length) {
      // items: [{ id, qty }] — the customer's final pick per priced link,
      // letting them raise or lower the quantity they originally asked for
      // (or drop an item entirely with qty 0). Omitting the field entirely
      // (older clients, or a single-priced-item order using the plain
      // Approve button) keeps every priced item at its originally-requested
      // quantity — full backward compat with the old approve-everything flow.
      const rawItems = Array.isArray(req.body && req.body.items) ? req.body.items : null;
      const qtyById  = new Map();
      if (rawItems) {
        for (const r of rawItems) {
          const id = Number(r && r.id);
          if (!Number.isInteger(id)) continue;
          qtyById.set(id, Math.min(999, Math.max(0, parseInt(r && r.qty, 10) || 0)));
        }
      }

      const resolvedItems = pricedItems.map((it) => ({
        item: it,
        qty:  rawItems ? (qtyById.has(it.id) ? qtyById.get(it.id) : 0) : it.qty,
      }));
      const keptItems     = resolvedItems.filter((r) => r.qty > 0);
      const declinedItems = resolvedItems.filter((r) => r.qty === 0);

      if (!keptItems.length) {
        const updated = await rejectWholeOrder(order);
        return res.json({ success: true, data: updated });
      }

      const ol = order.lang || 'fa';
      const declineReason = ({
        fa: 'مشتری این مورد را هنگام تایید انتخاب نکرد.',
        en: 'Customer did not select this item when approving.',
        tr: 'Müşteri onay sırasında bu ürünü seçmedi.',
      })[ol] || 'Customer did not select this item.';
      const now   = new Date();
      const total = Math.round(keptItems.reduce((sum, r) => sum + Number(r.item.unit_price) * r.qty, 0));

      await prisma.$transaction([
        ...declinedItems.map((r) => prisma.link_request_items.update({
          where: { id: r.item.id },
          data:  { rejected: true, rejection_reason: declineReason, rejected_at: now },
        })),
        // Persist the customer's final approved quantity — this row now
        // represents what's actually being bought, feeding payment/shipping
        // downstream, so it must reflect the post-approval qty, not the
        // originally-requested one.
        ...keptItems
          .filter((r) => r.qty !== r.item.qty)
          .map((r) => prisma.link_request_items.update({
            where: { id: r.item.id },
            data:  { qty: r.qty },
          })),
        prisma.orders.update({
          where: { id: order.id },
          data:  { status: 'preorder', total_amount: total, updated_at: now },
        }),
      ]);
    } else {
      // Not a link-based order (or somehow has none priced) — plain approve.
      await prisma.orders.update({ where: { id: order.id }, data: { status: 'preorder', updated_at: new Date() } });
    }

    const updated = await prisma.orders.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });
    sendOrderEmail(updated.customers, updated, 'preorder', []).catch(() => {});
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// ─── rejectQuote: POST /api/orders/:id/quote/reject ───────────────────────────
// Customer declines the announced price entirely — same terminal state (and
// reused reason field) as an admin-side preorder rejection, so it drops out
// of every "active order" list the same way.
async function rejectQuote(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;

    const order = await prisma.orders.findUnique({ where: { id: Number(req.params.id) } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.customer_id !== customerId) return res.status(403).json({ success: false, message: 'Forbidden' });
    if (order.status !== 'price_quoted') {
      return res.status(400).json({ success: false, message: 'Order must be in price_quoted status' });
    }
    const updated = await rejectWholeOrder(order);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPreorder, getMyOrders, getMyOrder, cancelOrder, uploadReceipt, createLinkRequest, approveQuote, rejectQuote };
