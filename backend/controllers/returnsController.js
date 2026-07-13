const prisma = require('../prisma/client');

function addWorkingDays(date, days) {
  let d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function generateReturnCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'RTN-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function getCustomerFromSession(req, res) {
  const token = req.headers['x-session-token'];
  if (!token) { res.status(401).json({ success: false, message: 'Login required' }); return null; }
  const session = await prisma.sessions.findFirst({
    where: { id: token, is_active: true, expires_at: { gt: new Date() } },
  });
  if (!session) { res.status(401).json({ success: false, message: 'Session expired' }); return null; }
  return session.customer_id;
}

async function autoExpire(ret) {
  if (ret && ret.status === 'requested' && ret.deadline_at && new Date() > new Date(ret.deadline_at)) {
    return await prisma.order_returns.update({
      where: { id: ret.id },
      data: { status: 'expired', updated_at: new Date() },
    });
  }
  return ret;
}

// ─── Customer: request return ─────────────────────────────────────────────────
async function customerRequestReturn(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const orderId = Number(req.params.id);

    const order = await prisma.orders.findFirst({
      where: { id: orderId, customer_id: customerId },
      select: { id: true, status: true, delivered_at: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'order_not_found' });
    if (order.status !== 'delivered') return res.status(400).json({ success: false, message: 'only_delivered_orders' });
    if (!order.delivered_at) return res.status(400).json({ success: false, message: 'no_delivery_date' });

    const requestDeadline = addWorkingDays(order.delivered_at, 5);
    if (new Date() > requestDeadline) return res.status(400).json({ success: false, message: 'return_window_expired' });

    const existing = await prisma.order_returns.findFirst({
      where: { order_id: orderId, type: 'return', status: { notIn: ['expired'] } },
    });
    if (existing) return res.status(409).json({ success: false, message: 'return_already_exists', data: existing });

    let returnCode;
    for (let i = 0; i < 10; i++) {
      returnCode = generateReturnCode();
      const clash = await prisma.order_returns.findUnique({ where: { return_code: returnCode } });
      if (!clash) break;
    }

    const shippingDeadline = addWorkingDays(new Date(), 5);
    const ret = await prisma.order_returns.create({
      data: { order_id: orderId, type: 'return', status: 'requested', return_code: returnCode, deadline_at: shippingDeadline },
    });
    res.status(201).json({ success: true, data: ret });
  } catch (err) { next(err); }
}

// ─── Customer: get return for an order ───────────────────────────────────────
async function customerGetReturn(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const orderId = Number(req.params.id);

    const order = await prisma.orders.findFirst({ where: { id: orderId, customer_id: customerId }, select: { id: true } });
    if (!order) return res.status(404).json({ success: false, message: 'order_not_found' });

    let ret = await prisma.order_returns.findFirst({ where: { order_id: orderId }, orderBy: { requested_at: 'desc' } });
    ret = await autoExpire(ret);
    res.json({ success: true, data: ret });
  } catch (err) { next(err); }
}

