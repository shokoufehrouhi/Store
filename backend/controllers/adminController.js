const prisma  = require('../prisma/client');
const path    = require('path');
const fs      = require('fs');
const util    = require('util');
const { execFile } = require('child_process');
const execFileAsync = util.promisify(execFile);
const { sendOrderEmail, sendLoyaltyEmail, sendPrizeEarnedEmail, label } = require('../utils/mailer');

// ─── Communications ────────────────────────────────────────────────────────────

async function getCommunications(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 30;
    const skip  = (page - 1) * limit;
    const type  = req.query.type || undefined;

    const where = type ? { type } : {};
    const [total, logs] = await Promise.all([
      prisma.email_logs.count({ where }),
      prisma.email_logs.findMany({
        where,
        orderBy: { sent_at: 'desc' },
        skip,
        take: limit,
        include: { customers: { select: { id: true, full_name: true, mobile: true } } },
      }),
    ]);

    res.json({
      success: true,
      data: logs.map(l => ({
        id:          l.id,
        to:          l.to,
        type:        l.type,
        subject:     l.subject,
        customer_id: l.customer_id,
        customer:    l.customers?.full_name || l.customers?.mobile || null,
        order_id:    l.order_id,
        sent_at:     l.sent_at,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
}

async function getCommunicationBody(req, res, next) {
  try {
    const log = await prisma.email_logs.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!log) return res.status(404).json({ success: false });
    res.json({ success: true, data: { html_body: log.html_body, subject: log.subject, to: log.to, sent_at: log.sent_at } });
  } catch (err) { next(err); }
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function getNotifications(req, res, next) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [orders, prizes, returns, customers, leads] = await Promise.all([
      prisma.orders.findMany({
        where: { updated_at: { gte: since }, is_prize: false },
        orderBy: { updated_at: 'desc' },
        take: 30,
        include: { customers: { select: { full_name: true, mobile: true } } },
      }),
      prisma.orders.findMany({
        where: { updated_at: { gte: since }, is_prize: true },
        orderBy: { updated_at: 'desc' },
        take: 20,
        include: { customers: { select: { full_name: true, mobile: true } } },
      }),
      prisma.order_returns.findMany({
        where: { updated_at: { gte: since } },
        orderBy: { updated_at: 'desc' },
        take: 20,
        include: { orders: { include: { customers: { select: { full_name: true } } } } },
      }),
      prisma.customers.findMany({
        where: { created_at: { gte: since } },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: { id: true, full_name: true, mobile: true, email: true, created_at: true },
      }),
      prisma.leads.findMany({
        where: { created_at: { gte: since } },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: { id: true, name: true, email: true, phone: true, status: true, created_at: true },
      }),
    ]);

    const notifications = [];

    const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'rejected']);
    for (const o of orders) {
      const diffMs = Math.abs(new Date(o.updated_at) - new Date(o.created_at));
      const isNew = diffMs < 10000;
      notifications.push({
        type: isNew ? 'new_order' : 'order_update',
        id: o.id,
        customer: o.customers?.full_name || o.customers?.mobile || '—',
        status: o.status,
        amount: Number(o.total_amount),
        timestamp: isNew ? o.created_at : o.updated_at,
        tab: TERMINAL_STATUSES.has(o.status) ? 'orders' : 'active-orders',
        action_id: o.id,
      });
    }

    for (const o of prizes) {
      const diffMs = Math.abs(new Date(o.updated_at) - new Date(o.created_at));
      const isNew = diffMs < 10000;
      notifications.push({
        type: isNew ? 'new_prize' : 'prize_update',
        id: o.id,
        customer: o.customers?.full_name || o.customers?.mobile || '—',
        status: o.status,
        timestamp: isNew ? o.created_at : o.updated_at,
        tab: 'prizes',
        action_id: o.id,
      });
    }

    for (const r of returns) {
      const diffMs = Math.abs(new Date(r.updated_at) - new Date(r.requested_at));
      const isNew = diffMs < 10000;
      notifications.push({
        type: isNew ? 'new_return' : 'return_update',
        id: r.id,
        order_id: r.order_id,
        customer: r.orders?.customers?.full_name || '—',
        status: r.status,
        timestamp: r.updated_at,
        tab: 'returns',
        action_id: r.id,
      });
    }

    for (const c of customers) {
      notifications.push({
        type: 'new_customer',
        id: c.id,
        customer: c.full_name || c.mobile || c.email || '—',
        timestamp: c.created_at,
        tab: 'customers',
        action_id: c.id,
      });
    }

    for (const l of leads) {
      notifications.push({
        type: 'new_lead',
        id: l.id,
        customer: l.name || l.email || '—',
        status: l.status,
        timestamp: l.created_at,
        tab: 'leads',
        action_id: l.id,
      });
    }

    notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ success: true, data: notifications.slice(0, 50) });
  } catch (err) { next(err); }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function getDashboard(req, res, next) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalCustomers,
      newCustomersMonth,
      totalLeads,
      newLeadsMonth,
      totalReturns,
      pendingReturns,
      activeOrders,
      completedOrders,
      totalOrders,
      revenueAll,
      revenueMonth,
      revenueToday,
      ordersToday,
      topProducts,
      recentOrders,
      totalViews,
      viewsToday,
      viewsMonth,
    ] = await Promise.all([
      prisma.customers.count(),
      prisma.customers.count({ where: { created_at: { gte: startOfMonth } } }),
      prisma.leads.count(),
      prisma.leads.count({ where: { created_at: { gte: startOfMonth } } }),
      prisma.order_returns.count(),
      prisma.order_returns.count({ where: { status: { in: ['requested', 'approved'] } } }),
      prisma.orders.count({ where: { status: { in: ['link_requested','price_quoted','preorder','payment_needed','approval_needed','preparing','delivery'] } } }),
      prisma.orders.count({ where: { status: 'delivered' } }),
      prisma.orders.count({ where: { status: { not: 'cancelled' } } }),
      prisma.orders.aggregate({ where: { status: 'delivered' }, _sum: { total_amount: true } }),
      prisma.orders.aggregate({ where: { status: 'delivered', created_at: { gte: startOfMonth } }, _sum: { total_amount: true } }),
      prisma.orders.aggregate({ where: { status: 'delivered', created_at: { gte: startOfToday } }, _sum: { total_amount: true } }),
      prisma.orders.count({ where: { created_at: { gte: startOfToday } } }),
      prisma.$queryRaw`
        SELECT oi.product_id, SUM(oi.qty)::int AS total_qty,
               p.name_fa, p.name_en, p.name_tr, p.code
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.status = 'delivered'
        GROUP BY oi.product_id, p.name_fa, p.name_en, p.name_tr, p.code
        ORDER BY total_qty DESC LIMIT 5`,
      prisma.orders.findMany({
        where: { status: { not: 'cancelled' } },
        orderBy: { created_at: 'desc' },
        take: 5,
        include: { customers: { select: { full_name: true } } },
      }),
      prisma.site_views.count(),
      prisma.site_views.count({ where: { created_at: { gte: startOfToday } } }),
      prisma.site_views.count({ where: { created_at: { gte: startOfMonth } } }),
    ]);

    res.json({
      success: true,
      data: {
        customers: { total: totalCustomers, newThisMonth: newCustomersMonth },
        leads:     { total: totalLeads,     newThisMonth: newLeadsMonth },
        returns:   { total: totalReturns,   pending: pendingReturns },
        orders:    { active: activeOrders,  completed: completedOrders, total: totalOrders, today: ordersToday },
        revenue:   {
          total:      Number(revenueAll._sum.total_amount   || 0),
          thisMonth:  Number(revenueMonth._sum.total_amount || 0),
          today:      Number(revenueToday._sum.total_amount || 0),
        },
        siteViews: { total: totalViews, today: viewsToday, thisMonth: viewsMonth },
        topProducts: topProducts.map(r => ({ product_id: r.product_id, qty: Number(r.total_qty), name_fa: r.name_fa, name_en: r.name_en, code: r.code })),
        recentOrders: recentOrders.map(o => ({ id: o.id, customer: o.customers?.full_name, status: o.status, amount: Number(o.total_amount), created_at: o.created_at })),
      },
    });
  } catch (err) { next(err); }
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function login(req, res) {
  const { username, password } = req.body;
  if (username.toLowerCase() === process.env.ADMIN_USER.toLowerCase() && password === process.env.ADMIN_PASS) {
    return res.json({ success: true, token: process.env.ADMIN_TOKEN });
  }
  return res.status(401).json({ success: false, message: 'Invalid username or password' });
}

