const multer = require('multer');
const { AVATAR_ERROR } = require('./avatars');

const fetcherPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 6 },
  fileFilter(req, file, callback) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      const error = new Error(AVATAR_ERROR);
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

module.exports = { fetcherPhotoUpload };
