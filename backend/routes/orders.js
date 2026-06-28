const router = require('express').Router();
const c = require('../controllers/ordersController');
const { getReceiptUploadMiddleware } = require('../middleware/upload');

router.post('/', c.createPreorder);
router.get('/my', c.getMyOrders);
router.get('/:id', c.getMyOrder);
router.delete('/:id', c.cancelOrder);
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

module.exports = router;
