function errorHandler(err, req, res, next) {
  console.error(err.stack);

  // Prisma known error codes — safe user-facing messages
  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'Already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  if (typeof err.code === 'string' && err.code.startsWith('P')) {
    return res.status(400).json({ success: false, message: 'Database error' });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.status ? err.message : 'Internal Server Error',
  });
}

module.exports = errorHandler;
