const crypto = require('crypto');
const prisma  = require('../prisma/client');

const SECRET = process.env.REFERRAL_SECRET || 'shilista-referral-secret-2024';

function signReferralToken(customerId, orderId) {
  const payload = `${customerId}:${orderId}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

function verifyReferralToken(token) {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;
    const payload = Buffer.from(payloadB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 16);
    if (sig !== expectedSig) return null;
    const parts = payload.split(':').map(Number);
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return { customerId: parts[0], orderId: parts[1] };
  } catch { return null; }
}

// POST /api/refer
async function submitReferral(req, res, next) {
  try {
    const { token, name, email, phone } = req.body;
    if (!token || !email) {
      return res.status(400).json({ success: false, message: 'token_and_email_required' });
    }

    const decoded = verifyReferralToken(token);
    if (!decoded) return res.status(400).json({ success: false, message: 'invalid_token' });

    const emailLc = email.trim().toLowerCase();

    const existing = await prisma.leads.findFirst({ where: { email: emailLc } });
    if (existing) return res.json({ success: true, already: true });

    const trackingToken = crypto.randomBytes(32).toString('hex');

    await prisma.leads.create({
      data: {
        name:                    name?.trim() || null,
        email:                   emailLc,
        phone:                   phone?.trim() || null,
        referred_by_customer_id: decoded.customerId,
        referred_by_order_id:    decoded.orderId,
        tracking_token:          trackingToken,
        status:                  'pending',
      },
    });

    const referrer = await prisma.customers.findUnique({
      where:  { id: decoded.customerId },
      select: { full_name: true, preferred_lang: true },
    });

    const coupon = await prisma.coupons.findUnique({
      where:  { code: 'BESTIE' },
      select: { value: true, type: true },
    });

    const { sendFriendInviteEmail } = require('../utils/mailer');
    await sendFriendInviteEmail({
      toName:        name?.trim() || '',
      toEmail:       emailLc,
      referrerName:  referrer?.full_name || '',
      lang:          'tr',
      trackingToken,
      couponValue:   coupon?.value   || 5,
      couponType:    coupon?.type    || 'percent',
    });

    await prisma.leads.updateMany({
      where: { email: emailLc },
      data:  { status: 'email_sent' },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
}

// GET /api/refer/track/:token  — 1×1 tracking pixel
async function trackOpen(req, res) {
  prisma.leads.updateMany({
    where: { tracking_token: req.params.token, status: 'email_sent' },
    data:  { status: 'email_opened' },
  }).catch(() => {});

  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, {
    'Content-Type':  'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma':        'no-cache',
  });
  res.end(pixel);
}

// GET /api/admin/leads
async function adminListLeads(req, res, next) {
  try {
    const leads = await prisma.leads.findMany({
      where: { status: { not: 'registered' } },
      orderBy: { created_at: 'desc' },
      include: {
        customers: { select: { id: true, full_name: true, email: true } },
      },
    });
    res.json({ success: true, data: leads });
  } catch (err) { next(err); }
}

module.exports = { submitReferral, trackOpen, adminListLeads, signReferralToken };
