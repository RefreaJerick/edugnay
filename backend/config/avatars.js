const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const { getPrivateStorageDirectory } = require('./privateStorage');

const avatarDirectory = getPrivateStorageDirectory('AVATAR_DIRECTORY', 'avatars');
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_ERROR = 'Choose a valid PNG, JPEG, or WebP photo that is 2 MB or smaller.';
const AVATAR_FILENAME = /^[a-f0-9-]{36}\.(png|jpg|webp)$/;

function invalidAvatar() {
  const error = new Error(AVATAR_ERROR);
  error.status = 400;
  return error;
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0 },
  fileFilter(req, file, callback) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) return callback(invalidAvatar());
    callback(null, true);
  }
});

function avatarType(file) {
  const bytes = file?.buffer;
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_AVATAR_BYTES) throw invalidAvatar();
  if (file.mimetype === 'image/png' && bytes.length >= 45
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') return '.png';
  if (file.mimetype === 'image/jpeg' && bytes.length >= 4
    && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    && bytes.subarray(bytes.length - 2).equals(Buffer.from([255, 217]))) return '.jpg';
  if (file.mimetype === 'image/webp' && bytes.length >= 16
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length) return '.webp';
  throw invalidAvatar();
}

function avatarMimeType(filename) {
  if (!AVATAR_FILENAME.test(filename || '')) return null;
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg')) return 'image/jpeg';
  return 'image/webp';
}

async function saveAvatar(file) {
  const extension = avatarType(file);
  await fs.mkdir(avatarDirectory, { recursive: true });
  const filename = `${crypto.randomUUID()}${extension}`;
  const filePath = path.join(avatarDirectory, filename);
  try {
    await fs.writeFile(filePath, file.buffer, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') await fs.unlink(filePath).catch(() => {});
    throw error;
  }
  return filename;
}

async function deleteAvatar(filename) {
  if (!AVATAR_FILENAME.test(filename || '')) return;
  await fs.unlink(path.join(avatarDirectory, filename)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function avatarFields(user) {
  const hasAvatar = AVATAR_FILENAME.test(user.avatarFilename || '');
  const avatarVersion = Number(user.avatarVersion) || 0;
  return {
    hasAvatar,
    avatarUrl: hasAvatar ? `/api/users/${user.id}/avatar?v=${avatarVersion}` : null,
    avatarVersion
  };
}

module.exports = {
  AVATAR_ERROR,
  avatarDirectory,
  avatarFields,
  avatarMimeType,
  avatarType,
  avatarUpload,
  deleteAvatar,
  saveAvatar
};
