const router = require('express').Router();
const c = require('../controllers/ordersController');

router.get('/',            c.getAll);
router.get('/:id',         c.getOne);
router.post('/',           c.create);
router.patch('/:id/status', c.updateStatus);

module.exports = router;