// ─── Categories ────────────────────────────────────────────────────────────────

async function getCategories(req, res, next) {
  try {
    const cats = await prisma.categories.findMany({
      include: { subcategories: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
}

async function createCategory(req, res, next) {
  try {
    const { key, label_fa, label_en, label_tr } = req.body;
    const cat = await prisma.categories.create({
      data: { key, label_fa, label_en: label_en || label_fa, label_tr: label_tr || label_fa },
    });
    res.status(201).json({ success: true, data: cat });
  } catch (err) { next(err); }
}

async function updateCategory(req, res, next) {
  try {
    const { key, label_fa, label_en, label_tr } = req.body;
    const cat = await prisma.categories.update({
      where: { id: Number(req.params.id) },
      data: { key, label_fa, label_en: label_en || label_fa, label_tr: label_tr || label_fa, is_dirty: true },
    });
    res.json({ success: true, data: cat });
  } catch (err) { next(err); }
}

async function toggleCategory(req, res, next) {
  try {
    const id = Number(req.params.id);
    const cur = await prisma.categories.findUnique({ where: { id }, select: { is_active: true } });
    if (!cur) return res.status(404).json({ success: false });
    const cat = await prisma.categories.update({ where: { id }, data: { is_active: !cur.is_active, is_dirty: true } });
    res.json({ success: true, data: cat });
  } catch (err) { next(err); }
}

async function deleteCategory(req, res, next) {
  try {
    await prisma.categories.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Subcategories ─────────────────────────────────────────────────────────────

async function getSubcategories(req, res, next) {
  try {
    const subs = await prisma.subcategories.findMany({
      include: { categories: { select: { id: true, key: true, label_fa: true } } },
      orderBy: { id: 'asc' },
    });
    res.json({ success: true, data: subs });
  } catch (err) { next(err); }
}

async function createSubcategory(req, res, next) {
  try {
    const { category_id, key, label_fa, label_en, label_tr } = req.body;
    const sub = await prisma.subcategories.create({
      data: {
        category_id: Number(category_id),
        key,
        label_fa,
        label_en: label_en || label_fa,
        label_tr: label_tr || label_fa,
      },
    });
    res.status(201).json({ success: true, data: sub });
  } catch (err) { next(err); }
}

async function updateSubcategory(req, res, next) {
  try {
    const { category_id, key, label_fa, label_en, label_tr } = req.body;
    const sub = await prisma.subcategories.update({
      where: { id: Number(req.params.id) },
      data: {
        category_id: Number(category_id),
        key,
        label_fa,
        label_en: label_en || label_fa,
        label_tr: label_tr || label_fa,
        is_dirty: true,
      },
    });
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
}

async function toggleSubcategory(req, res, next) {
  try {
    const id = Number(req.params.id);
    const cur = await prisma.subcategories.findUnique({ where: { id }, select: { is_active: true } });
    if (!cur) return res.status(404).json({ success: false });
    const sub = await prisma.subcategories.update({ where: { id }, data: { is_active: !cur.is_active, is_dirty: true } });
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
}

async function deleteSubcategory(req, res, next) {
  try {
    await prisma.subcategories.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Colors ────────────────────────────────────────────────────────────────────

async function getColors(req, res, next) {
  try {
    const colors = await prisma.colors.findMany({ orderBy: { name_fa: 'asc' } });
    res.json({ success: true, data: colors });
  } catch (err) { next(err); }
}

async function createColor(req, res, next) {
  try {
    const { key, hex, name_fa, name_en, name_tr } = req.body;
    const color = await prisma.colors.create({
      data: { key, hex, name_fa, name_en: name_en || name_fa, name_tr: name_tr || name_fa },
    });
    res.status(201).json({ success: true, data: color });
  } catch (err) { next(err); }
}

async function updateColor(req, res, next) {
  try {
    const { key, hex, name_fa, name_en, name_tr } = req.body;
    const color = await prisma.colors.update({
      where: { id: Number(req.params.id) },
      data: { key, hex, name_fa, name_en: name_en || name_fa, name_tr: name_tr || name_fa },
    });
    res.json({ success: true, data: color });
  } catch (err) { next(err); }
}

async function deleteColor(req, res, next) {
  try {
    await prisma.colors.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Size Charts ───────────────────────────────────────────────────────────────

async function getSizeCharts(req, res, next) {
  try {
    const charts = await prisma.size_charts.findMany({ orderBy: { name_fa: 'asc' } });
    res.json({ success: true, data: charts });
  } catch (err) { next(err); }
}

async function createSizeChart(req, res, next) {
  try {
    const { name_fa, name_en, name_tr, image_url_fa, image_url_en, image_url_tr } = req.body;
    const chart = await prisma.size_charts.create({
      data: {
        name_fa, name_en: name_en || name_fa, name_tr: name_tr || name_fa,
        image_url_fa,
        image_url_en: image_url_en || image_url_fa,
        image_url_tr: image_url_tr || image_url_fa,
      },
    });
    res.status(201).json({ success: true, data: chart });
  } catch (err) { next(err); }
}

async function updateSizeChart(req, res, next) {
  try {
    const { name_fa, name_en, name_tr, image_url_fa, image_url_en, image_url_tr } = req.body;
    const chart = await prisma.size_charts.update({
      where: { id: Number(req.params.id) },
      data: {
        name_fa, name_en: name_en || name_fa, name_tr: name_tr || name_fa,
        image_url_fa,
        image_url_en: image_url_en || image_url_fa,
        image_url_tr: image_url_tr || image_url_fa,
      },
    });
    res.json({ success: true, data: chart });
  } catch (err) { next(err); }
}

async function deleteSizeChart(req, res, next) {
  try {
    await prisma.size_charts.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Sizes ─────────────────────────────────────────────────────────────────────

async function getSizes(req, res, next) {
  try {
    const sizes = await prisma.sizes.findMany({ orderBy: { sort_order: 'asc' } });
    res.json({ success: true, data: sizes });
  } catch (err) { next(err); }
}

async function createSize(req, res, next) {
  try {
    const { label, sort_order } = req.body;
    const size = await prisma.sizes.create({ data: { label: label.trim(), sort_order: Number(sort_order) || 0 } });
    res.status(201).json({ success: true, data: size });
  } catch (err) { next(err); }
}

async function updateSize(req, res, next) {
  try {
    const { label, sort_order } = req.body;
    const size = await prisma.sizes.update({
      where: { id: Number(req.params.id) },
      data: { label: label.trim(), sort_order: Number(sort_order) || 0 },
    });
    res.json({ success: true, data: size });
  } catch (err) { next(err); }
}

async function deleteSize(req, res, next) {
  try {
    await prisma.sizes.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Media upload ──────────────────────────────────────────────────────────────

async function uploadMedia(req, res) {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
  const { compressUploadedImage } = require('../middleware/upload');
  const url = await compressUploadedImage(req);
  res.json({ success: true, url });
}

// ─── Media delete ──────────────────────────────────────────────────────────────

async function deleteMedia(req, res, next) {
  try {
    const id = Number(req.params.id);
    const media = await prisma.product_media.findUnique({ where: { id } });
    if (!media) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.product_media.delete({ where: { id } });
    await prisma.products.update({ where: { id: media.product_id }, data: { is_dirty: true } });

    if (media.url.startsWith('/uploads/')) {
      const path = require('path');
      const fs   = require('fs');
      const file = path.join(__dirname, '../public', media.url);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Publish ───────────────────────────────────────────────────────────────────
const { PRODUCT_INCLUDE, buildProductSnapshot, buildCategorySnapshot, buildSubcategorySnapshot } = require('../utils/publishSnapshot');

async function getPublishStatus(req, res, next) {
  try {
    const [products, categories, subcategories] = await Promise.all([
      prisma.products.count({ where: { is_dirty: true } }),
      prisma.categories.count({ where: { is_dirty: true } }),
      prisma.subcategories.count({ where: { is_dirty: true } }),
    ]);
    res.json({ success: true, data: { pending_count: products + categories + subcategories, pending: { products, categories, subcategories } } });
  } catch (err) { next(err); }
}

// Re-snapshots EVERY row (not just is_dirty ones) so that, e.g., a category
// rename correctly cascades into every product's embedded category label in
// the same publish click. Do not "optimize" this to only touch dirty rows —
// that would silently break cross-entity consistency.
async function publishChanges(req, res, next) {
  try {
    const [products, categories, subcategories] = await Promise.all([
      prisma.products.findMany({ include: PRODUCT_INCLUDE }),
      prisma.categories.findMany(),
      prisma.subcategories.findMany(),
    ]);

    await prisma.$transaction([
      ...products.map(p => prisma.products.update({
        where: { id: p.id },
        data: { is_live: p.is_active, is_dirty: false, published_data: buildProductSnapshot(p) },
      })),
      ...categories.map(c => prisma.categories.update({
        where: { id: c.id },
        data: { is_live: c.is_active, is_dirty: false, published_data: buildCategorySnapshot(c) },
      })),
      ...subcategories.map(s => prisma.subcategories.update({
        where: { id: s.id },
        data: { is_live: s.is_active, is_dirty: false, published_data: buildSubcategorySnapshot(s) },
      })),
    ]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Deploy (staging preview → production) ──────────────────────────────────────
// staging (Store-staging) auto-pulls main every 2 min via cron (auto-pull.sh) and
// serves it at staging.shilista.com. These two endpoints let the admin panel show
// what's pending there and push it live to production (Store → /var/www/html).
const DEPLOY_PROD_DIR    = '/home/admin/Store';
const DEPLOY_STAGING_DIR = '/home/admin/Store-staging';
const DEPLOY_WEB_ROOT    = '/var/www/html';

async function getRepoCommit(dir) {
  const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%H%x1f%an%x1f%ad%x1f%s', '--date=short'], { cwd: dir });
  const [hash, author, date, message] = stdout.trim().split('\x1f');
  return { hash, short: hash.slice(0, 7), author, date, message };
}

async function getPendingCommits(dir, fromHash, toHash) {
  if (!fromHash || !toHash || fromHash === toHash) return [];
  const { stdout } = await execFileAsync(
    'git', ['log', `${fromHash}..${toHash}`, '--format=%h%x1f%s%x1f%ad', '--date=short'], { cwd: dir }
  );
  if (!stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    const [hash, message, date] = line.split('\x1f');
    return { hash, message, date };
  });
}

async function getDeployStatus(req, res, next) {
  try {
    const [production, staging] = await Promise.all([
      getRepoCommit(DEPLOY_PROD_DIR),
      getRepoCommit(DEPLOY_STAGING_DIR),
    ]);
    // Resolved against the staging clone, not production's — production's local
    // .git doesn't have staging's newer commit objects until it actually fetches
    // during a deploy, so `git log prod..staging` only works run from staging
    // (which, tracking the same linear main history, already has both).
    const pending = await getPendingCommits(DEPLOY_STAGING_DIR, production.hash, staging.hash);
    res.json({ success: true, data: { production, staging, pending } });
  } catch (err) { next(err); }
}

async function deployToProduction(req, res, next) {
  try {
    const before = await getRepoCommit(DEPLOY_PROD_DIR);

    await execFileAsync('git', ['fetch', 'origin', 'main'], { cwd: DEPLOY_PROD_DIR });
    await execFileAsync('git', ['reset', '--hard', 'origin/main'], { cwd: DEPLOY_PROD_DIR });

    const after = await getRepoCommit(DEPLOY_PROD_DIR);
    const deployed = before.hash !== after.hash;

    if (deployed) {
      const { stdout: changed } = await execFileAsync(
        'git', ['diff', '--name-only', before.hash, after.hash], { cwd: DEPLOY_PROD_DIR }
      );
      const files = changed.trim().split('\n').filter(Boolean);

      await execFileAsync('rsync', ['-a', '--exclude=.git', `${DEPLOY_PROD_DIR}/frontend/`, `${DEPLOY_WEB_ROOT}/`]);

      if (files.some(f => f.startsWith('backend/'))) {
        await execFileAsync('npm', ['install', '--omit=dev'], { cwd: `${DEPLOY_PROD_DIR}/backend` });
        // npm install does NOT regenerate the Prisma client on its own — without this,
        // a schema.prisma change ships but the running server keeps using the stale
        // generated client and 500s on anything touching the new fields/enum values.
        await execFileAsync('npx', ['prisma', 'generate'], { cwd: `${DEPLOY_PROD_DIR}/backend` });
        await execFileAsync('pm2', ['restart', 'shilista-api', '--update-env']);
      }
    }

    res.json({ success: true, data: { deployed, before, after } });
  } catch (err) { next(err); }
}

// ─── Products ──────────────────────────────────────────────────────────────────

async function getProducts(req, res, next) {
  try {
    const products = await prisma.products.findMany({
      include: {
        categories:         { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        subcategories:      { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        product_colors:     { include: { colors: true } },
        product_sizes:      true,
        product_media:      { orderBy: { sort_order: 'asc' } },
        product_inventory:  { include: { colors: { select: { id: true, hex: true, name_fa: true, name_en: true } } }, orderBy: [{ color_id: 'asc' }, { size_label: 'asc' }] },
        product_categories: { include: { categories: true, subcategories: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: products });
  } catch (err) { next(err); }
}

async function createProduct(req, res, next) {
  try {
    const {
      category_id, subcategory_id, size_chart_id, gender, code, name_fa, name_en, name_tr,
      desc_fa, desc_en, desc_tr, gradient, tag, price, discounted_price, cost_price, stock, delivery_days,
      brand, supplier_shop_name, product_link, supplier_code, supplier_note,
      colors, sizes, media, inventory, extra_categories,
    } = req.body;

    let finalCode = code?.trim() || null;
    if (!finalCode) {
      const last = await prisma.products.findFirst({
        where: { code: { startsWith: 'SHIL' } },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
      const nextNum = last?.code ? Number(last.code.replace('SHIL', '')) + 1 : 100;
      finalCode = 'SHIL' + String(nextNum).padStart(8, '0');
    }

    const product = await prisma.products.create({
      data: {
        category_id:    Number(category_id),
        subcategory_id: subcategory_id ? Number(subcategory_id) : null,
        size_chart_id:  size_chart_id ? Number(size_chart_id) : null,
        gender:         gender || 'unisex',
        code:          finalCode,
        name_fa,
        name_en: name_en || name_fa,
        name_tr: name_tr || name_fa,
        desc_fa:       desc_fa   || null,
        desc_en:       desc_en   || null,
        desc_tr:       desc_tr   || null,
        gradient:      gradient  || null,
        tag:           tag       || null,
        price:            price     || 0,
        discounted_price: discounted_price != null && discounted_price !== '' ? Number(discounted_price) : null,
        cost_price:       cost_price != null && cost_price !== '' ? Number(cost_price) : null,
        stock:              stock     || 0,
        delivery_days:      delivery_days != null ? Number(delivery_days) : 5,
        brand:              brand?.trim()              || null,
        supplier_shop_name: supplier_shop_name?.trim() || null,
        product_link:       product_link?.trim()       || null,
        supplier_code:      supplier_code?.trim()      || null,
        supplier_note:      supplier_note?.trim()      || null,
        product_colors: colors?.length ? {
          create: colors.map(c => ({ color_id: Number(c.id), is_available: c.is_available !== false })),
        } : undefined,
        product_sizes: sizes?.length ? {
          create: sizes.map(s => ({ size_label: s.label, is_available: s.is_available !== false })),
        } : undefined,
        product_media: media?.length ? {
          create: media.map((m, i) => ({ type: m.type, url: m.url, sort_order: i })),
        } : undefined,
      },
      include: {
        categories:         { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        subcategories:      { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        product_colors:     { include: { colors: true } },
        product_sizes:      true,
        product_media:      { orderBy: { sort_order: 'asc' } },
        product_inventory:  true,
        product_categories: { include: { categories: true, subcategories: true } },
      },
    });
    if (inventory?.length) {
      await prisma.product_inventory.createMany({
        data: inventory.map(i => ({
          product_id: product.id,
          color_id:   i.color_id ? Number(i.color_id) : null,
          size_label: i.size_label || null,
          quantity:   Number(i.quantity) || 0,
        })),
        skipDuplicates: true,
      });
    }
    if (extra_categories?.length) {
      await prisma.product_categories.createMany({
        data: extra_categories.map(ec => ({
          product_id:     product.id,
          category_id:    Number(ec.category_id),
          subcategory_id: ec.subcategory_id ? Number(ec.subcategory_id) : null,
        })),
        skipDuplicates: true,
      });
    }
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
}

async function updateProduct(req, res, next) {
  try {
    const id = Number(req.params.id);
    const {
      category_id, subcategory_id, size_chart_id, gender, name_fa, name_en, name_tr,
      desc_fa, desc_en, desc_tr, gradient, tag, price, discounted_price, cost_price, stock, is_active, delivery_days,
      brand, supplier_shop_name, product_link, supplier_code, supplier_note,
      colors, sizes, media, inventory, extra_categories,
    } = req.body;

    await prisma.product_colors.deleteMany({ where: { product_id: id } });
    await prisma.product_sizes.deleteMany({ where:  { product_id: id } });
    await prisma.product_inventory.deleteMany({ where: { product_id: id } });
    await prisma.product_categories.deleteMany({ where: { product_id: id } });

    const existingMedia = await prisma.product_media.findMany({ where: { product_id: id }, orderBy: { sort_order: 'asc' } });
    const existingCount = existingMedia.length;

    const product = await prisma.products.update({
      where: { id },
      data: {
        category_id:    Number(category_id),
        subcategory_id: subcategory_id ? Number(subcategory_id) : null,
        size_chart_id:  size_chart_id ? Number(size_chart_id) : null,
        gender:         gender || 'unisex',
        name_fa,
        name_en: name_en || name_fa,
        name_tr: name_tr || name_fa,
        desc_fa:       desc_fa   || null,
        desc_en:       desc_en   || null,
        desc_tr:       desc_tr   || null,
        gradient:      gradient  || null,
        tag:           tag       || null,
        price:            price     || 0,
        discounted_price: discounted_price != null && discounted_price !== '' ? Number(discounted_price) : null,
        cost_price:       cost_price != null && cost_price !== '' ? Number(cost_price) : null,
        stock:              stock     || 0,
        delivery_days:      delivery_days != null ? Number(delivery_days) : 5,
        is_active:          is_active !== undefined ? Boolean(is_active) : true,
        is_dirty:           true,
        brand:              brand?.trim()              || null,
        supplier_shop_name: supplier_shop_name?.trim() || null,
        product_link:       product_link?.trim()       || null,
        supplier_code:      supplier_code?.trim()      || null,
        supplier_note:      supplier_note?.trim()      || null,
        updated_at:    new Date(),
        product_colors: colors?.length ? {
          create: colors.map(c => ({ color_id: Number(c.id), is_available: c.is_available !== false })),
        } : undefined,
        product_sizes: sizes?.length ? {
          create: sizes.map(s => ({ size_label: s.label, is_available: s.is_available !== false })),
        } : undefined,
        product_media: media?.length ? {
          create: media.map((m, i) => ({ type: m.type, url: m.url, sort_order: existingCount + i })),
        } : undefined,
      },
      include: {
        categories:         { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        subcategories:      { select: { key: true, label_fa: true, label_en: true, label_tr: true } },
        product_colors:     { include: { colors: true } },
        product_sizes:      true,
        product_media:      { orderBy: { sort_order: 'asc' } },
        product_inventory:  true,
        product_categories: { include: { categories: true, subcategories: true } },
      },
    });
    if (inventory?.length) {
      await prisma.product_inventory.createMany({
        data: inventory.map(i => ({
          product_id: id,
          color_id:   i.color_id ? Number(i.color_id) : null,
          size_label: i.size_label || null,
          quantity:   Number(i.quantity) || 0,
        })),
        skipDuplicates: true,
      });
    }
    if (extra_categories?.length) {
      await prisma.product_categories.createMany({
        data: extra_categories.map(ec => ({
          product_id:     id,
          category_id:    Number(ec.category_id),
          subcategory_id: ec.subcategory_id ? Number(ec.subcategory_id) : null,
        })),
        skipDuplicates: true,
      });
    }
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

async function deleteProduct(req, res, next) {
  try {
    await prisma.products.update({
      where: { id: Number(req.params.id) },
      data:  { is_active: false, is_dirty: true },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Admin Customers ───────────────────────────────────────────────────────────

async function getAdminCustomers(req, res, next) {
  try {
    const customers = await prisma.customers.findMany({
      orderBy: { created_at: 'desc' },
      select: {
        id: true, full_name: true, email: true, mobile: true,
        registered_by: true, preferred_lang: true, is_active: true, created_at: true, birth_date: true, birthday_email_year: true, birthday_email_sent_at: true,
      },
    });
    res.json({ success: true, data: customers });
  } catch (err) { next(err); }
}

async function updateAdminCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { full_name, email, mobile, is_active, preferred_lang, birth_date } = req.body;

    if (email) {
      const taken = await prisma.customers.findFirst({ where: { email, NOT: { id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    if (mobile) {
      if (!/^\+[0-9]{7,15}$/.test((mobile || '').replace(/[\s\-]/g, ''))) {
        return res.status(400).json({ success: false, message: 'invalid_mobile' });
      }
      const taken = await prisma.customers.findFirst({ where: { mobile, NOT: { id } } });
      if (taken) return res.status(409).json({ success: false, message: 'Mobile already in use' });
    }

    const data = { updated_at: new Date() };
    if (full_name      !== undefined) data.full_name      = full_name;
    if (email          !== undefined) data.email          = email || null;
    if (mobile         !== undefined) data.mobile         = mobile || null;
    if (is_active      !== undefined) data.is_active      = Boolean(is_active);
    if (preferred_lang !== undefined) data.preferred_lang = preferred_lang;
    if (birth_date     !== undefined) data.birth_date     = birth_date ? new Date(birth_date) : null;

    const updated = await prisma.customers.update({
      where: { id },
      data,
      select: { id: true, full_name: true, email: true, mobile: true, registered_by: true, preferred_lang: true, is_active: true, created_at: true, birth_date: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ─── Admin Orders ──────────────────────────────────────────────────────────────

const ADMIN_ORDER_INCLUDE = {
  customers:   { select: { id: true, full_name: true, email: true, mobile: true, preferred_lang: true } },
  addresses:   true,
  order_items: {
    include: {
      products: { select: { id: true, code: true, name_fa: true, name_en: true, name_tr: true, delivery_days: true } },
      colors:   true,
    },
  },
  link_request_items: { orderBy: { id: 'asc' } },
};

async function getAdminOrders(req, res, next) {
  try {
    const orders = await prisma.orders.findMany({
      where: { is_prize: false },
      include: ADMIN_ORDER_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
}

// Admin sources each externally-linked product and tells the customer what it
// costs. Starts the 14-day response clock (quoted_at) once every link on the
// order is priced — see backend/scripts/declineStaleQuotes.js for the
// auto-decline side of that.
// PATCH /api/admin/orders/:orderId/link-items/:itemId/price — prices ONE link
// on an order that can hold up to MAX_LINK_ITEMS links. Once every item on the
// order has a unit_price, the order auto-transitions link_requested ->
// price_quoted (starting the customer's 14-day response clock) with
// total_amount = sum(unit_price * qty) across all items.
// Called after either pricing or rejecting one item — checks whether every
// item on the order is now resolved (priced or rejected) and, if so,
// transitions the order and sends the matching email. Returns the updated
// order if it transitioned, or null if some items are still pending.
async function finalizeLinkRequestOrderIfReady(orderId, resolvedItems) {
  const allResolved = resolvedItems.every((it) => it.unit_price != null || it.rejected);
  if (!allResolved) return null;

  const now = new Date();
  const pricedItems = resolvedItems.filter((it) => !it.rejected);

  if (!pricedItems.length) {
    // Every single item was rejected — nothing left to quote, so the whole
    // order is rejected, same terminal state as an admin-side preorder reject.
    const updated = await prisma.orders.update({
      where: { id: orderId },
      data:  { status: 'rejected', rejected_at: now, updated_at: now },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const reasons = resolvedItems
        .map((it, i) => (resolvedItems.length > 1 ? `#${i + 1}: ` : '') + (it.rejection_reason || ''))
        .filter(Boolean);
      const extraInfo = reasons.length ? [{ label: label('reject_reason', ol), value: reasons.join(' / ') }] : [];
      sendOrderEmail(updated.customers, updated, 'preorder_rejected', extraInfo).catch(() => {});
    }
    return updated;
  }

  const total = Math.round(pricedItems.reduce((sum, it) => sum + Number(it.unit_price) * it.qty, 0));
  const updated = await prisma.orders.update({
    where: { id: orderId },
    data:  { status: 'price_quoted', quoted_at: now, total_amount: total, updated_at: now },
    include: ADMIN_ORDER_INCLUDE,
  });
  if (updated.customers) {
    const ol = updated.lang || 'fa';
    const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' TL';
    const multi = updated.link_request_items.length > 1;
    const extraInfo = updated.link_request_items.flatMap((it, i) => {
      const prefix = multi ? `#${i + 1} ` : '';
      if (it.rejected) {
        return [{ label: prefix + label('product_link', ol), value: `${it.product_link} — ${label('reject_reason', ol)}: ${it.rejection_reason || '—'}`, dir: 'ltr' }];
      }
      return [
        { label: prefix + label('product_link', ol), value: it.product_link, dir: 'ltr' },
        { label: prefix + label('unit_price', ol), value: `${fmt(it.unit_price)} × ${it.qty}`, dir: 'ltr' },
      ];
    });
    extraInfo.push({ label: label('order_total', ol), value: fmt(total), dir: 'ltr' });
    sendOrderEmail(updated.customers, updated, 'price_quoted', extraInfo).catch(() => {});
  }
  return updated;
}

async function setLinkItemPrice(req, res, next) {
  try {
    const orderId = Number(req.params.orderId);
    const itemId  = Number(req.params.itemId);
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { link_request_items: { orderBy: { id: 'asc' } } },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'link_requested') {
      return res.status(400).json({ success: false, message: 'Order must be in link_requested status' });
    }
    const item = order.link_request_items.find((it) => it.id === itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (item.unit_price != null || item.rejected) {
      return res.status(400).json({ success: false, message: 'item_already_resolved' });
    }

    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'valid_amount_required' });
    }
    // unit_price is Decimal(12,2) — cents are fine per-item; total_amount is
    // Decimal(14,0) (whole Lira, same as every other order total in this app),
    // rounded explicitly at sum time below rather than left to the DB to truncate.
    const roundedUnit = Math.round(amount * 100) / 100;

    await prisma.link_request_items.update({
      where: { id: itemId },
      data:  { unit_price: roundedUnit },
    });

    const resolvedItems = order.link_request_items.map((it) => (it.id === itemId ? { ...it, unit_price: roundedUnit } : it));
    const finalized = await finalizeLinkRequestOrderIfReady(orderId, resolvedItems);
    const updated = finalized || await prisma.orders.findUnique({ where: { id: orderId }, include: ADMIN_ORDER_INCLUDE });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// PATCH /api/admin/orders/:orderId/link-items/:itemId/reject — declines ONE
// link (e.g. it's out of stock at the supplier, or we don't ship that brand).
// Mirrors setLinkItemPrice's resolution/transition logic exactly, just marking
// the item rejected instead of priced.
async function rejectLinkItem(req, res, next) {
  try {
    const orderId = Number(req.params.orderId);
    const itemId  = Number(req.params.itemId);
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { link_request_items: { orderBy: { id: 'asc' } } },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'link_requested') {
      return res.status(400).json({ success: false, message: 'Order must be in link_requested status' });
    }
    const item = order.link_request_items.find((it) => it.id === itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (item.unit_price != null || item.rejected) {
      return res.status(400).json({ success: false, message: 'item_already_resolved' });
    }

    const reason = req.body.reason ? String(req.body.reason).trim().slice(0, 1000) : null;
    const now = new Date();
    await prisma.link_request_items.update({
      where: { id: itemId },
      data:  { rejected: true, rejection_reason: reason, rejected_at: now },
    });

    const resolvedItems = order.link_request_items.map((it) => (it.id === itemId ? { ...it, rejected: true, rejection_reason: reason } : it));
    const finalized = await finalizeLinkRequestOrderIfReady(orderId, resolvedItems);
    const updated = finalized || await prisma.orders.findUnique({ where: { id: orderId }, include: ADMIN_ORDER_INCLUDE });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function setPaymentInfo(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'preorder') {
      return res.status(400).json({ success: false, message: 'Order must be in preorder status' });
    }
    const { iban, bank_name, account_holder, payment_link_label, payment_link_url } = req.body;
    // Admin picks exactly one payment method per order — a bank account or a
    // payment link, never both. Whichever one wasn't sent gets explicitly
    // cleared so re-setting payment info (e.g. after a rejected payment)
    // can't leave stale info from a previous method still on the order.
    const usingLink = !!payment_link_url;
    const data = usingLink
      ? { iban: null, bank_name: null, account_holder: null, payment_link_label, payment_link_url, status: 'payment_needed', updated_at: new Date() }
      : { iban, bank_name, account_holder, payment_link_label: null, payment_link_url: null, status: 'payment_needed', updated_at: new Date() };
    const updated = await prisma.orders.update({
      where: { id },
      data,
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = usingLink
        ? [
            { label: label('payment_link', ol), value: `<a href="${payment_link_url}" target="_blank" style="color:#c0562a">${payment_link_label || payment_link_url}</a>`, dir: 'ltr' },
            { label: label('order_total', ol),  value: Number(updated.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' TL', dir: 'ltr' },
          ]
        : [
            { label: label('bank_name', ol),      value: bank_name },
            { label: label('account_holder', ol), value: account_holder },
            { label: label('iban', ol),           value: iban, dir: 'ltr' },
            { label: label('order_total', ol),    value: Number(updated.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' TL', dir: 'ltr' },
          ];
      sendOrderEmail(updated.customers, updated, 'payment_needed', extraInfo).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function approvePayment(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'approval_needed') {
      return res.status(400).json({ success: false, message: 'Order must be in approval_needed status' });
    }

    const updated = await prisma.orders.update({
      where: { id },
      data:  { status: 'preparing', updated_at: new Date() },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const attachFiles = [];
      if (order.payment_receipt_url) {
        const receiptPath = path.join(__dirname, '../public', order.payment_receipt_url);
        try {
          const stat = fs.statSync(receiptPath);
          const ext = path.extname(order.payment_receipt_url).toLowerCase();
          const mime = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg');
          if (stat.size <= 8 * 1024 * 1024) {
            attachFiles.push({ filename: 'payment_receipt' + ext, path: receiptPath, contentType: mime });
          }
        } catch (e) {
          // Receipt file missing on this server's disk (e.g. uploaded through
          // staging, which writes to its own uploads/ dir, not production's) —
          // don't let a missing attachment crash the whole approve/reject action.
          console.error('[approvePayment] receipt file not found, skipping attachment:', receiptPath);
        }
      }
      sendOrderEmail(updated.customers, updated, 'preparing', [], attachFiles).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function rejectPayment(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'approval_needed') {
      return res.status(400).json({ success: false, message: 'Order must be in approval_needed status' });
    }
    const { reason } = req.body;
    const updated = await prisma.orders.update({
      where: { id },
      data:  {
        status:                   'payment_needed',
        payment_rejection_reason: reason || null,
        rejected_at:              new Date(),
        payment_receipt_url:      null,
        updated_at:               new Date(),
      },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = reason ? [{ label: label('reject_reason', ol), value: reason }] : [];
      const attachFiles = [];
      if (order.payment_receipt_url) {
        const receiptPath = path.join(__dirname, '../public', order.payment_receipt_url);
        try {
          const stat = fs.statSync(receiptPath);
          const ext = path.extname(order.payment_receipt_url).toLowerCase();
          const mime = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg');
          if (stat.size <= 8 * 1024 * 1024) {
            attachFiles.push({ filename: 'payment_receipt' + ext, path: receiptPath, contentType: mime });
          }
        } catch (e) {
          // Receipt file missing on this server's disk (e.g. uploaded through
          // staging, which writes to its own uploads/ dir, not production's) —
          // don't let a missing attachment crash the whole approve/reject action.
          console.error('[rejectPayment] receipt file not found, skipping attachment:', receiptPath);
        }
      }
      sendOrderEmail(updated.customers, updated, 'rejected', extraInfo, attachFiles).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function rejectPreorder(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'preorder' && order.status !== 'link_requested') {
      return res.status(400).json({ success: false, message: 'Order must be in preorder or link_requested status' });
    }
    const { reason } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.orders.update({
        where: { id },
        data:  { status: 'rejected', payment_rejection_reason: reason || null, rejected_at: new Date(), updated_at: new Date() },
        include: ADMIN_ORDER_INCLUDE,
      });
      // refund coupon usage and re-activate if it was auto-deactivated
      if (order.coupon_code && order.discount_amount > 0) {
        await tx.$executeRaw`
          UPDATE coupons
          SET used_count = GREATEST(0, used_count - 1),
              is_active  = CASE
                WHEN is_active = false AND max_uses IS NOT NULL AND GREATEST(0, used_count - 1) < max_uses THEN true
                WHEN is_active = false AND for_all = false AND GREATEST(0, used_count - 1) < (SELECT COUNT(*) FROM coupon_assignments WHERE coupon_id = id) THEN true
                ELSE is_active
              END,
              updated_at = NOW()
          WHERE code = ${order.coupon_code}
        `;
      }
      return u;
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = reason ? [{ label: label('reject_reason', ol), value: reason }] : [];
      sendOrderEmail(updated.customers, updated, 'preorder_rejected', extraInfo).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function setShipping(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'preparing') {
      return res.status(400).json({ success: false, message: 'Order must be in preparing status' });
    }
    const { carrier_name, tracking_number, tracking_note } = req.body;
    const updated = await prisma.orders.update({
      where: { id },
      data:  { carrier_name, tracking_number, tracking_note: tracking_note || null, status: 'delivery', shipped_at: new Date(), updated_at: new Date() },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      const ol = updated.lang || 'fa';
      const extraInfo = [
        { label: label('carrier', ol),  value: carrier_name },
        { label: label('tracking', ol), value: tracking_number, dir: 'ltr' },
        ...(tracking_note ? [{ label: ol === 'fa' ? 'یادداشت ارسال' : ol === 'tr' ? 'Kargo Notu' : 'Tracking Note', value: tracking_note }] : []),
      ];
      sendOrderEmail(updated.customers, updated, 'delivery', extraInfo).catch(() => {});
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function markDelivered(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'delivery') {
      return res.status(400).json({ success: false, message: 'Order must be in delivery status' });
    }
    const updated = await prisma.orders.update({
      where: { id },
      data:  { status: 'delivered', delivered_at: new Date(), updated_at: new Date() },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (updated.customers) {
      sendOrderEmail(updated.customers, updated, 'delivered').catch(() => {});
      const deliveredCount = await prisma.orders.count({
        where: { customer_id: updated.customer_id, status: 'delivered', is_prize: false },
      });
      if (deliveredCount > 0 && deliveredCount % 6 === 0) {
        const eligibleCycles = Math.floor(deliveredCount / 6);
        const prizesClaimed = await prisma.orders.count({
          where: { customer_id: updated.customer_id, is_prize: true },
        });
        if (prizesClaimed < eligibleCycles) {
          const custFull = await prisma.customers.findUnique({
            where:  { id: updated.customer_id },
            select: { addresses: { where: { is_default: true }, select: { id: true } } },
          });
          const addressId = custFull?.addresses?.[0]?.id || null;
          await prisma.orders.create({
            data: {
              customer_id:  updated.customer_id,
              address_id:   addressId,
              status:       'confirmed',
              is_prize:     true,
              total_amount: 0,
              channel:      'prize',
              lang:         updated.customers.preferred_lang || 'fa',
              note:         'Loyalty Gift Prize',
            },
          });
          sendPrizeEarnedEmail(updated.customers).catch(e => console.error('[prize email]', e.message));
        }
      }
    }
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ─── Bank Accounts ────────────────────────────────────────────────────────────

async function getBankAccounts(req, res, next) {
  try {
    const accounts = await prisma.bank_accounts.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
    res.json({ success: true, data: accounts });
  } catch (err) { next(err); }
}

async function createBankAccount(req, res, next) {
  try {
    const { bank_name, account_holder, iban, is_active, sort_order } = req.body;
    if (!bank_name || !account_holder || !iban)
      return res.status(400).json({ success: false, message: 'bank_name, account_holder and iban are required' });
    const account = await prisma.bank_accounts.create({
      data: { bank_name, account_holder, iban, is_active: is_active !== false, sort_order: sort_order || 0 },
    });
    res.status(201).json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function updateBankAccount(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { bank_name, account_holder, iban, is_active, sort_order } = req.body;
    const account = await prisma.bank_accounts.update({
      where: { id },
      data: { bank_name, account_holder, iban, is_active, sort_order },
    });
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function deleteBankAccount(req, res, next) {
  try {
    const id = Number(req.params.id);
    await prisma.bank_accounts.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Payment Links ──────────────────────────────────────────────────────────
// Same shape/role as bank accounts above — an admin-managed list an order's
// payment info can be set from, just carrying a label + external URL
// (payment gateway checkout link, etc.) instead of bank details.
async function getPaymentLinks(req, res, next) {
  try {
    const links = await prisma.payment_links.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
    res.json({ success: true, data: links });
  } catch (err) { next(err); }
}

async function createPaymentLink(req, res, next) {
  try {
    const { label, url, is_active, sort_order } = req.body;
    if (!label || !url)
      return res.status(400).json({ success: false, message: 'label and url are required' });
    const link = await prisma.payment_links.create({
      data: { label, url, is_active: is_active !== false, sort_order: sort_order || 0 },
    });
    res.status(201).json({ success: true, data: link });
  } catch (err) { next(err); }
}

async function updatePaymentLink(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { label, url, is_active, sort_order } = req.body;
    const link = await prisma.payment_links.update({
      where: { id },
      data: { label, url, is_active, sort_order },
    });
    res.json({ success: true, data: link });
  } catch (err) { next(err); }
}

async function deletePaymentLink(req, res, next) {
  try {
    const id = Number(req.params.id);
    await prisma.payment_links.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Site views report (by IP / city / country) ────────────────────────────────

async function getSiteViewsReport(req, res, next) {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [total, byCity, byCountry, byIp] = await Promise.all([
      prisma.site_views.count({ where: { created_at: { gte: since } } }),
      prisma.$queryRaw`
        SELECT city, country, COUNT(*)::int AS cnt
        FROM site_views
        WHERE created_at >= ${since} AND city IS NOT NULL
        GROUP BY city, country
        ORDER BY cnt DESC
        LIMIT 50`,
      prisma.$queryRaw`
        SELECT country, COUNT(*)::int AS cnt
        FROM site_views
        WHERE created_at >= ${since} AND country IS NOT NULL
        GROUP BY country
        ORDER BY cnt DESC
        LIMIT 50`,
      prisma.$queryRaw`
        SELECT ip, city, country, COUNT(*)::int AS cnt, MAX(created_at) AS last_seen
        FROM site_views
        WHERE created_at >= ${since} AND ip IS NOT NULL
        GROUP BY ip, city, country
        ORDER BY last_seen DESC
        LIMIT 100`,
    ]);

    res.json({
      success: true,
      data: {
        total,
        byCity:    byCity.map(r => ({ city: r.city, country: r.country, count: Number(r.cnt) })),
        byCountry: byCountry.map(r => ({ country: r.country, count: Number(r.cnt) })),
        byIp:      byIp.map(r => ({ ip: r.ip, city: r.city, country: r.country, count: Number(r.cnt), lastSeen: r.last_seen })),
      },
    });
  } catch (err) { next(err); }
}

// ─── Reports ───────────────────────────────────────────────────────────────────

async function getReports(req, res, next) {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);
    const hasDate = Object.keys(dateFilter).length > 0;
    const orderWhere = hasDate ? { created_at: dateFilter } : {};

    const [
      totalOrders,
      successOrders,
      rejectedOrders,
      cancelledOrders,
      activeOrders,
      revenueAgg,
      totalCustomers,
      newCustomers,
    ] = await Promise.all([
      prisma.orders.count({ where: orderWhere }),
      prisma.orders.count({ where: { ...orderWhere, status: 'delivered' } }),
      prisma.orders.count({ where: { ...orderWhere, status: 'rejected' } }),
      prisma.orders.count({ where: { ...orderWhere, status: 'cancelled' } }),
      prisma.orders.count({ where: { ...orderWhere, status: { in: ['link_requested','price_quoted','preorder','payment_needed','approval_needed','preparing','delivery'] } } }),
      prisma.orders.aggregate({
        where: { ...orderWhere, status: 'delivered' },
        _sum: { total_amount: true },
        _avg: { total_amount: true },
      }),
      prisma.customers.count(),
      hasDate ? prisma.customers.count({ where: { created_at: dateFilter } }) : prisma.customers.count(),
    ]);

    // Status breakdown via raw SQL
    const statusRows = hasDate
      ? await prisma.$queryRaw`SELECT status, COUNT(*)::int AS cnt FROM orders WHERE created_at >= ${dateFilter.gte} AND created_at <= ${dateFilter.lte} GROUP BY status`
      : await prisma.$queryRaw`SELECT status, COUNT(*)::int AS cnt FROM orders GROUP BY status`;
    const statusMap = {};
    for (const row of statusRows) statusMap[row.status] = Number(row.cnt);

    // Top products via raw SQL (Prisma groupBy doesn't support relation filters)
    let topProductsEnriched = [];
    try {
      const rows = hasDate
        ? await prisma.$queryRaw`
            SELECT oi.product_id, SUM(oi.qty)::int AS total_qty,
                   p.name_fa, p.name_en, p.name_tr, p.code
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN products p ON p.id = oi.product_id
            WHERE o.status = 'delivered'
              AND o.created_at >= ${dateFilter.gte}
              AND o.created_at <= ${dateFilter.lte}
            GROUP BY oi.product_id, p.name_fa, p.name_en, p.name_tr, p.code
            ORDER BY total_qty DESC
            LIMIT 5`
        : await prisma.$queryRaw`
            SELECT oi.product_id, SUM(oi.qty)::int AS total_qty,
                   p.name_fa, p.name_en, p.name_tr, p.code
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN products p ON p.id = oi.product_id
            WHERE o.status = 'delivered'
            GROUP BY oi.product_id, p.name_fa, p.name_en, p.name_tr, p.code
            ORDER BY total_qty DESC
            LIMIT 5`;
      topProductsEnriched = rows.map(r => ({
        product_id: r.product_id,
        qty:        Number(r.total_qty),
        name_fa:    r.name_fa,
        name_en:    r.name_en,
        name_tr:    r.name_tr,
        code:       r.code,
      }));
    } catch (_) {}

    res.json({
      success: true,
      data: {
        orders: {
          total:     totalOrders,
          delivered: successOrders,
          rejected:  rejectedOrders,
          cancelled: cancelledOrders,
          active:    activeOrders,
          byStatus:  statusMap,
        },
        revenue: {
          total: Number(revenueAgg._sum.total_amount || 0),
          avg:   Math.round(Number(revenueAgg._avg.total_amount || 0)),
        },
        customers: {
          total: totalCustomers,
          new:   newCustomers,
        },
        topProducts: topProductsEnriched,
      },
    });
  } catch (err) { next(err); }
}

// ─── Financial Report ──────────────────────────────────────────────────────────

async function getFinancialReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);
    const hasDate = Object.keys(dateFilter).length > 0;

    const where = {
      status: 'delivered',
      ...(hasDate ? { created_at: dateFilter } : {}),
    };

    const [summary, byBank, orders] = await Promise.all([
      prisma.orders.aggregate({
        where,
        _sum:   { total_amount: true },
        _count: { id: true },
        _avg:   { total_amount: true },
        _max:   { total_amount: true },
        _min:   { total_amount: true },
      }),

      // Breakdown per bank account
      hasDate
        ? prisma.$queryRaw`
            SELECT
              COALESCE(bank_name, '—')      AS bank_name,
              COALESCE(account_holder, '—') AS account_holder,
              COALESCE(iban, '—')           AS iban,
              COUNT(*)::int                 AS order_count,
              SUM(total_amount)::float      AS total_amount
            FROM orders
            WHERE status = 'delivered'
              AND created_at >= ${dateFilter.gte}
              AND created_at <= ${dateFilter.lte}
            GROUP BY bank_name, account_holder, iban
            ORDER BY total_amount DESC`
        : prisma.$queryRaw`
            SELECT
              COALESCE(bank_name, '—')      AS bank_name,
              COALESCE(account_holder, '—') AS account_holder,
              COALESCE(iban, '—')           AS iban,
              COUNT(*)::int                 AS order_count,
              SUM(total_amount)::float      AS total_amount
            FROM orders
            WHERE status = 'delivered'
            GROUP BY bank_name, account_holder, iban
            ORDER BY total_amount DESC`,

      prisma.orders.findMany({
        where,
        orderBy:  { created_at: 'desc' },
        select: {
          id:             true,
          created_at:     true,
          total_amount:   true,
          bank_name:      true,
          account_holder: true,
          iban:           true,
          note:           true,
          customers: { select: { id: true, full_name: true, mobile: true, email: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalRevenue:  Math.round(Number(summary._sum.total_amount  || 0)),
          orderCount:    summary._count.id,
          avgOrder:      Math.round(Number(summary._avg.total_amount  || 0)),
          maxOrder:      Math.round(Number(summary._max.total_amount  || 0)),
          minOrder:      Math.round(Number(summary._min.total_amount  || 0)),
        },
        byBank: byBank.map(r => ({
          bank_name:      r.bank_name,
          account_holder: r.account_holder,
          iban:           r.iban,
          orderCount:     Number(r.order_count),
          totalAmount:    Math.round(Number(r.total_amount || 0)),
        })),
        orders: orders.map(o => ({
          id:             o.id,
          created_at:     o.created_at,
          total_amount:   Math.round(Number(o.total_amount || 0)),
          bank_name:      o.bank_name,
          account_holder: o.account_holder,
          iban:           o.iban,
          customer_name:  o.customers?.full_name || '—',
          customer_phone: o.customers?.mobile || o.customers?.email || '—',
        })),
      },
    });
  } catch (err) { next(err); }
}

// ─── Customer Reports ──────────────────────────────────────────────────────────

async function getCustomerReports(req, res, next) {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalCustomers, newToday, newThisWeek, newThisMonth, topCustomers] = await Promise.all([
      prisma.customers.count({ where: { is_active: true } }),
      prisma.customers.count({ where: { created_at: { gte: startOfToday } } }),
      prisma.customers.count({ where: { created_at: { gte: startOfWeek  } } }),
      prisma.customers.count({ where: { created_at: { gte: startOfMonth } } }),
      prisma.$queryRaw`
        SELECT
          c.id,
          c.full_name,
          c.email,
          c.mobile,
          COUNT(o.id)::int           AS order_count,
          SUM(o.total_amount)::float AS total_spent
        FROM customers c
        JOIN orders o ON o.customer_id = c.id AND o.status = 'delivered'
        GROUP BY c.id, c.full_name, c.email, c.mobile
        ORDER BY order_count DESC, total_spent DESC
        LIMIT 50
      `,
    ]);

    res.json({
      success: true,
      data: {
        totalCustomers,
        newToday,
        newThisWeek,
        newThisMonth,
        topCustomers: topCustomers.map(r => ({
          id:          r.id,
          full_name:   r.full_name,
          email:       r.email,
          mobile:      r.mobile,
          orderCount:  Number(r.order_count),
          totalSpent:  Math.round(Number(r.total_spent || 0)),
        })),
      },
    });
  } catch (err) { next(err); }
}

// ─── Coupon Report ────────────────────────────────────────────────────────────
async function getCouponReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const dateFilter = from && to
      ? { created_at: { gte: new Date(from), lte: new Date(to + 'T23:59:59Z') } }
      : {};

    // All coupons with their used orders
    const coupons = await prisma.coupons.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        coupon_assignments: {
          include: { customers: { select: { id: true, full_name: true, email: true, mobile: true } } },
        },
      },
    });

    // Orders that used a coupon
    const orders = await prisma.orders.findMany({
      where: { coupon_code: { not: null }, ...dateFilter },
      select: {
        id: true, coupon_code: true, created_at: true,
        total_amount: true, original_amount: true, discount_amount: true, status: true,
        customers: { select: { id: true, full_name: true, email: true, mobile: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    // Group orders by coupon_code
    const ordersByCode = {};
    for (const o of orders) {
      const c = o.coupon_code;
      if (!ordersByCode[c]) ordersByCode[c] = [];
      ordersByCode[c].push(o);
    }

    const report = coupons.map((cp) => {
      const cpOrders = ordersByCode[cp.code] || [];
      const totalDiscount   = cpOrders.reduce((s, o) => s + Number(o.discount_amount), 0);
      const totalFinal      = cpOrders.reduce((s, o) => s + Number(o.total_amount),    0);
      const totalOriginal   = cpOrders.reduce((s, o) => s + Number(o.original_amount || o.total_amount), 0);
      return {
        id:          cp.id,
        code:        cp.code,
        type:        cp.type,
        value:       Number(cp.value),
        is_active:   cp.is_active,
        for_all:     cp.for_all,
        used_count:  cp.used_count,
        max_uses:    cp.max_uses,
        starts_at:   cp.starts_at,
        expires_at:  cp.expires_at,
        assignments: (cp.coupon_assignments || []).map((a) => a.customers),
        orders:      cpOrders,
        stats: {
          order_count:    cpOrders.length,
          total_original: totalOriginal,
          total_discount: totalDiscount,
          total_final:    totalFinal,
        },
      };
    });

    const globalStats = {
      total_coupons_used: orders.length,
      total_discount:     orders.reduce((s, o) => s + Number(o.discount_amount), 0),
      total_revenue:      orders.reduce((s, o) => s + Number(o.total_amount),    0),
    };

    res.json({ success: true, data: { coupons: report, stats: globalStats } });
  } catch (err) { next(err); }
}

module.exports = {
  login, uploadMedia, deleteMedia,
  getPublishStatus, publishChanges,
  getDeployStatus, deployToProduction,
  getCategories, createCategory, updateCategory, toggleCategory, deleteCategory,
  getSubcategories, createSubcategory, updateSubcategory, toggleSubcategory, deleteSubcategory,
  getColors, createColor, updateColor, deleteColor,
  getSizeCharts, createSizeChart, updateSizeChart, deleteSizeChart,
  getSizes, createSize, updateSize, deleteSize,
  getAdminCustomers, updateAdminCustomer,
  getProducts, createProduct, updateProduct, deleteProduct,
  getAdminOrders, setPaymentInfo, setLinkItemPrice, rejectLinkItem, approvePayment, rejectPayment, rejectPreorder, setShipping, markDelivered,
  getBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount,
  getPaymentLinks, createPaymentLink, updatePaymentLink, deletePaymentLink,
  getCommunications, getCommunicationBody,
  getNotifications,
  getDashboard,
  getReports, getFinancialReport, getCustomerReports, getCouponReport, getSiteViewsReport,
  listPrizeOrders, shipPrizeOrder, deliverPrizeOrder, updatePrizeNote,
};

// ─── Prize Orders ─────────────────────────────────────────────────────────────
async function listPrizeOrders(req, res, next) {
  try {
    const orders = await prisma.orders.findMany({
      where: { is_prize: true },
      orderBy: { created_at: 'desc' },
      include: {
        customers: { select: { id: true, full_name: true, mobile: true, email: true } },
        addresses: { select: { recipient: true, city: true, detail: true, phone: true, postal_code: true } },
      },
    });
    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
}

async function shipPrizeOrder(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { carrier_name, tracking_number, tracking_note } = req.body;
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order || !order.is_prize) return res.status(404).json({ success: false, message: 'not_found' });
    if (order.status !== 'confirmed') return res.status(400).json({ success: false, message: 'must_be_confirmed' });
    const updated = await prisma.orders.update({
      where: { id },
      data: { status: 'shipped', carrier_name: carrier_name || null, tracking_number: tracking_number || null, tracking_note: tracking_note || null, shipped_at: new Date(), updated_at: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function deliverPrizeOrder(req, res, next) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order || !order.is_prize) return res.status(404).json({ success: false, message: 'not_found' });
    if (order.status !== 'shipped') return res.status(400).json({ success: false, message: 'must_be_shipped' });
    const updated = await prisma.orders.update({
      where: { id },
      data: { status: 'delivered', delivered_at: new Date(), updated_at: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function updatePrizeNote(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { admin_note } = req.body;
    if (!admin_note || !admin_note.trim()) return res.status(400).json({ success: false, message: 'note_empty' });
    const order = await prisma.orders.findUnique({ where: { id } });
    if (!order || !order.is_prize) return res.status(404).json({ success: false, message: 'not_found' });
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    const newEntry = dateStr + ' | ' + admin_note.trim();
    const combined = order.admin_note ? order.admin_note + '\n' + newEntry : newEntry;
    await prisma.orders.update({
      where: { id },
      data: { admin_note: combined, updated_at: new Date() },
    });
    res.json({ success: true, admin_note: combined });
  } catch (err) { next(err); }
}
