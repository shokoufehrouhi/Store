const router = require('express').Router();
const c = require('../controllers/customersController');

router.post('/register',         c.register);
router.post('/login',            c.login);
router.post('/logout',           c.logout);
router.get('/profile',           c.getProfile);
router.patch('/profile',         c.updateProfile);
router.patch('/avatar',          c.updateAvatar);
router.post('/forgot-password',  c.forgotPassword);
router.post('/reset-password',   c.resetPassword);
router.post('/addresses',        c.addAddress);
router.patch('/addresses/:id',   c.updateAddress);
router.delete('/addresses/:id',  c.deleteAddress);
router.get('/favorites',               c.getFavorites);
router.post('/favorites/:productId',   c.addFavorite);
router.delete('/favorites/:productId', c.removeFavorite);
router.get('/cart',                    c.getCart);
router.post('/cart/sync',              c.syncCart);

module.exports = router;
