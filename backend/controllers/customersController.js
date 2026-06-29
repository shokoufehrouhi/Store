const prisma   = require('../prisma/client');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');

// matches frontend: btoa(unescape(encodeURIComponent(pwd)))
function hashPassword(pass) {
  return Buffer.from(pass, 'utf8').toString('base64');
}

async function register(req, res, next) {
  try {
    const { full_name, name, email, mobile, password, preferred_lang } = req.body;
    const customerName = full_name || name;
    if (!customerName || !password || (!email && !mobile)) {
      return res.status(400).json({ success: false, message: 'name, password and email or mobile are required' });
    }
    const existing = await prisma.customers.findFirst({
      where: { OR: [email ? { email } : {}, mobile ? { mobile } : {}] },
    });
    if (existing) return res.status(409).json({ success: false, message: 'Customer already exists' });

    const customer = await prisma.customers.create({
      data: { full_name: customerName, email: email || null, mobile: mobile || null,
              password_hash: hashPassword(password), preferred_lang: preferred_lang || 'fa',
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
    if (!customer || customer.password_hash !== hashPassword(password)) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // create session
    const session = await prisma.sessions.create({
      data: {
        customer_id:   customer.id,
        expires_at:    new Date(Date.now() + 30 * 60 * 1000),
        last_activity: new Date(),
      },
    });

    res.json({
      success: true,
      token: session.id,
      customer: { id: customer.id, full_name: customer.full_name, email: customer.email, mobile: customer.mobile, registered_by: customer.registered_by },
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
      },
    });
    res.json({ success: true, data: customer });
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

    const { email, mobile, full_name } = req.body;

    if (!email && !mobile && !full_name) {
      return res.status(400).json({ success: false, message: 'email, mobile, or full_name is required' });
    }

    if (email && email !== customer.email) {
      const taken = await prisma.customers.findFirst({ where: { email, NOT: { id: customer.id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Email already in use' });
    }

    if (mobile && mobile !== customer.mobile) {
      const taken = await prisma.customers.findFirst({ where: { mobile, NOT: { id: customer.id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Mobile already in use' });
    }

    const updated = await prisma.customers.update({
      where: { id: customer.id },
      data: {
        ...(full_name ? { full_name } : {}),
        ...(email     ? { email }     : {}),
        ...(mobile    ? { mobile }    : {}),
        updated_at: new Date(),
      },
      select: { id: true, full_name: true, email: true, mobile: true, registered_by: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function resolveSession(req, res) {
  const token = req.headers['x-session-token'];
  if (!token) { res.status(401).json({ success: false, message: 'No session token' }); return null; }
  const session = await prisma.sessions.findFirst({
    where: { id: token, is_active: true, expires_at: { gt: new Date() } },
  });
  if (!session) { res.status(401).json({ success: false, message: 'Session expired' }); return null; }
  return session;
}

async function addAddress(req, res, next) {
  try {
    const session = await resolveSession(req, res); if (!session) return;
    const { recipient, phone, city, postal_code, detail } = req.body;
    if (!recipient || !phone || !city || !detail) {
      return res.status(400).json({ success: false, message: 'recipient, phone, city, detail are required' });
    }
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
    subject: 'بازیابی رمز عبور — Akhgar Store',
    dir:     'rtl',
    greeting: (name) => `کاربر گرامی ${name}،`,
    body:    'برای تغییر رمز عبور روی دکمه زیر کلیک کنید:',
    btn:     'تغییر رمز عبور',
    expire:  'این لینک ۱ ساعت اعتبار دارد.',
    ignore:  'اگر این درخواست را شما ارسال نکرده‌اید، این ایمیل را نادیده بگیرید.',
  },
  en: {
    subject: 'Password Reset — Akhgar Store',
    dir:     'ltr',
    greeting: (name) => `Dear ${name},`,
    body:    'Click the button below to reset your password:',
    btn:     'Reset Password',
    expire:  'This link is valid for 1 hour.',
    ignore:  'If you did not request this, please ignore this email.',
  },
  tr: {
    subject: 'Şifre Sıfırlama — Akhgar Store',
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
  return `
  <div dir="${c.dir}" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;max-width:500px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:10px">
    <div style="background:#111;padding:16px;border-radius:8px;text-align:center;margin-bottom:24px">
      <span style="color:#FF5C00;font-size:22px;font-weight:bold">Akhgar Store</span>
    </div>
    <p style="color:#333;margin-bottom:8px">${c.greeting(name)}</p>
    <p style="color:#333;margin-bottom:24px">${c.body}</p>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${resetLink}" style="background:#FF5C00;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:bold;display:inline-block">${c.btn}</a>
    </div>
    <p style="color:#888;font-size:12px;margin-bottom:4px">${c.expire}</p>
    <p style="color:#aaa;font-size:11px">${c.ignore}</p>
  </div>`;
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
    const resetLink   = `${frontendUrl}/index.html?reset_token=${token}`;

    if (process.env.SMTP_HOST && customer.email) {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      const c = EMAIL_CONTENT[safeLang] || EMAIL_CONTENT['fa'];
      await transporter.sendMail({
        from:    process.env.SMTP_FROM || process.env.SMTP_USER,
        to:      customer.email,
        subject: c.subject,
        html:    buildResetEmail(safeLang, customer.full_name, resetLink),
      });
      return res.json({ success: true, sent: true });
    }

    // no SMTP — return link for admin to share manually
    return res.json({ success: true, sent: false, reset_link: resetLink });
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
        password_hash:       hashPassword(password),
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

module.exports = { register, login, logout, getProfile, updateProfile, addAddress, updateAddress, deleteAddress, forgotPassword, resetPassword };
