const prisma = require('../prisma/client');

async function getAll(req, res, next) {
  try {
    const orders = await prisma.orders.findMany({
      include: {
        customers:   { select: { id: true, full_name: true, mobile: true, email: true } },
        addresses:   true,
        order_items: { include: { products: true, colors: true } },
        payments:    true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const order = await prisma.orders.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        customers:   { select: { id: true, full_name: true, mobile: true, email: true } },
        addresses:   true,
        order_items: { include: { products: true, colors: true } },
        payments:    true,
      },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { customer_id, address_id, channel, note, items } = req.body;
    if (!customer_id || !items || !items.length) {
      return res.status(400).json({ success: false, message: 'customer_id and items are required' });
    }

    const total = items.reduce((sum, i) => sum + (i.unit_price * i.qty), 0);

    const order = await prisma.orders.create({
      data: {
        customer_id,
        address_id: address_id || null,
        channel:    channel || 'whatsapp',
        note:       note || null,
        total_amount: total,
        order_items: {
          create: items.map(i => ({
            product_id: i.product_id,
            color_id:   i.color_id   || null,
            size_label: i.size_label || null,
            qty:        i.qty,
            unit_price: i.unit_price,
          })),
        },
      },
      include: { order_items: true },
    });
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { status } = req.body;
    const order = await prisma.orders.update({
      where: { id: Number(req.params.id) },
      data:  { status },
    });
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, updateStatus };
