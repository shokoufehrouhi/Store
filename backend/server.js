require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const errorHandler = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', require('express').static(require('path').join(__dirname, 'public/uploads')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/products',  require('./routes/products'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/payments',  require('./routes/payments'));
app.use('/api/admin',     require('./routes/admin'));

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

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} — build: ${Date.now()}`);
});
