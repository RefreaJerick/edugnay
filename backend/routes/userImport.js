const express = require('express');
const multer = require('multer');
const { importUsers } = require('../controllers/userImportController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const isCsv = /\.csv$/i.test(file.originalname) || ['text/csv', 'application/csv'].includes(file.mimetype);
    callback(isCsv ? null : Object.assign(new Error('Upload a CSV file.'), { status: 400 }), isCsv);
  }
});
const router = express.Router();

router.post('/', requireAuth, requireRoles('platform_admin', 'school_admin'), (req, res, next) => {
  upload.single('csvFile')(req, res, error => {
    if (error) {
      error.status = error.status || 400;
      return next(error);
    }
    return importUsers(req, res, next);
  });
});

module.exports = router;
