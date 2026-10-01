const express = require('express');
const controller = require('../controllers/archiveController');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth, requireSchoolAdmin);
router.get('/', controller.listArchives);
router.get('/academic-years/:yearId', controller.getArchiveYear);
router.post('/academic-years/:yearId', controller.archiveAcademicYear);

module.exports = router;
