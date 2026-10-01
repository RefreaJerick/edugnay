function createRequestOriginGuard(frontendOrigin) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('Origin') !== frontendOrigin) {
      return res.status(403).json({ message: 'Request origin is not allowed.' });
    }
    next();
  };
}

module.exports = { createRequestOriginGuard };
