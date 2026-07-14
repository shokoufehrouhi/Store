const prisma = require('../prisma/client');

// date-only string (YYYY-MM-DD) → end of that day in local time (23:59:59)
// datetime string → parsed as-is
function parseDate(val, endOfDay = false) {
  if (!val) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val))
    return new Date(val + (endOfDay ? 'T23:59:59' : 'T00:00:00'));
  return new Date(val);
}

// ─── Admin: list all coupons ──────────────────────────────────────────────────
async function listCoupons(req, res, next) {
  try {
    // Auto-deactivate expired coupons
    await prisma.$executeRaw`
      UPDATE coupons SET is_active = false, updated_at = NOW()
      WHERE is_active = true AND expires_at IS NOT NULL AND expires_at < NOW()
    `;
    const coupons = await prisma.coupons.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        coupon_assignments: {
          include: { customers: { select: { id: true, full_name: true, email: true, mobile: true } } },
        },
      },
    });
    res.json({ success: true, data: coupons });
  } catch (err) { next(err); }
}

// ─── Admin: create coupon ─────────────────────────────────────────────────────
async function createCoupon(req, res, next) {
  try {
    const { code, type, value, for_all, max_uses, is_active, show_banner,
            banner_text_fa, banner_text_en, banner_text_tr, starts_at, expires_at, customer_ids } = req.body;

    if (!code || !type || value === undefined)
      return res.status(400).json({ success: false, message: 'code, type, value are required' });
    if (!['percent', 'fixed'].includes(type))
      return res.status(400).json({ success: false, message: 'type must be percent or fixed' });
    if (type === 'percent' && (Number(value) <= 0 || Number(value) > 100))
      return res.status(400).json({ success: false, message: 'percent value must be 1-100' });

    const coupon = await prisma.$transaction(async (tx) => {
      const c = await tx.coupons.create({
        data: {
          code:           code.trim().toUpperCase(),
          type,
          value:          Number(value),
          for_all:        for_all !== false,
          max_uses:       max_uses ? Number(max_uses) : null,
          is_active:      is_active !== false,
          show_banner:    !!show_banner,
          banner_text_fa: banner_text_fa || null,
          banner_text_en: banner_text_en || null,
          banner_text_tr: banner_text_tr || null,
          starts_at:  parseDate(starts_at,  false),
          expires_at: parseDate(expires_at, true),
        },
      });
      if (!for_all && Array.isArray(customer_ids) && customer_ids.length) {
        await tx.coupon_assignments.createMany({
          data: customer_ids.map((cid) => ({ coupon_id: c.id, customer_id: Number(cid) })),
          skipDuplicates: true,
        });
      }
      return c;
    });

    res.status(201).json({ success: true, data: coupon });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Code already exists' });
    next(err);
  }
}

// ─── Admin: update coupon ─────────────────────────────────────────────────────
async function updateCoupon(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { code, type, value, for_all, max_uses, is_active, show_banner,
            banner_text_fa, banner_text_en, banner_text_tr, starts_at, expires_at, customer_ids } = req.body;

    const coupon = await prisma.$transaction(async (tx) => {
      const c = await tx.coupons.update({
        where: { id },
        data: {
          ...(code      !== undefined && { code: code.trim().toUpperCase() }),
          ...(type      !== undefined && { type }),
          ...(value     !== undefined && { value: Number(value) }),
          ...(for_all   !== undefined && { for_all }),
          ...(max_uses  !== undefined && { max_uses: max_uses ? Number(max_uses) : null }),
          ...(is_active !== undefined && { is_active }),
          ...(show_banner !== undefined && { show_banner }),
          ...(banner_text_fa !== undefined && { banner_text_fa: banner_text_fa || null }),
          ...(banner_text_en !== undefined && { banner_text_en: banner_text_en || null }),
          ...(banner_text_tr !== undefined && { banner_text_tr: banner_text_tr || null }),
          ...(starts_at  !== undefined && { starts_at:  parseDate(starts_at,  false) }),
          ...(expires_at !== undefined && { expires_at: parseDate(expires_at, true)  }),
          updated_at: new Date(),
        },
      });
      // sync assignments
      if (for_all === false && Array.isArray(customer_ids)) {
        await tx.coupon_assignments.deleteMany({ where: { coupon_id: id } });
        if (customer_ids.length) {
          await tx.coupon_assignments.createMany({
            data: customer_ids.map((cid) => ({ coupon_id: id, customer_id: Number(cid) })),
            skipDuplicates: true,
          });
        }
      } else if (for_all === true) {
        await tx.coupon_assignments.deleteMany({ where: { coupon_id: id } });
      }
      return c;
    });

    res.json({ success: true, data: coupon });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Code already exists' });
    next(err);
  }
}

