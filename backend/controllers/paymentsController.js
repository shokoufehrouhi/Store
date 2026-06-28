const prisma = require('../prisma/client');

async function getByOrder(req, res, next) {
  try {
    const payments = await prisma.payments.findMany({
      where: { order_id: Number(req.params.orderId) },
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: payments });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { order_id, method, amount, transaction_ref } = req.body;
    if (!order_id || !method || !amount) {
      return res.status(400).json({ success: false, message: 'order_id, method and amount are required' });
    }
    const payment = await prisma.payments.create({
      data: { order_id, method, amount, transaction_ref: transaction_ref || null },
    });
    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { status, transaction_ref } = req.body;
    const data = { status };
    if (status === 'paid') data.paid_at = new Date();
    if (transaction_ref) data.transaction_ref = transaction_ref;

    const payment = await prisma.payments.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
}

module.exports = { getByOrder, create, updateStatus };