// ─── Customer: upload shipping receipt ───────────────────────────────────────
async function customerUploadShipping(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const returnId = Number(req.params.id);
    const { carrier_name } = req.body;

    const { carrier_tracking } = req.body;
    if (!carrier_name || !carrier_name.trim())
      return res.status(400).json({ success: false, message: 'carrier_required' });
    if (!req.file)
      return res.status(400).json({ success: false, message: 'file_required' });

    const ret = await prisma.order_returns.findFirst({
      where: { id: returnId },
      include: { orders: { select: { customer_id: true } } },
    });
    if (!ret || ret.orders.customer_id !== customerId)
      return res.status(404).json({ success: false, message: 'return_not_found' });
    if (ret.status !== 'requested')
      return res.status(400).json({ success: false, message: 'invalid_status' });

    if (ret.deadline_at && new Date() > new Date(ret.deadline_at)) {
      await prisma.order_returns.update({ where: { id: returnId }, data: { status: 'expired', updated_at: new Date() } });
      return res.status(400).json({ success: false, message: 'return_expired' });
    }

    const { compressUploadedImage } = require('../middleware/upload');
    const shippingUrl = await compressUploadedImage(req);
    const updated = await prisma.order_returns.update({
      where: { id: returnId },
      data: { status: 'shipped', carrier_name: carrier_name.trim(), carrier_tracking: carrier_tracking ? carrier_tracking.trim() : null, shipping_receipt_url: shippingUrl, shipped_at: new Date(), updated_at: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ─── Customer: set refund IBAN ────────────────────────────────────────────────
async function customerSetRefundInfo(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const returnId = Number(req.params.id);
    const { refund_iban, refund_holder } = req.body;

    if (!refund_iban || !refund_holder)
      return res.status(400).json({ success: false, message: 'iban_and_holder_required' });

    const ret = await prisma.order_returns.findFirst({
      where: { id: returnId },
      include: { orders: { select: { customer_id: true } } },
    });
    if (!ret || ret.orders.customer_id !== customerId)
      return res.status(404).json({ success: false, message: 'return_not_found' });
    if (!['shipped', 'received'].includes(ret.status))
      return res.status(400).json({ success: false, message: 'invalid_status' });
    if (ret.refund_iban)
      return res.status(409).json({ success: false, message: 'iban_already_set' });

    const updated = await prisma.order_returns.update({
      where: { id: returnId },
      data: { refund_iban: refund_iban.trim(), refund_holder: refund_holder.trim(), updated_at: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ─── Customer: confirm refund received ───────────────────────────────────────
async function customerConfirmRefund(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const returnId = Number(req.params.id);

    const ret = await prisma.order_returns.findFirst({
      where: { id: returnId },
      include: { orders: { select: { customer_id: true } } },
    });
    if (!ret || ret.orders.customer_id !== customerId)
      return res.status(404).json({ success: false, message: 'return_not_found' });
    if (ret.status !== 'refund_sent')
      return res.status(400).json({ success: false, message: 'invalid_status' });

    const updated = await prisma.order_returns.update({
      where: { id: returnId },
      data: { status: 'completed', completed_at: new Date(), updated_at: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ─── Customer: report defective ───────────────────────────────────────────────
async function customerReportDefective(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const orderId = Number(req.params.id);
    const { defective_note } = req.body;

    if (!defective_note || !defective_note.trim())
      return res.status(400).json({ success: false, message: 'note_required' });

    const order = await prisma.orders.findFirst({
      where: { id: orderId, customer_id: customerId },
      select: { id: true, status: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'order_not_found' });
    if (order.status !== 'delivered') return res.status(400).json({ success: false, message: 'only_delivered_orders' });

    const existing = await prisma.order_returns.findFirst({ where: { order_id: orderId, type: 'defective' } });
    if (existing) return res.status(409).json({ success: false, message: 'defective_already_reported', data: existing });

    const ret = await prisma.order_returns.create({
      data: {
        order_id: orderId,
        type: 'defective',
        status: 'defective_reported',
        defective_note: defective_note.trim(),
        defective_photo_url: req.file ? await require('../middleware/upload').compressUploadedImage(req) : null,
      },
    });
    res.status(201).json({ success: true, data: ret });
  } catch (err) { next(err); }
}

// ─── Admin: list all returns ──────────────────────────────────────────────────
async function adminListReturns(req, res, next) {
  try {
    const now = new Date();
    await prisma.order_returns.updateMany({
      where: { status: 'requested', deadline_at: { lt: now } },
      data: { status: 'expired', updated_at: now },
    });

    const returns = await prisma.order_returns.findMany({
      include: {
        orders: {
          select: { id: true, total_amount: true, customers: { select: { id: true, full_name: true, mobile: true } } },
        },
      },
      orderBy: { requested_at: 'desc' },
    });
    res.json({ success: true, data: returns });
  } catch (err) { next(err); }
}

// ─── Admin: get return(s) for an order ───────────────────────────────────────
async function adminGetOrderReturn(req, res, next) {
  try {
    const orderId = Number(req.params.id);
    const now = new Date();
    await prisma.order_returns.updateMany({
      where: { order_id: orderId, status: 'requested', deadline_at: { lt: now } },
      data: { status: 'expired', updated_at: now },
    });
    const rets = await prisma.order_returns.findMany({
      where: { order_id: orderId },
      orderBy: { requested_at: 'desc' },
    });
    res.json({ success: true, data: rets });
  } catch (err) { next(err); }
}

// ─── Admin: mark received ─────────────────────────────────────────────────────
async function adminMarkReceived(req, res, next) {
  try {
    const returnId = Number(req.params.id);
    const ret = await prisma.order_returns.findUnique({ where: { id: returnId } });
    if (!ret) return res.status(404).json({ success: false, message: 'not_found' });
    if (ret.status !== 'shipped') return res.status(400).json({ success: false, message: 'invalid_status' });

    const updated = await prisma.order_returns.update({
      where: { id: returnId },
      data: { status: 'received', received_at: new Date(), updated_at: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ─── Admin: upload refund receipt ────────────────────────────────────────────
async function adminUploadRefundReceipt(req, res, next) {
  try {
    const returnId = Number(req.params.id);
    if (!req.file) return res.status(400).json({ success: false, message: 'file_required' });

    const ret = await prisma.order_returns.findUnique({ where: { id: returnId } });
    if (!ret) return res.status(404).json({ success: false, message: 'not_found' });
    if (ret.status !== 'received') return res.status(400).json({ success: false, message: 'invalid_status' });

    const { compressUploadedImage } = require('../middleware/upload');
    const refundUrl = await compressUploadedImage(req);
    const updated = await prisma.order_returns.update({
      where: { id: returnId },
      data: { status: 'refund_sent', refund_receipt_url: refundUrl, refund_sent_at: new Date(), updated_at: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ─── Admin: reject refund ────────────────────────────────────────────────────
async function adminRejectRefund(req, res, next) {
  try {
    const returnId = Number(req.params.id);
    const { rejection_reason, rejection_note } = req.body;

    if (!rejection_reason)
      return res.status(400).json({ success: false, message: 'rejection_reason_required' });

    const ret = await prisma.order_returns.findUnique({ where: { id: returnId } });
    if (!ret) return res.status(404).json({ success: false, message: 'not_found' });
    if (ret.status !== 'received')
      return res.status(400).json({ success: false, message: 'invalid_status' });

    const updated = await prisma.order_returns.update({
      where: { id: returnId },
      data: {
        status:               'refund_rejected',
        rejection_reason:     rejection_reason.trim(),
        rejection_note:       rejection_note ? rejection_note.trim() : null,
        rejection_photo_url:  req.file ? await require('../middleware/upload').compressUploadedImage(req) : null,
        rejected_at:          new Date(),
        updated_at:           new Date(),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

module.exports = {
  customerRequestReturn, customerGetReturn, customerUploadShipping,
  customerSetRefundInfo, customerConfirmRefund, customerReportDefective,
  adminListReturns, adminGetOrderReturn, adminMarkReceived, adminUploadRefundReceipt, adminRejectRefund,
};