// ─── Admin: delete coupon ─────────────────────────────────────────────────────
async function deleteCoupon(req, res, next) {
  try {
    const coupon = await prisma.coupons.findUnique({ where: { id: Number(req.params.id) } });
    if (!coupon) return res.status(404).json({ success: false, message: 'not_found' });
    if (coupon.is_protected) return res.status(403).json({ success: false, message: 'protected_coupon' });
    await prisma.coupons.delete({ where: { id: coupon.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Public: get banner coupons ───────────────────────────────────────────────
async function getBanners(req, res, next) {
  try {
    const now = new Date();
    const banners = await prisma.coupons.findMany({
      where: {
        show_banner: true,
        is_active:   true,
        OR: [{ starts_at: null }, { starts_at: { lte: now } }],
        AND: [{ OR: [{ expires_at: null }, { expires_at: { gt: now } }] }],
      },
      select: {
        id: true, code: true, type: true, value: true,
        banner_text_fa: true, banner_text_en: true, banner_text_tr: true,
        starts_at: true, expires_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: banners });
  } catch (err) { next(err); }
}

// ─── Customer: validate coupon ────────────────────────────────────────────────
async function validateCoupon(req, res, next) {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ success: false, message: 'Login required' });

    const session = await prisma.sessions.findFirst({
      where: { id: token, is_active: true, expires_at: { gt: new Date() } },
    });
    if (!session) return res.status(401).json({ success: false, message: 'Session expired' });

    const { code, cart_total } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'code required' });

    const now = new Date();
    const upperCode = code.trim().toUpperCase();

    // First check if code exists at all (ignore active/date filters)
    const existing = await prisma.coupons.findFirst({
      where: { code: upperCode },
      include: { coupon_assignments: { where: { customer_id: session.customer_id } } },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'invalid_code' });

    // Code exists — check if customer already used it
    const prevUse = await prisma.orders.findFirst({
      where: { customer_id: session.customer_id, coupon_code: upperCode, status: { notIn: ['cancelled', 'rejected'] } },
      select: { id: true },
    });
    if (prevUse) return res.status(409).json({ success: false, message: 'already_used' });

    // Coupon inactive or limit reached — customer didn't use it, someone else exhausted it
    if (!existing.is_active || (existing.max_uses !== null && existing.used_count >= existing.max_uses))
      return res.status(410).json({ success: false, message: 'limit_reached' });

    // Date range check
    const coupon = await prisma.coupons.findFirst({
      where: {
        code:      upperCode,
        is_active: true,
        OR: [{ starts_at: null }, { starts_at: { lte: now } }],
        AND: [{ OR: [{ expires_at: null }, { expires_at: { gt: now } }] }],
      },
      include: {
        coupon_assignments: { where: { customer_id: session.customer_id } },
      },
    });
    if (!coupon) return res.status(404).json({ success: false, message: 'invalid_code' });

    // check customer eligibility
    if (!coupon.for_all && coupon.coupon_assignments.length === 0)
      return res.status(403).json({ success: false, message: 'not_eligible' });

    const total        = Number(cart_total) || 0;
    const discountAmt  = coupon.type === 'percent'
      ? Math.round(total * Number(coupon.value) / 100)
      : Math.min(Math.round(Number(coupon.value)), total);
    const finalAmount  = Math.max(0, total - discountAmt);

    res.json({
      success: true,
      data: {
        coupon_id:       coupon.id,
        code:            coupon.code,
        type:            coupon.type,
        value:           Number(coupon.value),
        discount_amount: discountAmt,
        final_amount:    finalAmount,
      },
    });
  } catch (err) { next(err); }
}

module.exports = { listCoupons, createCoupon, updateCoupon, deleteCoupon, getBanners, validateCoupon };
