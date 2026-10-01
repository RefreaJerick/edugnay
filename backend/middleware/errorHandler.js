function errorHandler(error, req, res, next) {
  console.error(error);

  const status = String(error.code || '').startsWith('LIMIT_') ? 400 : Number(error.status) || 500;
  const message = error.code === 'LIMIT_FILE_SIZE'
    ? (req.originalUrl?.startsWith('/api/schools/register') || req.originalUrl?.startsWith('/api/school/logo')
      ? 'School logos must be 2 MB or smaller.'
      : req.originalUrl?.startsWith('/api/announcements')
      ? 'Announcement images must be 5 MB or smaller.'
      : req.originalUrl?.startsWith('/api/materials')
      ? 'Material uploads must be 50 MB or smaller (20 MB for non-video files).'
      : 'Submission files must be 10 MB or smaller.')
    : String(error.code || '').startsWith('LIMIT_') ? 'The upload has too many or oversized fields.'
      : status >= 500 && !error.expose ? 'Something went wrong.' : error.message;

  res.status(status).json({ message });
}

module.exports = { errorHandler };
