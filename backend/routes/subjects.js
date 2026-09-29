const express = require('express');
const controller = require('../controllers/subjectsController');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/', controller.listSubjects);
router.post('/', requireSchoolAdmin, controller.createSubject);
router.patch('/:subjectId', requireSchoolAdmin, controller.updateSubject);

module.exports = router;
