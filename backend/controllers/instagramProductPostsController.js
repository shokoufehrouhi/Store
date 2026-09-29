const prisma = require('../prisma/client');

// GET /api/admin/instagram-product-posts
async function listProductPosts(req, res, next) {
  try {
    const rows = await prisma.instagram_product_posts.findMany({
      orderBy: { created_at: 'desc' },
      take: 300,
      include: {
        products: { select: { id: true, name_fa: true, name_en: true, brand: true, product_media: { take: 1 } } },
      },
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

module.exports = { listProductPosts };
