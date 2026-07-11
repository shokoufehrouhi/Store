const prisma = require('../prisma/client');
const { sendReplyEmail } = require('../utils/mailer');

async function getCustomerFromSession(req, res) {
  const token = req.headers['x-session-token'];
  if (!token) { res.status(401).json({ success: false, message: 'Login required' }); return null; }
  const session = await prisma.sessions.findFirst({
    where: { id: token, is_active: true, expires_at: { gt: new Date() } },
  });
  if (!session) { res.status(401).json({ success: false, message: 'Session expired' }); return null; }
  return session.customer_id;
}

// ─── Customer: send message ───────────────────────────────────────────────────
async function customerSendMessage(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const orderId = Number(req.params.id);
    const { message } = req.body;
    if (!message || !message.trim())
      return res.status(400).json({ success: false, message: 'message required' });

    const order = await prisma.orders.findFirst({
      where: { id: orderId, customer_id: customerId },
      select: { id: true, status: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const msg = await prisma.order_messages.create({
      data: { order_id: orderId, sender: 'customer', message: message.trim(), order_status: order.status },
    });
    res.status(201).json({ success: true, data: msg });
  } catch (err) { next(err); }
}

// ─── Customer: get messages for an order ─────────────────────────────────────
async function customerGetMessages(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const orderId = Number(req.params.id);

    const order = await prisma.orders.findFirst({
      where: { id: orderId, customer_id: customerId },
      select: { id: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const messages = await prisma.order_messages.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: 'asc' },
    });
    res.json({ success: true, data: messages });
  } catch (err) { next(err); }
}

// ─── Admin: get messages for an order ────────────────────────────────────────
async function adminGetMessages(req, res, next) {
  try {
    const orderId = Number(req.params.id);
    const messages = await prisma.order_messages.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: 'asc' },
    });
    res.json({ success: true, data: messages });
  } catch (err) { next(err); }
}

// ─── Admin: reply to order ────────────────────────────────────────────────────
async function adminReply(req, res, next) {
  try {
    const orderId = Number(req.params.id);
    const { message } = req.body;
    if (!message || !message.trim())
      return res.status(400).json({ success: false, message: 'message required' });

    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { customers: { select: { id: true, full_name: true, email: true, preferred_lang: true } } },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const msg = await prisma.order_messages.create({
      data: { order_id: orderId, sender: 'admin', message: message.trim(), order_status: order.status },
    });

    if (order.customers && order.customers.email) {
      sendReplyEmail(order.customers, order, message.trim()).catch(() => {});
    }

    res.status(201).json({ success: true, data: msg });
  } catch (err) { next(err); }
}

// ─── Admin: count orders with unread customer messages ────────────────────────
async function adminUnreadCount(req, res, next) {
  try {
    const result = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT om.order_id)::int AS count
      FROM order_messages om
      WHERE om.sender = 'customer'
        AND NOT EXISTS (
          SELECT 1 FROM order_messages r
          WHERE r.order_id = om.order_id
            AND r.sender = 'admin'
            AND r.created_at > om.created_at
        )
    `;
    res.json({ success: true, data: { count: result[0]?.count || 0 } });
  } catch (err) { next(err); }
}

module.exports = { customerSendMessage, customerGetMessages, adminGetMessages, adminReply, adminUnreadCount };
