const router = require('express').Router();
const c  = require('../controllers/ordersController');
const m  = require('../controllers/messagesController');
const rc = require('../controllers/returnsController');
const { getReceiptUploadMiddleware } = require('../middleware/upload');

function withUpload(field, handler) {
  return function(req, res, next) {
    const upload = getReceiptUploadMiddleware();
    if (!upload) return res.status(503).json({ success: false, message: 'upload not available' });
    upload.single(field)(req, res, function(err) {
      if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, errorCode: 'file_too_large' });
      if (err) return next(err);
      handler(req, res, next);
    });
  };
}

router.post('/', c.createPreorder);
router.post('/link-request', c.createLinkRequest);
router.get('/my', c.getMyOrders);
router.get('/:id', c.getMyOrder);
router.delete('/:id', c.cancelOrder);
router.post('/:id/quote/approve', c.approveQuote);
router.post('/:id/quote/reject',  c.rejectQuote);
router.post('/:id/receipt', function(req, res, next) {
  const upload = getReceiptUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'upload not available' });
  upload.single('receipt')(req, res, function(err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, errorCode: 'file_too_large' });
    }
    if (err) return next(err);
    c.uploadReceipt(req, res, next);
  });
});

router.get('/:id/messages',  m.customerGetMessages);
router.post('/:id/messages', m.customerSendMessage);

// Returns
router.post('/:id/returns',   rc.customerRequestReturn);
router.get('/:id/returns',    rc.customerGetReturn);
router.post('/:id/defective', withUpload('photo', rc.customerReportDefective));
router.post('/returns/:id/shipping', withUpload('receipt', rc.customerUploadShipping));
router.put('/returns/:id/refund-info', rc.customerSetRefundInfo);
router.post('/returns/:id/confirm',    rc.customerConfirmRefund);

// Customer product photos
const pp = require('../controllers/productPhotosController');
router.post('/:id/product-photos', withUpload('photo', pp.uploadProductPhoto));
router.delete('/product-photos/:photoId', pp.deleteMyPhoto);

module.exports = router;
