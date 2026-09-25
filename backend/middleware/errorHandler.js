function errorHandler(error, req, res, next) {
  console.error(error);

  const status = Number(error.status) || 500;
  const message = status >= 500 ? 'Something went wrong.' : error.message;

  res.status(status).json({ message });
}

module.exports = { errorHandler };
