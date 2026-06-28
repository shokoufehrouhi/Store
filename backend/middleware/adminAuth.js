const ADMIN_TOKEN = 'akhgar-admin-9f3k2m8x7n1p4q6r';

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};
