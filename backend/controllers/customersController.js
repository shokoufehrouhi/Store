const prisma   = require('../prisma/client');
const crypto   = require('crypto');
const bcrypt   = require('bcrypt');
const { sendRawEmail } = require('../utils/mailer');

const BCRYPT_ROUNDS = 12;

function isValidMobile(m) {
  return /^05[0-9]{9}$/.test((m || '').replace(/[\s\-]/g, ''));
}

function legacyHash(pass) {
  return Buffer.from(pass, 'utf8').toString('base64');
}

async function hashPassword(pass) {
  return bcrypt.hash(pass, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, stored) {
  // bcrypt hashes start with $2b$
  if (stored && stored.startsWith('$2b$')) {
    return bcrypt.compare(plain, stored);
  }
  // legacy base64
  return stored === legacyHash(plain);
}

async function register(req, res, next) {
  try {
    const { full_name, name, email, mobile, password, preferred_lang } = req.body;
    const customerName = full_name || name;
    if (!customerName || !password || (!email && !mobile)) {
      return res.status(400).json({ success: false, message: 'name, password and email or mobile are required' });
    }
    if (mobile && !isValidMobile(mobile)) {
      return res.status(400).json({ success: false, message: 'invalid_mobile' });
    }
    const existing = await prisma.customers.findFirst({
      where: { OR: [email ? { email } : {}, mobile ? { mobile } : {}] },
    });
    if (existing) return res.status(409).json({ success: false, message: 'Customer already exists' });

    const customer = await prisma.customers.create({
      data: { full_name: customerName, email: email || null, mobile: mobile || null,
              password_hash: await hashPassword(password), preferred_lang: preferred_lang || 'fa',
              registered_by: email ? 'e' : 'm' },
      select: { id: true, full_name: true, email: true, mobile: true, registered_by: true, preferred_lang: true, created_at: true },
    });

    const session = await prisma.sessions.create({
      data: {
        customer_id:   customer.id,
        expires_at:    new Date(Date.now() + 30 * 60 * 1000),
        last_activity: new Date(),
      },
    });

    res.status(201).json({ success: true, token: session.id, data: customer });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'identifier and password are required' });
    }
    const isEmail = identifier.includes('@');
    const customer = await prisma.customers.findFirst({
      where: isEmail ? { email: identifier } : { mobile: identifier },
    });
    if (!customer || !(await verifyPassword(password, customer.password_hash))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!customer.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }
    // auto-upgrade legacy base64 hash to bcrypt on successful login
    if (customer.password_hash && !customer.password_hash.startsWith('$2b$')) {
      const upgraded = await hashPassword(password);
      await prisma.customers.update({ where: { id: customer.id }, data: { password_hash: upgraded } });
    }

    // create session
    const session = await prisma.sessions.create({
      data: {
        customer_id:   customer.id,
        expires_at:    new Date(Date.now() + 30 * 60 * 1000),
        last_activity: new Date(),
      },
    });

    const addresses = await prisma.addresses.findMany({
      where: { customer_id: customer.id },
      select: { id: true, recipient: true, phone: true, city: true, postal_code: true, detail: true, is_default: true },
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
    });

    res.json({
      success: true,
      token: session.id,
      customer: {
        id: customer.id, full_name: customer.full_name, email: customer.email,
        mobile: customer.mobile, registered_by: customer.registered_by,
        preferred_lang: customer.preferred_lang,
        addresses,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const token = req.headers['x-session-token'];
    if (token) {
      await prisma.sessions.updateMany({
        where: { id: token },
        data:  { is_active: false },
      });
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

async function getProfile(req, res, next) {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ success: false, message: 'No session token' });

    const session = await prisma.sessions.findFirst({
      where: { id: token, is_active: true, expires_at: { gt: new Date() } },
    });
    if (!session) return res.status(401).json({ success: false, message: 'Session expired' });

    // refresh session
    await prisma.sessions.update({
      where: { id: token },
      data:  { last_activity: new Date(), expires_at: new Date(Date.now() + 30 * 60 * 1000) },
    });

    const customer = await prisma.customers.findUnique({
      where:  { id: session.customer_id },
      select: {
        id: true, full_name: true, email: true, mobile: true, registered_by: true,
        preferred_lang: true, created_at: true,
        addresses: { select: { id: true, recipient: true, phone: true, city: true, postal_code: true, detail: true, is_default: true } },
        customer_favorites: { select: { product_id: true } },
      },
    });
    const data = { ...customer, favorites: customer.customer_favorites.map(f => f.product_id) };
    delete data.customer_favorites;
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ success: false, message: 'No session token' });

    const session = await prisma.sessions.findFirst({
      where: { id: token, is_active: true, expires_at: { gt: new Date() } },
    });
    if (!session) return res.status(401).json({ success: false, message: 'Session expired' });

    const customer = await prisma.customers.findUnique({ where: { id: session.customer_id } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const { email, full_name } = req.body;
    const hasMobileKey = Object.prototype.hasOwnProperty.call(req.body, 'mobile');
    const mobileRaw = hasMobileKey ? (req.body.mobile || null) : undefined;

    if (!email && !hasMobileKey && !full_name) {
      return res.status(400).json({ success: false, message: 'email, mobile, or full_name is required' });
    }

    if (email && email !== customer.email) {
      const taken = await prisma.customers.findFirst({ where: { email, NOT: { id: customer.id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Email already in use' });
    }

    if (mobileRaw && mobileRaw !== customer.mobile) {
      if (!isValidMobile(mobileRaw)) return res.status(400).json({ success: false, message: 'invalid_mobile' });
      const taken = await prisma.customers.findFirst({ where: { mobile: mobileRaw, NOT: { id: customer.id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Mobile already in use' });
    }

    const dataUpdate = { updated_at: new Date() };
    if (full_name) dataUpdate.full_name = full_name;
    if (email) dataUpdate.email = email;
    if (mobileRaw) {
      dataUpdate.mobile = mobileRaw;
    } else if (hasMobileKey && mobileRaw === null && customer.registered_by !== 'm') {
      dataUpdate.mobile = null;
    }

    const updated = await prisma.customers.update({
      where: { id: customer.id },
      data: dataUpdate,
      select: { id: true, full_name: true, email: true, mobile: true, registered_by: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function resolveSession(req, res) {
  const token = req.headers['x-session-token'];
  if (!token || !UUID_RE.test(token)) { res.status(401).json({ success: false, message: 'No session token' }); return null; }
  const session = await prisma.sessions.findFirst({
    where: { id: token, is_active: true, expires_at: { gt: new Date() } },
    include: { customers: { select: { is_active: true } } },
  });
  if (!session) { res.status(401).json({ success: false, message: 'Session expired' }); return null; }
  if (!session.customers?.is_active) { res.status(403).json({ success: false, message: 'Account is deactivated' }); return null; }
  return session;
}

async function addAddress(req, res, next) {
  try {
    const session = await resolveSession(req, res); if (!session) return;
    const { recipient, phone, city, postal_code, detail } = req.body;
    if (!recipient || !phone || !city || !detail) {
      return res.status(400).json({ success: false, message: 'recipient, phone, city, detail are required' });
    }
    if (!isValidMobile(phone)) return res.status(400).json({ success: false, message: 'invalid_mobile' });
    const address = await prisma.addresses.create({
      data: { customer_id: session.customer_id, recipient, phone, city, postal_code: postal_code || null, detail },
    });
    res.status(201).json({ success: true, data: address });
  } catch (err) { next(err); }
}

async function updateAddress(req, res, next) {
  try {
    const session = await resolveSession(req, res); if (!session) return;
    const id = parseInt(req.params.id);
    const existing = await prisma.addresses.findFirst({ where: { id, customer_id: session.customer_id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Address not found' });
    const { recipient, phone, city, postal_code, detail, is_default } = req.body;
    if (phone && !isValidMobile(phone)) return res.status(400).json({ success: false, message: 'invalid_mobile' });
    if (is_default) {
      await prisma.$executeRaw`UPDATE addresses SET is_default = false WHERE customer_id = ${session.customer_id}`;
      await prisma.$executeRaw`UPDATE addresses SET is_default = true  WHERE id = ${id} AND customer_id = ${session.customer_id}`;
      const refreshed = await prisma.addresses.findUnique({ where: { id } });
      return res.json({ success: true, data: refreshed });
    }
    const updated = await prisma.addresses.update({
      where: { id },
      data: {
        ...(recipient   ? { recipient }            : {}),
        ...(phone       ? { phone }                : {}),
        ...(city        ? { city }                 : {}),
        ...(detail      ? { detail }               : {}),
        postal_code: postal_code !== undefined ? (postal_code || null) : existing.postal_code,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function deleteAddress(req, res, next) {
  try {
    const session = await resolveSession(req, res); if (!session) return;
    const id = parseInt(req.params.id);
    const existing = await prisma.addresses.findFirst({ where: { id, customer_id: session.customer_id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Address not found' });
    await prisma.addresses.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Forgot Password ──────────────────────────────────────────────────────────
const EMAIL_CONTENT = {
  fa: {
    subject: 'بازیابی رمز عبور — Shilista',
    dir:     'rtl',
    greeting: (name) => `کاربر گرامی ${name}،`,
    body:    'برای تغییر رمز عبور روی دکمه زیر کلیک کنید:',
    btn:     'تغییر رمز عبور',
    expire:  'این لینک ۱ ساعت اعتبار دارد.',
    ignore:  'اگر این درخواست را شما ارسال نکرده‌اید، این ایمیل را نادیده بگیرید.',
  },
  en: {
    subject: 'Password Reset — Shilista',
    dir:     'ltr',
    greeting: (name) => `Dear ${name},`,
    body:    'Click the button below to reset your password:',
    btn:     'Reset Password',
    expire:  'This link is valid for 1 hour.',
    ignore:  'If you did not request this, please ignore this email.',
  },
  tr: {
    subject: 'Şifre Sıfırlama — Shilista',
    dir:     'ltr',
    greeting: (name) => `Sayın ${name},`,
    body:    'Şifrenizi sıfırlamak için aşağıdaki düğmeye tıklayın:',
    btn:     'Şifreyi Sıfırla',
    expire:  'Bu bağlantı 1 saat geçerlidir.',
    ignore:  'Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın.',
  },
};

function buildResetEmail(lang, name, resetLink) {
  const c = EMAIL_CONTENT[lang] || EMAIL_CONTENT['fa'];
  return `<!DOCTYPE html>
<html dir="${c.dir}" lang="${lang}">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
      <tr>
        <td style="background:#fff;padding:24px 32px 16px;border-bottom:2px solid #f0e8df;text-align:center">
          ${process.env.SITE_URL
            ? `<img src="${process.env.SITE_URL}/images/shilista_6_light_full_transparent.png" alt="Shilista" height="48" style="height:48px;width:auto;display:inline-block">`
            : `<span style="font-size:26px;font-weight:700;color:#c0562a;letter-spacing:1px;font-family:Arial,sans-serif">Shilista</span>`}
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px" dir="${c.dir}">
          <p style="margin:0 0 12px;font-size:15px;color:#333">${c.greeting(name)}</p>
          <p style="margin:0 0 24px;font-size:14px;color:#555">${c.body}</p>
          <div style="text-align:center;margin-bottom:24px">
            <a href="${resetLink}" style="background:#c0562a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:bold;display:inline-block">${c.btn}</a>
          </div>
          <p style="margin:0 0 4px;font-size:12px;color:#888">${c.expire}</p>
          <p style="margin:0;font-size:11px;color:#aaa">${c.ignore}</p>
        </td>
      </tr>
      <tr>
        <td style="background:#fdf5ed;padding:16px 32px;border-top:1px solid #f0e8df;text-align:center">
          <p style="margin:0;font-size:12px;color:#aaa">shilista.com</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

async function forgotPassword(req, res, next) {
  try {
    const { identifier, lang } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: 'identifier is required' });

    const safeLang = ['fa', 'en', 'tr'].includes(lang) ? lang : 'fa';

    const isEmail = identifier.includes('@');
    const customer = await prisma.customers.findFirst({
      where: isEmail ? { email: identifier } : { mobile: identifier },
    });

    // always respond 200 to avoid user enumeration
    if (!customer) return res.json({ success: true, sent: false });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.customers.update({
      where: { id: customer.id },
      data:  { reset_token: token, reset_token_expires: expires },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
    const resetLink   = `${frontendUrl}/index.html#reset_token=${token}`;

    if (process.env.SMTP_HOST && customer.email) {
      const c = EMAIL_CONTENT[safeLang] || EMAIL_CONTENT['fa'];
      await sendRawEmail(customer.email, c.subject, buildResetEmail(safeLang, customer.full_name, resetLink));
      return res.json({ success: true, sent: true });
    }

    return res.json({ success: true, sent: false });
  } catch (err) {
    next(err);
  }
}

// ─── Reset Password ───────────────────────────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, message: 'token and password are required' });

    const customer = await prisma.customers.findFirst({
      where: {
        reset_token:         token,
        reset_token_expires: { gt: new Date() },
      },
    });
    if (!customer) return res.status(400).json({ success: false, message: 'Invalid or expired token' });

    await prisma.customers.update({
      where: { id: customer.id },
      data:  {
        password_hash:       await hashPassword(password),
        reset_token:         null,
        reset_token_expires: null,
        updated_at:          new Date(),
      },
    });

    // invalidate all existing sessions
    await prisma.sessions.updateMany({
      where: { customer_id: customer.id },
      data:  { is_active: false },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getFavorites(req, res, next) {
  try {
    const session = await resolveSession(req, res);
    if (!session) return;
    const rows = await prisma.customer_favorites.findMany({
      where: { customer_id: session.customer_id },
      select: { product_id: true },
    });
    res.json({ success: true, data: rows.map(r => r.product_id) });
  } catch (err) { next(err); }
}

async function addFavorite(req, res, next) {
  try {
    const session = await resolveSession(req, res);
    if (!session) return;
    const productId = parseInt(req.params.productId, 10);
    if (!productId) return res.status(400).json({ success: false, message: 'Invalid product' });
    await prisma.customer_favorites.upsert({
      where: { customer_id_product_id: { customer_id: session.customer_id, product_id: productId } },
      create: { customer_id: session.customer_id, product_id: productId },
      update: {},
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function removeFavorite(req, res, next) {
  try {
    const session = await resolveSession(req, res);
    if (!session) return;
    const productId = parseInt(req.params.productId, 10);
    if (!productId) return res.status(400).json({ success: false, message: 'Invalid product' });
    await prisma.customer_favorites.deleteMany({
      where: { customer_id: session.customer_id, product_id: productId },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function getCart(req, res, next) {
  try {
    const session = await resolveSession(req, res);
    if (!session) return;
    const rows = await prisma.cart_items.findMany({
      where: { customer_id: session.customer_id },
      select: { product_id: true, color_key: true, size_label: true, qty: true },
    });
    const data = rows.map(r => ({ id: r.product_id, colorKey: r.color_key || null, size: r.size_label || null, qty: r.qty }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

async function syncCart(req, res, next) {
  try {
    const session = await resolveSession(req, res);
    if (!session) return;
    const items = req.body.items;
    if (!Array.isArray(items)) return res.status(400).json({ success: false, message: 'items array required' });

    await prisma.$transaction(async (tx) => {
      await tx.cart_items.deleteMany({ where: { customer_id: session.customer_id } });
      if (items.length > 0) {
        await tx.cart_items.createMany({
          data: items.map(item => ({
            customer_id: session.customer_id,
            product_id:  Number(item.id),
            color_key:   item.colorKey  || null,
            size_label:  item.size      || null,
            qty:         Number(item.qty) || 1,
          })),
          skipDuplicates: true,
        });
      }
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { register, login, logout, getProfile, updateProfile, addAddress, updateAddress, deleteAddress, forgotPassword, resetPassword, getFavorites, addFavorite, removeFavorite, getCart, syncCart };
