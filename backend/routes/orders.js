const router = require('express').Router();
const c = require('../controllers/ordersController');
const { getUploadMiddleware } = require('../middleware/upload');

router.post('/', c.createPreorder);
router.get('/my', c.getMyOrders);
router.get('/:id', c.getMyOrder);
router.delete('/:id', c.cancelOrder);
router.post('/:id/receipt', function(req, res, next) {
  const upload = getUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'upload not available' });
  upload.single('receipt')(req, res, function(err) {
    if (err) return next(err);
    c.uploadReceipt(req, res, next);
  });
});

module.exports = router;
