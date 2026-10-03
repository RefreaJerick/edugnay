const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getPrivateStorageDirectory } = require('./privateStorage');

const uploadDirectory = getPrivateStorageDirectory('ASSIGNMENT_SUBMISSION_DIRECTORY', 'assignment-submissions');
const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

fs.mkdirSync(uploadDirectory, { recursive: true });

const assignmentSubmissionUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      const error = new Error('Only PDF, Office, and spreadsheet files can be submitted.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

const materialUploadDirectory = getPrivateStorageDirectory('MATERIAL_UPLOAD_DIRECTORY', 'learning-materials');
fs.mkdirSync(materialUploadDirectory, { recursive: true });
const materialTypes = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4'
};
const materialUpload = multer({
  storage: multer.diskStorage({
    destination: materialUploadDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 3, parts: 4, fieldSize: 2048 },
  fileFilter: (req, file, callback) => {
    if (!materialTypes[path.extname(file.originalname).toLowerCase()]) {
      const error = new Error('Choose a PDF, Office, JPG, PNG, or MP4 file.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

module.exports = { assignmentSubmissionUpload, uploadDirectory, materialUpload, materialUploadDirectory, materialTypes };
