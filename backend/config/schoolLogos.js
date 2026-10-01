const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const multer = require('multer');

const logoDirectory = path.resolve(process.env.SCHOOL_LOGO_DIRECTORY || path.join(os.homedir(), '.academix', 'uploads', 'school-logos'));
const workspaceDirectory = path.resolve(__dirname, '..', '..');
const relativeDirectory = path.relative(workspaceDirectory, logoDirectory);
if (!relativeDirectory || (!relativeDirectory.startsWith(`..${path.sep}`) && relativeDirectory !== '..' && !path.isAbsolute(relativeDirectory))) {
  throw new Error('SCHOOL_LOGO_DIRECTORY must be outside the project workspace.');
}

const schoolLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1 },
  fileFilter(req, file, callback) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a PNG, JPEG, or WebP logo.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

function logoExtension(file) {
  if (!file) return null;
  const bytes = file.buffer;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && file.mimetype === 'image/png') return '.png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && file.mimetype === 'image/jpeg') return '.jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && file.mimetype === 'image/webp') return '.webp';
  const error = new Error('The logo file is not a valid PNG, JPEG, or WebP image.');
  error.status = 400;
  throw error;
}

async function saveSchoolLogo(file) {
  const extension = logoExtension(file);
  if (!extension) return null;
  await fs.mkdir(logoDirectory, { recursive: true });
  const name = `${crypto.randomUUID()}${extension}`;
  await fs.writeFile(path.join(logoDirectory, name), file.buffer, { flag: 'wx' });
  return name;
}

function getSchoolLogoUrl(school) {
  const logoPath = school.logoPath || '';
  return /^\/assets\/images\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp)$/.test(logoPath)
    || /^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(logoPath)
    ? `/api/schools/${school.id}/logo` : null;
}

module.exports = { schoolLogoUpload, saveSchoolLogo, getSchoolLogoUrl, logoDirectory };
