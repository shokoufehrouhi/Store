const prisma = require('../prisma/client');

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

module.exports = { register, login, logout, getProfile, updateProfile, addAddress, updateAddress, deleteAddress };
