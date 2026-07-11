const prisma = require('../prisma/client');
const fs     = require('fs');
const path   = require('path');

async function getCustomerFromSession(req, res) {
  const token = req.headers['x-session-token'];
  if (!token) { res.status(401).json({ success: false, message: 'Session expired' }); return null; }
  const session = await prisma.sessions.findFirst({
    where: { id: token, is_active: true, expires_at: { gt: new Date() } },
  });
  if (!session) { res.status(401).json({ success: false, message: 'Session expired' }); return null; }
  return session.customer_id;
}

// GET /api/products/:id/customer-photos  — public
async function getProductPhotos(req, res, next) {
  try {
    const productId = Number(req.params.id);
    const photos = await prisma.customer_product_photos.findMany({
      where:   { product_id: productId, is_approved: true },
      orderBy: { created_at: 'desc' },
      select:  { id: true, photo_url: true, created_at: true,
                 customers: { select: { full_name: true } } },
    });
    res.json({ success: true, data: photos });
  } catch (err) { next(err); }
}

// POST /api/orders/:id/product-photos  — customer upload
async function uploadProductPhoto(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    if (!req.file) return res.status(400).json({ success: false, message: 'file_required' });

    const orderId = Number(req.params.id);
    const { product_id } = req.body;
    if (!product_id) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'product_id_required' });
    }

    // verify order belongs to customer, is delivered, and contains this product
    const order = await prisma.orders.findFirst({
      where:   { id: orderId, customer_id: customerId, status: 'delivered' },
      include: { order_items: { where: { product_id: Number(product_id) } } },
    });
    if (!order || !order.order_items.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ success: false, message: 'not_eligible' });
    }

    // one photo per customer per product per order
    const existing = await prisma.customer_product_photos.findFirst({
      where: { customer_id: customerId, product_id: Number(product_id), order_id: orderId },
    });
    if (existing) {
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({ success: false, message: 'already_uploaded' });
    }

    const photo = await prisma.customer_product_photos.create({
      data: {
        product_id:  Number(product_id),
        customer_id: customerId,
        order_id:    orderId,
        photo_url:   '/uploads/' + req.file.filename,
      },
    });
    res.status(201).json({ success: true, data: photo });
  } catch (err) { next(err); }
}

// DELETE /api/orders/product-photos/:photoId  — customer delete own photo
async function deleteMyPhoto(req, res, next) {
  try {
    const customerId = await getCustomerFromSession(req, res);
    if (!customerId) return;
    const photo = await prisma.customer_product_photos.findFirst({
      where: { id: Number(req.params.photoId), customer_id: customerId },
    });
    if (!photo) return res.status(404).json({ success: false, message: 'not_found' });
    if (photo.photo_url) {
      const filePath = path.join(__dirname, '../public', photo.photo_url);
      fs.unlink(filePath, () => {});
    }
    await prisma.customer_product_photos.delete({ where: { id: photo.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// GET /api/admin/product-photos  — admin list all
async function adminListPhotos(req, res, next) {
  try {
    const photos = await prisma.customer_product_photos.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        customers: { select: { id: true, full_name: true } },
        products:  { select: { id: true, name_fa: true, code: true } },
      },
    });
    res.json({ success: true, data: photos });
  } catch (err) { next(err); }
}

// PATCH /api/admin/product-photos/:id  — toggle approval
async function adminToggleApproval(req, res, next) {
  try {
    const photo = await prisma.customer_product_photos.update({
      where: { id: Number(req.params.id) },
      data:  { is_approved: req.body.is_approved },
    });
    res.json({ success: true, data: photo });
  } catch (err) { next(err); }
}

// DELETE /api/admin/product-photos/:id
async function adminDeletePhoto(req, res, next) {
  try {
    const photo = await prisma.customer_product_photos.findUnique({ where: { id: Number(req.params.id) } });
    if (!photo) return res.status(404).json({ success: false, message: 'not_found' });
    if (photo.photo_url) {
      const filePath = path.join(__dirname, '../public', photo.photo_url);
      fs.unlink(filePath, () => {});
    }
    await prisma.customer_product_photos.delete({ where: { id: photo.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { getProductPhotos, uploadProductPhoto, deleteMyPhoto, adminListPhotos, adminToggleApproval, adminDeletePhoto };
