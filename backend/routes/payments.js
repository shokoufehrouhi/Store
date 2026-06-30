const router    = require('express').Router();
const c         = require('../controllers/paymentsController');
const adminAuth = require('../middleware/adminAuth');

router.use(adminAuth);

router.get('/order/:orderId', c.getByOrder);
router.post('/',              c.create);
router.patch('/:id/status',   c.updateStatus);

module.exports = router;
