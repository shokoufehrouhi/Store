const router    = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const c         = require('../controllers/adminController');
const { getUploadMiddleware } = require('../middleware/upload');

router.post('/login', c.login);

router.use(adminAuth);

router.post('/upload', (req, res, next) => {
  const upload = getUploadMiddleware();
  if (!upload) return res.status(503).json({ success: false, message: 'multer not installed — run: npm install multer' });
  upload.single('file')(req, res, (err) => {
    if (err) return next(err);
    c.uploadMedia(req, res);
  });
});

router.delete('/media/:id',      c.deleteMedia);

router.get('/categories',        c.getCategories);
router.post('/categories',       c.createCategory);
router.put('/categories/:id',    c.updateCategory);
router.delete('/categories/:id', c.deleteCategory);

router.get('/subcategories',       c.getSubcategories);
router.post('/subcategories',      c.createSubcategory);
router.put('/subcategories/:id',   c.updateSubcategory);
router.delete('/subcategories/:id', c.deleteSubcategory);

router.get('/colors',       c.getColors);
router.post('/colors',      c.createColor);
router.put('/colors/:id',   c.updateColor);
router.delete('/colors/:id', c.deleteColor);

router.get('/sizes',        c.getSizes);
router.post('/sizes',       c.createSize);
router.put('/sizes/:id',    c.updateSize);
router.delete('/sizes/:id', c.deleteSize);

router.get('/customers',        c.getAdminCustomers);
router.put('/customers/:id',   c.updateAdminCustomer);

router.get('/products',       c.getProducts);
router.post('/products',      c.createProduct);
router.put('/products/:id',   c.updateProduct);
router.delete('/products/:id', c.deleteProduct);

module.exports = router;
