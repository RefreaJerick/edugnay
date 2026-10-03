const express = require('express');
const controller = require('../controllers/subjectsController');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin, requireSchoolUser } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth, requireSchoolUser);
router.get('/', controller.listSubjects);
router.post('/', requireSchoolAdmin, controller.createSubject);
router.patch('/:subjectId', requireSchoolAdmin, controller.updateSubject);
router.delete('/:subjectId', requireSchoolAdmin, controller.deleteSubject);

module.exports = router;
