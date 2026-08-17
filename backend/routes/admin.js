const router    = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const c         = require('../controllers/adminController');
const { getUploadMiddleware } = require('../middleware/upload');

router.post('/login', c.login);

router.use(adminAuth);

router.get('/dashboard', c.getDashboard);
router.get('/notifications', c.getNotifications);
router.get('/communications', c.getCommunications);
router.get('/communications/:id/body', c.getCommunicationBody);

router.post('/upload', (req, res, next) => {
  const upload = getUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'multer not installed — run: npm install multer' });
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'INVALID_FILE_TYPE' || err.message === 'invalid_file_type') {
        return res.status(400).json({ success: false, errorCode: 'invalid_file_type' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, errorCode: 'file_too_large' });
      }
      return next(err);
    }
    c.uploadMedia(req, res);
  });
});

router.delete('/media/:id',      c.deleteMedia);

router.get('/categories',                  c.getCategories);
router.post('/categories',                 c.createCategory);
router.put('/categories/:id',              c.updateCategory);
router.patch('/categories/:id/toggle',     c.toggleCategory);
router.delete('/categories/:id',           c.deleteCategory);

router.get('/subcategories',               c.getSubcategories);
router.post('/subcategories',              c.createSubcategory);
router.put('/subcategories/:id',           c.updateSubcategory);
router.patch('/subcategories/:id/toggle',  c.toggleSubcategory);
router.delete('/subcategories/:id',        c.deleteSubcategory);

router.get('/colors',       c.getColors);
router.post('/colors',      c.createColor);
router.put('/colors/:id',   c.updateColor);
router.delete('/colors/:id', c.deleteColor);

router.get('/sizes',        c.getSizes);
router.post('/sizes',       c.createSize);
router.put('/sizes/:id',    c.updateSize);
router.delete('/sizes/:id', c.deleteSize);

router.get('/size-charts',        c.getSizeCharts);
router.post('/size-charts',       c.createSizeChart);
router.put('/size-charts/:id',    c.updateSizeChart);
router.delete('/size-charts/:id', c.deleteSizeChart);

router.get('/customers',        c.getAdminCustomers);
router.put('/customers/:id',   c.updateAdminCustomer);

router.get('/products',       c.getProducts);
router.post('/products',      c.createProduct);
router.put('/products/:id',   c.updateProduct);
router.delete('/products/:id', c.deleteProduct);

router.get('/publish/status', c.getPublishStatus);
router.post('/publish',       c.publishChanges);

router.get('/deploy/status', c.getDeployStatus);
router.post('/deploy',       c.deployToProduction);

router.get('/orders',                    c.getAdminOrders);
router.patch('/orders/:id/payment-info', c.setPaymentInfo);
router.patch('/orders/:id/approve',      c.approvePayment);
router.patch('/orders/:id/reject',          c.rejectPayment);
router.patch('/orders/:id/reject-preorder', c.rejectPreorder);
router.patch('/orders/:id/shipping',     c.setShipping);
router.patch('/orders/:id/delivered',    c.markDelivered);
router.get('/prizes',                    c.listPrizeOrders);
router.patch('/prizes/:id/ship',         c.shipPrizeOrder);
router.patch('/prizes/:id/delivered',    c.deliverPrizeOrder);
router.patch('/prizes/:id/note',         c.updatePrizeNote);

const cp = require('../controllers/couponsController');
router.get('/coupons',          cp.listCoupons);
router.post('/coupons',         cp.createCoupon);
router.put('/coupons/:id',      cp.updateCoupon);
router.delete('/coupons/:id',   cp.deleteCoupon);

const m = require('../controllers/messagesController');
router.get('/orders/messages/unread',    m.adminUnreadCount);
router.get('/orders/:id/messages',       m.adminGetMessages);
router.post('/orders/:id/messages',      m.adminReply);

const rc = require('../controllers/returnsController');
const { getReceiptUploadMiddleware } = require('../middleware/upload');
router.get('/returns',                   rc.adminListReturns);
router.get('/orders/:id/returns',        rc.adminGetOrderReturn);
router.patch('/returns/:id/received',    rc.adminMarkReceived);
router.post('/returns/:id/refund-receipt', function(req, res, next) {
  const upload = getReceiptUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'upload not available' });
  upload.single('receipt')(req, res, function(err) {
    if (err) return next(err);
    rc.adminUploadRefundReceipt(req, res, next);
  });
});
router.post('/returns/:id/reject', function(req, res, next) {
  const upload = getReceiptUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'upload not available' });
  upload.single('photo')(req, res, function(err) {
    if (err) return next(err);
    rc.adminRejectRefund(req, res, next);
  });
});

router.get('/reports',              c.getReports);
router.get('/financial-report',    c.getFinancialReport);
router.get('/customer-reports',    c.getCustomerReports);
router.get('/coupon-report',       c.getCouponReport);
router.get('/site-views-report',   c.getSiteViewsReport);
router.get('/bank-accounts',        c.getBankAccounts);
router.post('/bank-accounts',       c.createBankAccount);
router.put('/bank-accounts/:id',    c.updateBankAccount);
router.delete('/bank-accounts/:id', c.deleteBankAccount);

const pp = require('../controllers/productPhotosController');
router.get('/product-photos',           pp.adminListPhotos);
router.patch('/product-photos/:id',     pp.adminToggleApproval);
router.delete('/product-photos/:id',    pp.adminDeletePhoto);

const sc = require('../controllers/suppliersController');
router.get('/suppliers',       sc.listSuppliers);
router.delete('/suppliers/:id', sc.deleteSupplier);
router.post('/suppliers', function(req, res, next) {
  const upload = getUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'upload not available' });
  upload.single('card_photo')(req, res, function(err) {
    if (err) return next(err);
    sc.createSupplier(req, res, next);
  });
});
router.put('/suppliers/:id', function(req, res, next) {
  const upload = getUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'upload not available' });
  upload.single('card_photo')(req, res, function(err) {
    if (err) return next(err);
    sc.updateSupplier(req, res, next);
  });
});

const rf = require('../controllers/referralController');
router.get('/leads', rf.adminListLeads);

module.exports = router;
