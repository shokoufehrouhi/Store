const router    = require('express').Router();
const c         = require('../controllers/productsController');
const adminAuth = require('../middleware/adminAuth');

router.get('/',    c.getAll);
router.get('/:id', c.getOne);

router.post('/',       adminAuth, c.create);
router.put('/:id',    adminAuth, c.update);
router.delete('/:id', adminAuth, c.remove);

const pp = require('../controllers/productPhotosController');
router.get('/:id/customer-photos', pp.getProductPhotos);

module.exports = router;
