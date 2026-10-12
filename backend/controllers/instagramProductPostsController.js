const prisma = require('../prisma/client');

// GET /api/admin/instagram-product-posts
async function listProductPosts(req, res, next) {
  try {
    const rows = await prisma.instagram_product_posts.findMany({
      orderBy: { created_at: 'desc' },
      take: 300,
      include: {
        products: { select: { id: true, code: true, name_fa: true, name_en: true, brand: true, product_media: { take: 1 } } },
      },
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// POST /api/admin/instagram-product-posts  { code }
// Manually queues one product (by its product code) for a feed post -- it
// joins the end of the same queue the imports fill, so the scheduler's
// drip-feed (scheduler.js#maybePostQueuedProduct) posts it with all its
// usual limits; like any queued row, it's skipped if still unposted at
// midnight. Accepts the full code or just its number ("123" -> SHIL00000123).
async function addProductPost(req, res, next) {
  try {
    let code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: 'code_required' });
    if (/^\d+$/.test(code)) code = 'SHIL' + code.padStart(8, '0');

    const product = await prisma.products.findUnique({
      where: { code },
      select: { id: true, is_active: true, is_live: true, _count: { select: { product_media: true } } },
    });
    if (!product) return res.status(404).json({ success: false, message: 'not_found' });
    // The scheduler only ever picks queued rows whose product is active and
    // live -- anything else would sit in the queue until skipped at midnight.
    if (!product.is_active || !product.is_live) return res.status(409).json({ success: false, message: 'not_live' });
    if (!product._count.product_media) return res.status(409).json({ success: false, message: 'no_image' });

    const pending = await prisma.instagram_product_posts.count({
      where: { product_id: product.id, status: { in: ['queued', 'posting'] } },
    });
    if (pending) return res.status(409).json({ success: false, message: 'already_queued' });

    const row = await prisma.instagram_product_posts.create({ data: { product_id: product.id } });
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
}

module.exports = { listProductPosts, addProductPost };
