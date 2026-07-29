require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const geoip        = require('geoip-lite');
const errorHandler = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://shilista.com',
  'https://shilista.com',
  'http://10.100.10.100',
  'https://10.100.10.100',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', require('express').static(require('path').join(__dirname, 'public/uploads')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, try again later' },
});
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, try again in 1 hour' },
});
const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false },
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/facebook-feed.csv', require('./controllers/productsController').getFacebookFeed);
app.use('/api/products',                   require('./routes/products'));
app.use('/api/customers/login',            authLimiter);
app.use('/api/customers/register',         authLimiter);
app.use('/api/customers/forgot-password',  forgotLimiter);
app.use('/api/customers',                  require('./routes/customers'));
app.use('/api/orders',                     require('./routes/orders'));
app.use('/api/payments',                   require('./routes/payments'));
app.use('/api/admin/login',                authLimiter);
app.use('/api/admin',                      require('./routes/admin'));

const cp = require('./controllers/couponsController');
app.get('/api/banners',           cp.getBanners);
app.get('/api/coupons/reward',    cp.getRewardCode);
app.post('/api/coupons/validate', cp.validateCoupon);

// ─── Public categories (no auth) ──────────────────────────────────────────────
app.get('/api/categories', async (req, res, next) => {
  try {
    const prisma = require('./prisma/client');
    const [cats, subs] = await Promise.all([
      prisma.categories.findMany({ where: { is_live: true }, select: { id: true, published_data: true } }),
      prisma.subcategories.findMany({ where: { is_live: true }, select: { id: true, published_data: true } }),
    ]);
    const data = cats
      .map(c => ({
        id: c.id,
        ...c.published_data,
        subcategories: subs
          .filter(s => s.published_data?.category_id === c.id)
          .map(s => ({ id: s.id, ...s.published_data }))
          .sort((a, b) => a.id - b.id),
      }))
      .sort((a, b) => a.id - b.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── Public bank accounts (no auth) ───────────────────────────────────────────
app.get('/api/bank-accounts', async (req, res, next) => {
  try {
    const prisma = require('./prisma/client');
    const accounts = await prisma.bank_accounts.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      select: { id: true, bank_name: true, account_holder: true, iban: true },
    });
    res.json({ success: true, data: accounts });
  } catch (err) { next(err); }
});

// ─── Site view tracking (public, no auth) ─────────────────────────────────────
app.post('/api/track-view', viewLimiter, async (req, res, next) => {
  try {
    const prisma = require('./prisma/client');
    const path = typeof req.body?.path === 'string' ? req.body.path.slice(0, 200) : null;
    const ip = (req.headers['x-real-ip'] || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

    if (ip) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const already = await prisma.site_views.findFirst({ where: { ip, created_at: { gte: startOfToday } } });
      if (already) return res.json({ success: true });
    }

    const geo = ip ? geoip.lookup(ip) : null;
    await prisma.site_views.create({
      data: { path, ip: ip || null, city: geo?.city || null, country: geo?.country || null },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Referral ─────────────────────────────────────────────────────────────────
const rf = require('./controllers/referralController');
app.post('/api/refer',              rf.submitReferral);
app.get('/api/refer/track/:token',  rf.trackOpen);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} — build: ${Date.now()}`);
});
