require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
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

// ─── Routes ───────────────────────────────────────────────────────────────────
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
app.post('/api/coupons/validate', cp.validateCoupon);

// ─── Public categories (no auth) ──────────────────────────────────────────────
app.get('/api/categories', async (req, res, next) => {
  try {
    const prisma = require('./prisma/client');
    const cats = await prisma.categories.findMany({
      include: { subcategories: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    res.json({ success: true, data: cats });
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

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} — build: ${Date.now()}`);
});
