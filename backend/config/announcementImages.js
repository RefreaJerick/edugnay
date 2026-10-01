const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const multer = require('multer');

const imageDirectory = path.resolve(process.env.ANNOUNCEMENT_IMAGE_DIRECTORY || path.join(os.homedir(), '.academix', 'uploads', 'announcements'));
const workspaceDirectory = path.resolve(__dirname, '..', '..');
const relative = path.relative(workspaceDirectory, imageDirectory);
if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
  throw new Error('ANNOUNCEMENT_IMAGE_DIRECTORY must be outside the project workspace.');
}

const announcementImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 12 },
  fileFilter(req, file, callback) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a PNG, JPEG, or WebP image.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

function imageType(file) {
  const bytes = file.buffer;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && file.mimetype === 'image/png') return { extension: '.png', mime: 'image/png' };
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && file.mimetype === 'image/jpeg') return { extension: '.jpg', mime: 'image/jpeg' };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && file.mimetype === 'image/webp') return { extension: '.webp', mime: 'image/webp' };
  const error = new Error('The image file is not valid.');
  error.status = 400;
  throw error;
}

async function saveAnnouncementImage(file) {
  const type = imageType(file);
  await fs.mkdir(imageDirectory, { recursive: true });
  const name = `${crypto.randomUUID()}${type.extension}`;
  await fs.writeFile(path.join(imageDirectory, name), file.buffer, { flag: 'wx' });
  return name;
}

async function deleteAnnouncementImage(name) {
  if (/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name || '')) {
    await fs.unlink(path.join(imageDirectory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

module.exports = { announcementImageUpload, deleteAnnouncementImage, imageDirectory, imageType, saveAnnouncementImage };
