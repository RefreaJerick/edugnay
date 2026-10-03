const express = require('express');
const controller = require('../controllers/materialsController');
const { materialUpload } = require('../config/uploads');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolUser, requireTeacher } = require('../middleware/authorize');

const router = express.Router();
router.use(requireAuth, requireSchoolUser);
router.get('/', controller.listMaterials);
router.post('/sections/:sectionId/subjects/:subjectId', requireTeacher, controller.authorizeUpload,
  materialUpload.single('file'), controller.createMaterial);
router.patch('/:materialId', requireTeacher, controller.updateMaterial);
router.delete('/:materialId', requireTeacher, controller.deleteMaterial);
router.get('/:materialId/file', controller.openMaterial);

module.exports = router;
