module.exports = (req, res, next) => {
  const token = process.env.ADMIN_TOKEN;
  const auth  = req.headers.authorization;
  if (!token || !auth || auth !== `Bearer ${token}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};
