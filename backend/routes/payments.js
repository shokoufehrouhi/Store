const router = require('express').Router();
const c = require('../controllers/paymentsController');

router.get('/order/:orderId', c.getByOrder);
router.post('/',              c.create);
router.patch('/:id/status',   c.updateStatus);

module.exports = router;
